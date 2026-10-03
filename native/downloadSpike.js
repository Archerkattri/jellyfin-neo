// Phase 0 offline spike (research_notes/offline-design.md section 10): prove the
// riskiest call — server-side download negotiation — before any queue, DB, or
// UI work lands. Pure negotiation/URL helpers plus one manual PlaybackInfo +
// ranged-byte probe. Phase 1 absorbs this into downloadPlugin.js and the C++
// DownloadComponent; until then this file has no UI and changes no behaviour.
(function() {
// Streamyfin download-profile template (design section 2): direct file first,
// progressive mp4 fallback, text subs as sidecars, image subs burn-in only.
const DOWNLOAD_AUDIO_CODECS = 'aac,mp3,ac3,eac3';

function getDownloadDeviceProfile(maxStreamingBitrate) {
    return {
        MaxStaticBitrate: 140000000,
        MaxStreamingBitrate: Number.isFinite(maxStreamingBitrate) ? maxStreamingBitrate : 140000000,
        DirectPlayProfiles: [
            { Container: 'mp4,m4v,mov,mkv,mka,avi,ts,mpegts,webm', Type: 'Video' },
            { Container: 'mp3,aac,m4a,m4b,flac,alac,wav,ogg,oga,opus', Type: 'Audio' }
        ],
        TranscodingProfiles: [
            {
                Container: 'mp4', Type: 'Video', VideoCodec: 'h264',
                AudioCodec: DOWNLOAD_AUDIO_CODECS, Protocol: 'http',
                EstimateContentLength: false, TranscodeSeekInfo: 'Auto', Context: 'Streaming'
            },
            {
                Container: 'mp3', Type: 'Audio', AudioCodec: 'mp3', Protocol: 'http',
                EstimateContentLength: false, TranscodeSeekInfo: 'Auto', Context: 'Streaming'
            }
        ],
        SubtitleProfiles: [
            { Format: 'srt', Method: 'External' },
            { Format: 'vtt', Method: 'External' },
            { Format: 'ass', Method: 'External' },
            { Format: 'ssa', Method: 'External' },
            { Format: 'pgssub', Method: 'Encode' },
            { Format: 'dvdsub', Method: 'Encode' },
            { Format: 'dvbsub', Method: 'Encode' }
        ]
    };
}

function isHlsUrl(url) {
    return typeof url === 'string' && /\.m3u8(\?|#|$)/.test(url);
}

// Design section 6 step 1: direct file preferred, else progressive transcode
// at the chosen bitrate. HLS-only sources cannot be downloaded (section 11).
function pickDownloadSource(playbackInfo) {
    const sources = playbackInfo && Array.isArray(playbackInfo.MediaSources)
        ? playbackInfo.MediaSources
        : [];
    const direct = sources.find(source => source && source.SupportsDirectPlay && !source.TranscodingUrl);
    if (direct) {
        return { kind: 'direct', mediaSource: direct, resumable: true, warning: null };
    }
    const progressive = sources.find(source => source && source.SupportsTranscoding &&
        source.TranscodingUrl && !isHlsUrl(source.TranscodingUrl));
    if (progressive) {
        return { kind: 'transcode', mediaSource: progressive, resumable: false, warning: 'no-resume' };
    }
    const hls = sources.find(source => source && source.TranscodingUrl && isHlsUrl(source.TranscodingUrl));
    if (hls) {
        return { kind: 'hls-only', mediaSource: hls, resumable: false, warning: 'hls-only' };
    }
    return { kind: 'none', mediaSource: null, resumable: false, warning: 'no-source' };
}

function serverBase(serverUrl) {
    return String(serverUrl).replace(/\/+$/, '');
}

function joinServerUrl(serverUrl, path) {
    if (typeof path === 'string' && /^https?:\/\//.test(path)) {
        return path;
    }
    return serverBase(serverUrl) + path;
}

function sanitizeContainer(container, fallback) {
    const cleaned = String(container || '').toLowerCase().split(/[^a-z0-9]+/)[0];
    return cleaned || fallback;
}

// Design section 2: Static direct-stream URLs honour Range (206) so they are
// seekable AND resumable; the legacy /Download route is the unnegotiated
// fallback. Auth always rides the header, never the URL.
function buildMediaDownloadUrl(serverUrl, itemId, mediaSource, mediaType) {
    const base = serverBase(serverUrl);
    if (mediaSource && mediaSource.TranscodingUrl) {
        return joinServerUrl(base, mediaSource.TranscodingUrl);
    }
    if (mediaSource && mediaSource.Id) {
        const isAudio = String(mediaType || '').toLowerCase() === 'audio';
        const container = sanitizeContainer(mediaSource.Container, isAudio ? 'mp3' : 'mp4');
        const route = isAudio ? 'Audio' : 'Videos';
        return `${base}/${route}/${itemId}/stream.${container}` +
            `?Static=true&mediaSourceId=${encodeURIComponent(mediaSource.Id)}`;
    }
    return `${base}/Items/${itemId}/Download`;
}

// mpv probes sidecar content, but consistent exts keep the fallback-URL
// construction working (design section 5).
function normalizeSubtitleExt(stream) {
    const codec = String((stream && (stream.Codec || stream.Format)) || '').toLowerCase();
    if (codec === 'subrip' || codec === 'srt') {
        return 'srt';
    }
    if (codec === 'webvtt' || codec === 'vtt') {
        return 'vtt';
    }
    if (/^[a-z0-9]{2,4}$/.test(codec)) {
        return codec;
    }
    return 'srt';
}

// Design section 7: ready DeliveryUrl verbatim, else the constructed
// /Subtitles fallback (Switchfin #250 pattern).
function buildSubtitleUrl(serverUrl, itemId, mediaSource, stream) {
    if (stream && stream.DeliveryMethod === 'External' && stream.DeliveryUrl) {
        return joinServerUrl(serverUrl, stream.DeliveryUrl);
    }
    const ext = normalizeSubtitleExt(stream);
    return `${serverBase(serverUrl)}/Videos/${itemId}/${mediaSource.Id}` +
        `/Subtitles/${stream.Index}/0/Stream.${ext}`;
}

// Default track + preferred languages become sidecars; Encode-only tracks
// (PGS/VOBSUB) have no sidecar, so report them for the explicit burn-in
// choice instead of silently dropping them (design section 7).
function selectDownloadSubtitles(mediaSource, options) {
    const opts = options || {};
    const languages = Array.isArray(opts.languages) ? opts.languages : [];
    const streams = mediaSource && Array.isArray(mediaSource.MediaStreams)
        ? mediaSource.MediaStreams.filter(stream => stream && stream.Type === 'Subtitle')
        : [];
    const defaultIndex = mediaSource ? mediaSource.DefaultSubtitleStreamIndex : null;
    const wanted = (stream) =>
        (opts.includeDefault !== false && stream.Index === defaultIndex) ||
        (typeof stream.Language === 'string' && languages.some(language =>
            String(language).toLowerCase() === stream.Language.toLowerCase()));
    const sidecars = [];
    const burnInOnly = [];
    for (const stream of streams) {
        if (!wanted(stream)) {
            continue;
        }
        if (stream.DeliveryMethod === 'Encode' || stream.IsTextSubtitleStream === false) {
            burnInOnly.push(stream.Index);
        } else {
            sidecars.push(stream.Index);
        }
    }
    return { sidecars, burnInOnly };
}

// The one manual fetch: negotiate PlaybackInfo with the download profile,
// then request a single ranged byte to prove resume works (206) or not.
async function probeDownloadPlan(args) {
    const opts = args || {};
    const fetchImpl = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!opts.serverUrl || !opts.itemId) {
        throw new Error('downloadSpike: serverUrl and itemId are required');
    }
    if (!fetchImpl) {
        throw new Error('downloadSpike: no fetch implementation available');
    }
    const headers = { 'Content-Type': 'application/json' };
    if (opts.token) {
        headers.Authorization = `MediaBrowser Token="${opts.token}"`;
    }
    const body = { UserId: opts.userId, DeviceProfile: getDownloadDeviceProfile(opts.maxStreamingBitrate) };
    // MediaSourceId must ride along with any stream-index override or the
    // server silently drops the index (design section 2).
    if (opts.mediaSourceId) {
        body.MediaSourceId = opts.mediaSourceId;
        if (opts.audioStreamIndex != null) {
            body.AudioStreamIndex = opts.audioStreamIndex;
        }
        if (opts.subtitleStreamIndex != null) {
            body.SubtitleStreamIndex = opts.subtitleStreamIndex;
        }
    }
    const base = serverBase(opts.serverUrl);
    const infoResponse = await fetchImpl(
        `${base}/Items/${opts.itemId}/PlaybackInfo?UserId=${encodeURIComponent(opts.userId || '')}`,
        { method: 'POST', headers, body: JSON.stringify(body) });
    if (!infoResponse.ok) {
        throw new Error(`downloadSpike: PlaybackInfo returned HTTP ${infoResponse.status}`);
    }
    const pick = pickDownloadSource(await infoResponse.json());
    if (!pick.mediaSource) {
        return {
            kind: pick.kind, url: null, resumable: false, rangeStatus: null,
            expectedSize: null, subtitles: [], burnInOnly: [], warning: pick.warning
        };
    }
    const url = buildMediaDownloadUrl(base, opts.itemId, pick.mediaSource, opts.mediaType);
    const rangeHeaders = { Range: 'bytes=0-0' };
    if (opts.token) {
        rangeHeaders.Authorization = headers.Authorization;
    }
    const rangeResponse = await fetchImpl(url, { headers: rangeHeaders });
    if (rangeResponse.body && typeof rangeResponse.body.cancel === 'function') {
        try {
            await rangeResponse.body.cancel();
        } catch (e) {
            // Single-byte probe: nothing to clean up on failure.
        }
    }
    const resumable = rangeResponse.status === 206;
    const selected = selectDownloadSubtitles(pick.mediaSource, opts);
    const subtitles = selected.sidecars.map(index => {
        const stream = pick.mediaSource.MediaStreams.find(candidate => candidate.Index === index);
        return { index, ext: normalizeSubtitleExt(stream), url: buildSubtitleUrl(base, opts.itemId, pick.mediaSource, stream) };
    });
    return {
        kind: pick.kind,
        url,
        resumable,
        rangeStatus: rangeResponse.status,
        expectedSize: pick.mediaSource.Size != null ? pick.mediaSource.Size : null,
        subtitles,
        burnInOnly: selected.burnInOnly,
        warning: pick.warning || (pick.kind === 'direct' && !resumable ? 'range-rejected' : null)
    };
}

window._downloadSpike = {
    getDownloadDeviceProfile,
    pickDownloadSource,
    buildMediaDownloadUrl,
    normalizeSubtitleExt,
    buildSubtitleUrl,
    selectDownloadSubtitles,
    probeDownloadPlan
};
})();
