import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

function loadDownloadPlugin(spike) {
    const window = {};
    if (spike !== undefined) {
        window._downloadSpike = spike;
    }
    const module = { exports: {} };
    const context = {
        window,
        module,
        setTimeout,
        clearTimeout,
        console: { log() {}, debug() {}, warn() {}, error() {} }
    };
    runInNewContext(readFileSync(new URL('../native/downloadPlugin.js', import.meta.url), 'utf8'), context);
    assert.equal(window._downloadPlugin, module.exports);
    return { api: module.exports, window };
}

function mockTransport() {
    const calls = { starts: [], aborts: [] };
    const handles = [];
    return {
        calls,
        handle(index) { return handles[index]; },
        start(job, events) {
            const handle = { job, events, aborted: false };
            calls.starts.push(job);
            handles.push(handle);
            return handle;
        },
        abort(handle) {
            calls.aborts.push(handle);
            if (handle) {
                handle.aborted = true;
            }
        }
    };
}

function collectEvents(queue) {
    const events = { progress: [], completed: [], failed: [] };
    queue.on('progress', (payload) => events.progress.push(payload));
    queue.on('completed', (payload) => events.completed.push(payload));
    queue.on('failed', (payload) => events.failed.push(payload));
    return events;
}

// Payloads are built inside the vm context, so they carry a different Object
// prototype; compare their plain structure instead of realm identity.
function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

test('enqueue rejects missing or invalid plans', () => {
    const { api } = loadDownloadPlugin();
    const queue = new api.DownloadQueue(mockTransport());
    assert.throws(() => queue.enqueue(null), /plan object/);
    assert.throws(() => queue.enqueue('http://x/y.mp4'), /plan object/);
    assert.throws(() => queue.enqueue({}), /plan\.url/);
    assert.throws(() => queue.enqueue({ url: '' }), /plan\.url/);
});

test('enqueue rejects non-downloadable spike kinds', () => {
    const { api } = loadDownloadPlugin();
    const queue = new api.DownloadQueue(mockTransport());
    assert.throws(() => queue.enqueue({ url: 'http://x/y', kind: 'hls-only' }), /hls-only/);
    assert.throws(() => queue.enqueue({ url: 'http://x/y', kind: 'none' }), /"none"/);
});

test('queue runs FIFO with one active at a time', () => {
    const { api } = loadDownloadPlugin();
    const transport = mockTransport();
    const queue = new api.DownloadQueue(transport);
    const events = collectEvents(queue);

    const a = queue.enqueue({ url: 'http://x/a.mp4', filename: 'a.mp4' });
    const b = queue.enqueue({ url: 'http://x/b.mp4', filename: 'b.mp4' });
    const c = queue.enqueue({ url: 'http://x/c.mp4', filename: 'c.mp4' });

    assert.equal(queue.activeId(), a);
    assert.equal(queue.pendingCount(), 2);
    assert.deepEqual(transport.calls.starts.map((job) => job.id), [a]);

    transport.handle(0).events.onComplete({ path: '/dl/a.mp4' });
    assert.equal(queue.activeId(), b);
    assert.deepEqual(transport.calls.starts.map((job) => job.id), [a, b]);

    transport.handle(1).events.onComplete({ path: '/dl/b.mp4' });
    assert.equal(queue.activeId(), c);
    assert.deepEqual(transport.calls.starts.map((job) => job.id), [a, b, c]);

    transport.handle(2).events.onComplete({ path: '/dl/c.mp4' });
    assert.equal(queue.activeId(), null);
    assert.equal(queue.pendingCount(), 0);
    assert.deepEqual(events.completed.map((event) => event.id), [a, b, c]);
    assert.deepEqual(events.failed, []);
});

test('a failed download does not stall the queue', () => {
    const { api } = loadDownloadPlugin();
    const transport = mockTransport();
    const queue = new api.DownloadQueue(transport);
    const events = collectEvents(queue);

    const a = queue.enqueue({ url: 'http://x/a.mp4' });
    const b = queue.enqueue({ url: 'http://x/b.mp4' });
    transport.handle(0).events.onError('http-404');

    assert.deepEqual(plain(events.failed), [{ id: a, reason: 'http-404' }]);
    assert.deepEqual(transport.calls.starts.map((job) => job.id), [a, b]);
    assert.equal(queue.activeId(), b);
});

test('cancel drops a queued item before it starts', () => {
    const { api } = loadDownloadPlugin();
    const transport = mockTransport();
    const queue = new api.DownloadQueue(transport);
    const events = collectEvents(queue);

    const a = queue.enqueue({ url: 'http://x/a.mp4' });
    const b = queue.enqueue({ url: 'http://x/b.mp4' });
    assert.equal(queue.cancel(b), true);
    assert.equal(queue.pendingCount(), 0);

    transport.handle(0).events.onComplete({ path: '/dl/a.mp4' });
    assert.deepEqual(transport.calls.starts.map((job) => job.id), [a]);
    assert.deepEqual(events.completed.map((event) => event.id), [a]);
    assert.deepEqual(events.failed, []);
});

test('cancel of the active item fails it and starts the next', () => {
    const { api } = loadDownloadPlugin();
    const transport = mockTransport();
    const queue = new api.DownloadQueue(transport);
    const events = collectEvents(queue);

    const a = queue.enqueue({ url: 'http://x/a.mp4' });
    const b = queue.enqueue({ url: 'http://x/b.mp4' });
    assert.equal(queue.cancel(a), true);

    assert.deepEqual(transport.calls.aborts, [transport.handle(0)]);
    assert.deepEqual(plain(events.failed), [{ id: a, reason: 'cancelled' }]);
    assert.equal(queue.activeId(), b);

    // Late transport callbacks for the cancelled job are ignored.
    transport.handle(0).events.onComplete({ path: '/dl/a.mp4' });
    assert.deepEqual(events.completed, []);
});

test('cancel of an unknown id returns false', () => {
    const { api } = loadDownloadPlugin();
    const queue = new api.DownloadQueue(mockTransport());
    assert.equal(queue.cancel('download-999'), false);
});

test('progress events carry percent math', () => {
    const { api } = loadDownloadPlugin();
    const transport = mockTransport();
    const queue = new api.DownloadQueue(transport);
    const events = collectEvents(queue);

    assert.equal(api.percentOf(50, 200), 25);
    assert.equal(api.percentOf(0, 0), 0);
    assert.equal(api.percentOf(10, -5), 0);
    assert.equal(api.percentOf(-3, 100), 0);
    assert.equal(api.percentOf(300, 200), 100);

    const id = queue.enqueue({ url: 'http://x/a.mp4' });
    transport.handle(0).events.onProgress(50, 200);
    transport.handle(0).events.onProgress(0, 0);
    assert.deepEqual(plain(events.progress), [
        { id, received: 50, total: 200, percent: 25 },
        { id, received: 0, total: 0, percent: 0 }
    ]);
});

test('direct plans resume, transcode plans never resume', () => {
    const { api } = loadDownloadPlugin();
    const transport = mockTransport();
    const queue = new api.DownloadQueue(transport);

    queue.enqueue({ url: 'http://x/a.mp4', kind: 'direct', resumable: true });
    transport.handle(0).events.onComplete({});
    queue.enqueue({ url: 'http://x/b.mp4', kind: 'transcode', resumable: true });
    transport.handle(1).events.onComplete({});
    queue.enqueue({ url: 'http://x/c.mp4', kind: 'direct' });

    assert.equal(transport.calls.starts[0].resumable, true);
    assert.equal(transport.calls.starts[1].resumable, false);
    assert.equal(transport.calls.starts[2].resumable, false);
});

test('completed events pass through the native path', () => {
    const { api } = loadDownloadPlugin();
    const transport = mockTransport();
    const queue = new api.DownloadQueue(transport);
    const events = collectEvents(queue);

    const id = queue.enqueue({ url: 'http://x/a.mp4' });
    transport.handle(0).events.onComplete({ path: '/profiles/1/downloads/a.mp4' });
    assert.deepEqual(plain(events.completed), [{ id, path: '/profiles/1/downloads/a.mp4' }]);
});

test('planFromPlayback reuses the spike helpers', () => {
    const mediaSource = { Id: 'ms1', Container: 'mp4', Size: 1234, MediaStreams: [{ Index: 2, Type: 'Subtitle' }] };
    const calls = { picks: 0, urls: 0, subs: 0 };
    const spike = {
        pickDownloadSource(playbackInfo) {
            calls.picks += 1;
            assert.ok(playbackInfo);
            return { kind: 'direct', mediaSource, resumable: true, warning: null };
        },
        buildMediaDownloadUrl(serverUrl, itemId, source) {
            calls.urls += 1;
            assert.equal(source, mediaSource);
            return `${serverUrl}/Videos/${itemId}/stream.mp4`;
        },
        selectDownloadSubtitles(source, opts) {
            calls.subs += 1;
            assert.equal(source, mediaSource);
            assert.deepEqual(opts.languages, ['eng']);
            return { sidecars: [2], burnInOnly: [] };
        },
        normalizeSubtitleExt() { return 'srt'; },
        buildSubtitleUrl(serverUrl, itemId, source, stream) {
            return `${serverUrl}/sub/${stream.Index}.srt`;
        }
    };
    const { api } = loadDownloadPlugin(spike);
    const plan = api.planFromPlayback({ MediaSources: [mediaSource] }, {
        serverUrl: 'http://srv:8096', itemId: 'item1', languages: ['eng']
    });

    assert.deepEqual(calls, { picks: 1, urls: 1, subs: 1 });
    assert.equal(plan.kind, 'direct');
    assert.equal(plan.url, 'http://srv:8096/Videos/item1/stream.mp4');
    assert.equal(plan.resumable, true);
    assert.equal(plan.expectedSize, 1234);
    assert.deepEqual(plain(plan.subtitles), [{ index: 2, ext: 'srt', url: 'http://srv:8096/sub/2.srt' }]);
    assert.deepEqual(plain(plan.burnInOnly), []);
    assert.equal(plan.warning, null);
});

test('planFromPlayback reports sources with nothing downloadable', () => {
    const spike = {
        pickDownloadSource() {
            return { kind: 'hls-only', mediaSource: null, resumable: false, warning: 'hls-only' };
        }
    };
    const { api } = loadDownloadPlugin(spike);
    const plan = api.planFromPlayback({ MediaSources: [] }, {});
    assert.equal(plan.url, null);
    assert.equal(plan.kind, 'hls-only');
    assert.equal(plan.warning, 'hls-only');
});

test('planFromPlayback throws without spike helpers', () => {
    const { api } = loadDownloadPlugin();
    assert.throws(() => api.planFromPlayback({}, {}), /downloadSpike helpers unavailable/);
});

test('default transport fails when the native bridge is missing', async () => {
    const { api } = loadDownloadPlugin();
    const queue = new api.DownloadQueue();
    const events = collectEvents(queue);
    const id = queue.enqueue({ url: 'http://x/a.mp4' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(plain(events.failed), [{ id, reason: 'unavailable' }]);
    assert.equal(queue.activeId(), null);
});

test('downloads settings section declares enabled and directory', () => {
    const sections = JSON.parse(readFileSync(new URL('../resources/settings/settings_description.json', import.meta.url), 'utf8'));
    const downloads = sections.find((section) => section.section === 'downloads');
    assert.ok(downloads);
    assert.equal(downloads.hidden, true);
    const byKey = Object.fromEntries(downloads.values.map((setting) => [setting.value, setting]));
    assert.equal(byKey.enabled.default, false);
    assert.equal(byKey.directory.default, '');
});
