// Phase 1 offline downloads: FIFO queue bridge between the web client and the
// native DownloadComponent. One active download at a time; progress, completed
// and failed events flow back to listeners (QML via window.api.download
// signals, web UI via this queue). Plan negotiation reuses the pure helpers
// from native/downloadSpike.js (window._downloadSpike) — never reimplemented
// here. Load convention follows nativeshell.js: concatenated before
// nativeshell at DocumentCreation/MainWorld, published as window._downloadPlugin
// like window._downloadSpike / window._inputPlugin.
(function() {
'use strict';

function percentOf(received, total) {
    if (!Number.isFinite(received) || received < 0) {
        received = 0;
    }
    if (!Number.isFinite(total) || total <= 0) {
        return 0;
    }
    return Math.min(100, Math.max(0, (received / total) * 100));
}

function spikeHelpers() {
    if (typeof window !== 'undefined' && window && window._downloadSpike) {
        return window._downloadSpike;
    }
    return null;
}

function defaultFilename(url) {
    try {
        var path = String(url).split('?')[0].split('#')[0];
        var base = path.substring(path.lastIndexOf('/') + 1);
        return base || 'download.bin';
    } catch (e) {
        return 'download.bin';
    }
}

// Negotiation wrapper over the spike helpers: pick the download source,
// build its URL, and resolve subtitle sidecars into a queue-ready plan.
function planFromPlayback(playbackInfo, options) {
    var helpers = spikeHelpers();
    if (!helpers) {
        throw new Error('downloadPlugin: downloadSpike helpers unavailable');
    }
    var opts = options || {};
    var pick = helpers.pickDownloadSource(playbackInfo);
    if (!pick.mediaSource) {
        return {
            kind: pick.kind, url: null, resumable: false, expectedSize: null,
            subtitles: [], burnInOnly: [], warning: pick.warning
        };
    }
    var url = helpers.buildMediaDownloadUrl(opts.serverUrl, opts.itemId, pick.mediaSource, opts.mediaType);
    var selected = helpers.selectDownloadSubtitles(pick.mediaSource, opts);
    var streams = Array.isArray(pick.mediaSource.MediaStreams) ? pick.mediaSource.MediaStreams : [];
    var subtitles = selected.sidecars.map(function(index) {
        var stream = null;
        for (var i = 0; i < streams.length; i++) {
            if (streams[i] && streams[i].Index === index) {
                stream = streams[i];
                break;
            }
        }
        return {
            index: index,
            ext: helpers.normalizeSubtitleExt(stream),
            url: stream ? helpers.buildSubtitleUrl(opts.serverUrl, opts.itemId, pick.mediaSource, stream) : null
        };
    });
    return {
        kind: pick.kind,
        url: url,
        resumable: pick.resumable === true,
        expectedSize: pick.mediaSource.Size != null ? pick.mediaSource.Size : null,
        subtitles: subtitles,
        burnInOnly: selected.burnInOnly,
        warning: pick.warning
    };
}

// Default transport over the native DownloadComponent (window.api.download).
// The C++ side handles a single download; the queue above serializes access.
function defaultTransport() {
    function api() {
        if (typeof window !== 'undefined' && window && window.api && window.api.download) {
            return window.api.download;
        }
        return null;
    }
    function defer(fn) {
        if (typeof setTimeout === 'function') {
            setTimeout(fn, 0);
        } else {
            fn();
        }
    }
    return {
        start: function(job, events) {
            var bridge = api();
            if (!bridge || typeof bridge.start !== 'function') {
                defer(function() { events.onError('unavailable'); });
                return null;
            }
            var onProgress = function(id, received, total) {
                if (id === job.id) {
                    events.onProgress(received, total);
                }
            };
            var onComplete = function(id, path) {
                if (id === job.id) {
                    events.onComplete({ path: path });
                }
            };
            var onError = function(id, reason) {
                if (id === job.id) {
                    events.onError(reason);
                }
            };
            var handle = { id: job.id, bridge: bridge, handlers: [onProgress, onComplete, onError] };
            try {
                bridge.bytesChanged.connect(onProgress);
                bridge.downloadCompleted.connect(onComplete);
                bridge.downloadFailed.connect(onError);
                bridge.start(job.id, job.url, job.filename, job.token || '', job.resumable);
            } catch (e) {
                disconnectHandle(handle);
                defer(function() { events.onError('unavailable'); });
                return null;
            }
            return handle;
        },
        abort: function(handle) {
            if (!handle || !handle.bridge) {
                return;
            }
            var id = handle.id;
            var bridge = handle.bridge;
            disconnectHandle(handle);
            try {
                if (typeof bridge.cancel === 'function') {
                    bridge.cancel(id);
                }
            } catch (e) {
                // Aborted from our side already; the late native reply is dropped by id.
            }
        }
    };
}

function disconnectHandle(handle) {
    var bridge = handle.bridge;
    var handlers = handle.handlers;
    try {
        if (bridge.bytesChanged && typeof bridge.bytesChanged.disconnect === 'function') {
            bridge.bytesChanged.disconnect(handlers[0]);
        }
        if (bridge.downloadCompleted && typeof bridge.downloadCompleted.disconnect === 'function') {
            bridge.downloadCompleted.disconnect(handlers[1]);
        }
        if (bridge.downloadFailed && typeof bridge.downloadFailed.disconnect === 'function') {
            bridge.downloadFailed.disconnect(handlers[2]);
        }
    } catch (e) {
        // Best effort: stale listeners filter by id and are harmless.
    }
    handle.bridge = null;
}

class DownloadQueue {
    constructor(transport) {
        this._transport = transport || defaultTransport();
        this._pending = [];
        this._active = null;
        this._seq = 0;
        this._listeners = { progress: [], completed: [], failed: [] };
    }

    on(event, callback) {
        if (!this._listeners[event] || typeof callback !== 'function') {
            return false;
        }
        if (this._listeners[event].indexOf(callback) === -1) {
            this._listeners[event].push(callback);
        }
        return true;
    }

    off(event, callback) {
        if (!this._listeners[event]) {
            return false;
        }
        var index = this._listeners[event].indexOf(callback);
        if (index === -1) {
            return false;
        }
        this._listeners[event].splice(index, 1);
        return true;
    }

    activeId() {
        return this._active ? this._active.job.id : null;
    }

    pendingCount() {
        return this._pending.length;
    }

    enqueue(plan) {
        if (!plan || typeof plan !== 'object') {
            throw new TypeError('downloadPlugin: plan object is required');
        }
        if (typeof plan.url !== 'string' || plan.url.length === 0) {
            throw new Error('downloadPlugin: plan.url is required');
        }
        var kind = plan.kind || 'direct';
        if (kind === 'hls-only' || kind === 'none') {
            throw new Error('downloadPlugin: kind "' + kind + '" cannot be downloaded');
        }
        // Spike plan: direct sources honour HTTP Range (resumable); progressive
        // transcodes are never resumed, so force resume off for them even when
        // a caller passes resumable through blindly.
        var job = {
            id: 'download-' + (++this._seq),
            url: plan.url,
            filename: typeof plan.filename === 'string' && plan.filename.length > 0
                ? plan.filename
                : defaultFilename(plan.url),
            kind: kind,
            resumable: kind === 'direct' && plan.resumable === true,
            expectedSize: Number.isFinite(plan.expectedSize) ? plan.expectedSize : null,
            token: typeof plan.token === 'string' ? plan.token : ''
        };
        this._pending.push(job);
        this._pump();
        return job.id;
    }

    cancel(id) {
        if (this._active && this._active.job.id === id) {
            var record = this._active;
            this._active = null;
            record.cancelled = true;
            try {
                this._transport.abort(record.handle);
            } catch (e) {
                // Transport already gone; the cancel still stands.
            }
            this._emit('failed', { id: id, reason: 'cancelled' });
            this._pump();
            return true;
        }
        for (var i = 0; i < this._pending.length; i++) {
            if (this._pending[i].id === id) {
                this._pending.splice(i, 1);
                return true;
            }
        }
        return false;
    }

    _emit(event, payload) {
        var listeners = this._listeners[event].slice();
        for (var i = 0; i < listeners.length; i++) {
            try {
                listeners[i](payload);
            } catch (e) {
                if (typeof console !== 'undefined' && console.error) {
                    console.error('downloadPlugin listener failed:', e);
                }
            }
        }
    }

    _pump() {
        if (this._active || this._pending.length === 0) {
            return;
        }
        var self = this;
        var job = this._pending.shift();
        var record = { job: job, handle: null, cancelled: false, settled: false };
        this._active = record;
        var events = {
            onProgress: function(received, total) {
                if (record.cancelled || record.settled) {
                    return;
                }
                self._emit('progress', {
                    id: job.id, received: received, total: total,
                    percent: percentOf(received, total)
                });
            },
            onComplete: function(info) {
                if (record.cancelled || record.settled) {
                    return;
                }
                record.settled = true;
                self._active = null;
                self._emit('completed', { id: job.id, path: info && info.path ? info.path : '' });
                self._pump();
            },
            onError: function(reason) {
                if (record.cancelled || record.settled) {
                    return;
                }
                record.settled = true;
                self._active = null;
                self._emit('failed', { id: job.id, reason: reason || 'unknown' });
                self._pump();
            }
        };
        try {
            record.handle = this._transport.start(job, events);
        } catch (e) {
            record.settled = true;
            this._active = null;
            this._emit('failed', { id: job.id, reason: 'unavailable' });
            this._pump();
        }
    }
}

var downloadPlugin = {
    DownloadQueue: DownloadQueue,
    planFromPlayback: planFromPlayback,
    percentOf: percentOf
};

if (typeof window !== 'undefined' && window) {
    window._downloadPlugin = downloadPlugin;
}
if (typeof module !== 'undefined' && module && module.exports) {
    module.exports = downloadPlugin;
}
})();
