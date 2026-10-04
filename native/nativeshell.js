// Upstream #175: HOTAS and throttle quadrants expose Gamepad API axes that
// jellyfin-web polls, causing unwanted seeking. Neutralize the API when the
// user disables it; enabled by default so gamepads keep working.
if (jmpInfo.settings?.main?.enableWebGamepad === false &&
    typeof navigator !== 'undefined' && navigator) {
    try {
        Object.defineProperty(navigator, 'getGamepads', {
            value: () => [],
            configurable: true
        });
    } catch (e) {
        navigator.getGamepads = () => [];
    }
}

const features = [
    "filedownload",
    "displaylanguage",
    "htmlaudioautoplay",
    "htmlvideoautoplay",
    "externallinks",
    "clientsettings",
    "multiserver",
    "exitmenu",
    "remotecontrol",
    "fullscreenchange",
    "filedownload",
    "remotevideo",
    "displaymode",
    "screensaver",
    "fileinput"
];

const getPlugins = () => {
    const basePlugins = [
        'inputPlugin',
        'updatePlugin'
    ];

    const mpvEnabled = jmpInfo.settings?.main?.enableMPV !== false;
    if (mpvEnabled) {
        return [
            'mpvVideoPlayer',
            'mpvAudioPlayer',
            ...basePlugins
        ];
    }

    return basePlugins;
};

const plugins = getPlugins();

// Plugins are bundled, return class directly
for (const plugin of plugins) {
    window[plugin] = () => {
        return window["_" + plugin];
    };
}

window.NativeShell = {
    openUrl(url, target) {
        window.api.system.openExternalUrl(url);
    },

    downloadFile(downloadInfo) {
        window.api.system.openExternalUrl(downloadInfo.url);
    },

    openClientSettings() {
        showSettingsModal();
    },

    getPlugins() {
        return plugins;
    },

    listProfiles() {
        return new Promise(resolve => window.api.system.profileNames(resolve));
    },

    switchProfile(name) {
        return new Promise(resolve => window.api.system.switchProfile(name, resolve));
    }
};

// Phase 1 (Tier-1 web plugins): window.JellyfinDesktop host object. A single
// shared, inert-by-default surface for JS-only plugins, evaluated once right
// after window.NativeShell so it exists before any plugin script appended
// after nativeshell at DocumentCreation/MainWorld: version info, an events
// wrapper over window.api signals, read-only settings (+ change
// subscription), and the allowlisted host entry point. Every method degrades
// to a safe no-op when window.api is unavailable, and the plugin context
// stays null until a manifest passes window._validatePluginManifest
// (fail-closed; the validator lives in native/pluginManifest.js and is wired
// in by the loader lane -- never reimplemented here). Tier-2 adds two host
// verbs (host.showToast, host.nowPlaying); still no capability checks, no
// WebChannel publishing, no signatures.
if (typeof window.JellyfinDesktop === 'undefined') {
    try {
        window.JellyfinDesktop = (() => {
            const API_VERSION = 1;
            const subscriptions = [];
            const context = { id: null, version: null };

            function apiObject(name) {
                if (typeof name !== 'string' || !window.api) {
                    return undefined;
                }
                return window.api[name];
            }

            function findSubscription(objectName, signalName, callback) {
                return subscriptions.findIndex(entry => (
                    entry.objectName === objectName
                    && entry.signalName === signalName
                    && entry.callback === callback
                ));
            }

            // Tier-2 now-playing cache: fed lazily from window.api.player
            // signals (the same metadata/position/state the JS notify* calls
            // push into PlayerComponent), so host.nowPlaying() degrades to
            // null when the bridge is unavailable.
            const nowPlayingCache = {
                title: null,
                artist: null,
                album: null,
                mediaType: null,
                state: null,
                positionMs: null,
                durationMs: null
            };
            let nowPlayingSubscribed = false;
            const activeToasts = [];

            function resetNowPlaying() {
                nowPlayingCache.title = null;
                nowPlayingCache.artist = null;
                nowPlayingCache.album = null;
                nowPlayingCache.mediaType = null;
                nowPlayingCache.state = null;
                nowPlayingCache.positionMs = null;
                nowPlayingCache.durationMs = null;
            }

            function hasNowPlayingData() {
                return nowPlayingCache.title !== null
                    || nowPlayingCache.state !== null
                    || nowPlayingCache.positionMs !== null
                    || nowPlayingCache.durationMs !== null;
            }

            function onNowPlayingMetadata(metadata) {
                try {
                    if (!metadata || typeof metadata !== 'object') {
                        return;
                    }
                    if (typeof metadata.Name === 'string' && metadata.Name.length > 0) {
                        nowPlayingCache.title = metadata.Name;
                    }
                    if (Array.isArray(metadata.Artists) && metadata.Artists.length > 0) {
                        nowPlayingCache.artist = String(metadata.Artists[0]);
                    } else if (typeof metadata.AlbumArtist === 'string' && metadata.AlbumArtist.length > 0) {
                        nowPlayingCache.artist = metadata.AlbumArtist;
                    }
                    if (typeof metadata.Album === 'string' && metadata.Album.length > 0) {
                        nowPlayingCache.album = metadata.Album;
                    }
                    if (typeof metadata.MediaType === 'string' && metadata.MediaType.length > 0) {
                        nowPlayingCache.mediaType = metadata.MediaType;
                    }
                } catch (e) {
                    // Cache updates never throw into signal delivery.
                }
            }

            function ensureNowPlayingSubscription() {
                if (nowPlayingSubscribed) {
                    return;
                }
                const player = apiObject('player');
                if (!player) {
                    return;
                }
                const wires = [
                    ['metadataChanged', onNowPlayingMetadata],
                    ['playbackStateChanged', state => { nowPlayingCache.state = String(state); }],
                    ['positionChanged', ms => { if (typeof ms === 'number') { nowPlayingCache.positionMs = ms; } }],
                    ['durationChanged', ms => { if (typeof ms === 'number') { nowPlayingCache.durationMs = ms; } }],
                    ['playbackStopped', () => { resetNowPlaying(); }]
                ];
                let wired = false;
                for (const [signalName, handler] of wires) {
                    try {
                        const signal = player[signalName];
                        if (signal && typeof signal.connect === 'function') {
                            signal.connect((...args) => {
                                try {
                                    handler(...args);
                                } catch (e) {
                                    console.error('JellyfinDesktop now-playing handler failed:', e);
                                }
                            });
                            wired = true;
                        }
                    } catch (e) {
                        // Missing signals are fine; retry on the next call.
                    }
                }
                nowPlayingSubscribed = wired;
            }

            function removeToast(element) {
                try {
                    const index = activeToasts.indexOf(element);
                    if (index !== -1) {
                        activeToasts.splice(index, 1);
                    }
                    if (element && typeof element.remove === 'function') {
                        element.remove();
                    }
                } catch (e) {
                    // Best-effort cleanup.
                }
            }

            return {
                apiVersion: API_VERSION,
                appVersion: (() => {
                    try {
                        return jmpInfo && typeof jmpInfo.version === 'string' ? jmpInfo.version : '';
                    } catch (e) {
                        return '';
                    }
                })(),
                get pluginId() {
                    return context.id;
                },
                plugin: {
                    get id() {
                        return context.id;
                    },
                    get version() {
                        return context.version;
                    },
                    // Opaque in Phase 1: Tier-1 plugins get no file access and
                    // per-plugin data dirs are owned by the loader lane.
                    get dataDir() {
                        return null;
                    }
                },
                events: {
                    on(objectName, signalName, callback) {
                        try {
                            if (typeof objectName !== 'string' || typeof signalName !== 'string'
                                    || typeof callback !== 'function') {
                                return false;
                            }
                            const target = apiObject(objectName);
                            const signal = target ? target[signalName] : undefined;
                            if (!signal || typeof signal.connect !== 'function') {
                                return false;
                            }
                            if (findSubscription(objectName, signalName, callback) !== -1) {
                                return true;
                            }
                            const wrapped = (...args) => {
                                try {
                                    callback(...args);
                                } catch (e) {
                                    console.error('JellyfinDesktop event handler failed:', e);
                                }
                            };
                            signal.connect(wrapped);
                            subscriptions.push({ objectName, signalName, callback, wrapped });
                            return true;
                        } catch (e) {
                            return false;
                        }
                    },
                    off(objectName, signalName, callback) {
                        try {
                            const index = findSubscription(objectName, signalName, callback);
                            if (index === -1) {
                                return false;
                            }
                            const [entry] = subscriptions.splice(index, 1);
                            const target = apiObject(objectName);
                            const signal = target ? target[signalName] : undefined;
                            if (signal && typeof signal.disconnect === 'function') {
                                signal.disconnect(entry.wrapped);
                            }
                            return true;
                        } catch (e) {
                            return false;
                        }
                    }
                },
                settings: {
                    get(section, key) {
                        try {
                            if (typeof section !== 'string' || typeof key !== 'string') {
                                return undefined;
                            }
                            const group = jmpInfo && jmpInfo.settings ? jmpInfo.settings[section] : undefined;
                            return group ? group[key] : undefined;
                        } catch (e) {
                            return undefined;
                        }
                    },
                    onChange(callback) {
                        try {
                            if (typeof callback !== 'function'
                                    || !jmpInfo || !Array.isArray(jmpInfo.settingsUpdate)) {
                                return () => {};
                            }
                            const wrapped = (section, data) => {
                                try {
                                    callback(section, data);
                                } catch (e) {
                                    console.error('JellyfinDesktop settings handler failed:', e);
                                }
                            };
                            jmpInfo.settingsUpdate.push(wrapped);
                            return () => {
                                const index = jmpInfo.settingsUpdate.indexOf(wrapped);
                                if (index !== -1) {
                                    jmpInfo.settingsUpdate.splice(index, 1);
                                }
                            };
                        } catch (e) {
                            return () => {};
                        }
                    }
                },
                host: {
                    openExternalUrl(url) {
                        try {
                            if (typeof url !== 'string' || url.length === 0) {
                                return false;
                            }
                            const system = apiObject('system');
                            if (!system || typeof system.openExternalUrl !== 'function') {
                                return false;
                            }
                            system.openExternalUrl(url);
                            return true;
                        } catch (e) {
                            return false;
                        }
                    },
                    log(...args) {
                        try {
                            if (context.id) {
                                console.log('[plugin:' + context.id + ']', ...args);
                            } else {
                                console.log(...args);
                            }
                            return true;
                        } catch (e) {
                            return false;
                        }
                    },
                    // Tier-2: in-page toast notification. Renders a small
                    // overlay (textContent only, never innerHTML); at most 3
                    // concurrent toasts, oldest dismissed first. options:
                    // { durationMs } auto-dismiss delay, 0 keeps it sticky.
                    showToast(title, message, options) {
                        try {
                            if (typeof title !== 'string' || title.length === 0
                                    || typeof message !== 'string' || message.length === 0) {
                                return false;
                            }
                            if (typeof document === 'undefined' || !document
                                    || typeof document.createElement !== 'function') {
                                return false;
                            }
                            const parent = document.body || document.documentElement;
                            if (!parent || typeof parent.appendChild !== 'function') {
                                return false;
                            }
                            const durationMs = options && typeof options.durationMs === 'number'
                                && options.durationMs >= 0 ? options.durationMs : 4000;
                            while (activeToasts.length >= 3) {
                                removeToast(activeToasts[0]);
                            }
                            const toast = document.createElement('div');
                            toast.setAttribute('data-plugin-toast', context.id || '');
                            toast.style.position = 'fixed';
                            toast.style.left = '16px';
                            toast.style.bottom = '16px';
                            toast.style.zIndex = '10000';
                            toast.style.maxWidth = '320px';
                            toast.style.padding = '10px 14px';
                            toast.style.borderRadius = '6px';
                            toast.style.background = 'rgba(20, 20, 26, 0.92)';
                            toast.style.color = '#ffffff';
                            toast.style.fontSize = '13px';
                            const heading = document.createElement('div');
                            heading.textContent = title;
                            heading.style.fontWeight = 'bold';
                            heading.style.marginBottom = '2px';
                            const body = document.createElement('div');
                            body.textContent = message;
                            toast.appendChild(heading);
                            toast.appendChild(body);
                            parent.appendChild(toast);
                            activeToasts.push(toast);
                            if (durationMs > 0 && typeof setTimeout === 'function') {
                                setTimeout(() => { removeToast(toast); }, durationMs);
                            }
                            return true;
                        } catch (e) {
                            return false;
                        }
                    },
                    // Tier-2: now-playing info provider. Returns a snapshot
                    // { title, artist, album, mediaType, state, positionMs,
                    // durationMs } (unknown fields are null), or null when
                    // nothing has played yet / the bridge is unavailable.
                    nowPlaying() {
                        try {
                            ensureNowPlayingSubscription();
                            if (!hasNowPlayingData()) {
                                return null;
                            }
                            return {
                                title: nowPlayingCache.title,
                                artist: nowPlayingCache.artist,
                                album: nowPlayingCache.album,
                                mediaType: nowPlayingCache.mediaType,
                                state: nowPlayingCache.state,
                                positionMs: nowPlayingCache.positionMs,
                                durationMs: nowPlayingCache.durationMs
                            };
                        } catch (e) {
                            return null;
                        }
                    }
                },
                // Internal: loader/plugin bootstrap only. Records the calling
                // plugin's id/version after the shared manifest gate passes.
                _registerPlugin(manifest) {
                    try {
                        if (typeof window._validatePluginManifest !== 'function') {
                            return { ok: false, error: 'manifest validator unavailable' };
                        }
                        const result = window._validatePluginManifest(manifest);
                        if (!result || result.ok !== true) {
                            return { ok: false, error: result && result.error ? result.error : 'invalid manifest' };
                        }
                        context.id = result.manifest.id;
                        context.version = result.manifest.version;
                        return { ok: true, id: context.id, version: context.version };
                    } catch (e) {
                        return { ok: false, error: String(e && e.message ? e.message : e) };
                    }
                }
            };
        })();
        // Tier-1 prose name for host.log; same allowlisted entry point.
        window.JellyfinDesktop.host.jsLog = window.JellyfinDesktop.host.log;
    } catch (e) {
        console.error('JellyfinDesktop host init failed:', e);
    }
}

function getDeviceProfile() {
    const CodecProfiles = [];

    // HDR preference overrides the Dolby Vision force-transcode flag: preferring
    // HDR10 excludes DOVI so the server sends HDR10/SDR, preferring Dolby Vision
    // lets DOVI through. Auto keeps the force-transcode flag behavior.
    const hdrPreference = jmpInfo.settings.video.hdr_preference;
    const excludeDovi = hdrPreference === 'hdr10'
        ? true
        : hdrPreference === 'dovi'
            ? false
            : Boolean(jmpInfo.settings.video.force_transcode_dovi);
    if (excludeDovi) {
        CodecProfiles.push({
            'Type': 'Video',
            'Conditions': [
                {
                    'Condition': 'NotEquals',
                    'Property': 'VideoRangeType',
                    'Value': 'DOVI'
                }
            ]
        });
    }

    if (jmpInfo.settings.video.force_transcode_hdr) {
        CodecProfiles.push({
            'Type': 'Video',
            'Conditions': [
                {
                    'Condition': 'Equals',
                    'Property': 'VideoRangeType',
                    'Value': 'SDR'
                }
            ]
        });
    }

    if (jmpInfo.settings.video.force_transcode_hi10p) {
        CodecProfiles.push({
            'Type': 'Video',
            'Conditions': [
                {
                    'Condition': 'LessThanEqual',
                    'Property': 'VideoBitDepth',
                    'Value': '8',
                }
            ]
        });
    }

    if (jmpInfo.settings.video.force_transcode_hevc) {
        CodecProfiles.push({
            'Type': 'Video',
            'Codec': 'hevc',
            'Conditions': [
                {
                    'Condition': 'Equals',
                    'Property': 'Width',
                    'Value': '0',
                }
            ],
        });
        CodecProfiles.push({
            'Type': 'Video',
            'Codec': 'h265',
            'Conditions': [
                {
                    'Condition': 'Equals',
                    'Property': 'Width',
                    'Value': '0',
                }
            ],
        });
    }

    if (jmpInfo.settings.video.force_transcode_av1) {
        CodecProfiles.push({
            'Type': 'Video',
            'Codec': 'av1',
            'Conditions': [
                {
                    'Condition': 'Equals',
                    'Property': 'Width',
                    'Value': '0',
                }
            ],
        });
    }

    if (jmpInfo.settings.video.force_transcode_4k) {
        CodecProfiles.push({
            'Type': 'Video',
            'Conditions': [
                {
                    'Condition': 'LessThanEqual',
                    'Property': 'Width',
                    'Value': '1920',
                },
                {
                    'Condition': 'LessThanEqual',
                    'Property': 'Height',
                    'Value': '1080',
                }
            ]
        });
    }

    const DirectPlayProfiles = [{ 'Type': 'Audio' }, { 'Type': 'Photo' }];

    if (!jmpInfo.settings.video.always_force_transcode) {
        DirectPlayProfiles.push({ 'Type': 'Video' });
    }

    const profile = {
        'Name': 'Jellyfin Desktop',
        'MaxStaticBitrate': 1000000000,
        'MusicStreamingTranscodingBitrate': 1280000,
        'TimelineOffsetSeconds': 5,
        'TranscodingProfiles': [
            { 'Type': 'Audio' },
            {
                'Container': 'ts',
                'Type': 'Video',
                'Protocol': 'hls',
                'AudioCodec': 'aac,mp3,ac3,opus,vorbis',
                'VideoCodec': jmpInfo.settings.video.allow_transcode_to_hevc
                    ? (
                        jmpInfo.settings.video.prefer_transcode_to_h265
                            ? 'h265,hevc,h264,mpeg4,mpeg2video'
                            : 'h264,h265,hevc,mpeg4,mpeg2video'
                    )
                    : 'h264,mpeg4,mpeg2video',
                'MaxAudioChannels': jmpInfo.settings.audio.channels === "2.0" ? '2' : '6'
            },
            { 'Container': 'jpeg', 'Type': 'Photo' }
        ],
        DirectPlayProfiles,
        'ResponseProfiles': [],
        'ContainerProfiles': [],
        CodecProfiles,
        'SubtitleProfiles': [
            { 'Format': 'srt', 'Method': 'External' },
            { 'Format': 'ass', 'Method': 'External' },
            { 'Format': 'sub', 'Method': 'External' },
            { 'Format': 'ssa', 'Method': 'External' },
            { 'Format': 'smi', 'Method': 'External' },
            { 'Format': 'pgssub', 'Method': 'Embed' },
            { 'Format': 'dvdsub', 'Method': 'Embed' },
            { 'Format': 'dvbsub', 'Method': 'Embed' },
            { 'Format': 'pgs', 'Method': 'Embed' }
        ]
    };

    // Optional user cap on transcoded video bitrate. When unset (Auto),
    // the key is omitted so the server default applies.
    const maxStreamingBitrate = Number(jmpInfo.settings.video.max_streaming_bitrate);
    if (Number.isFinite(maxStreamingBitrate) && maxStreamingBitrate > 0) {
        profile.MaxStreamingBitrate = Math.round(maxStreamingBitrate);
    }

    return profile;
}

async function createApi() {
    // Can't append script until document exists
    await new Promise(resolve => {
        document.addEventListener('DOMContentLoaded', resolve);
    });

    const channel = await new Promise((resolve) => {
        /*global QWebChannel */
        new QWebChannel(window.qt.webChannelTransport, resolve);
    });
    return channel.objects;
}

const sectionsFromStorage = window.sessionStorage.getItem('sections');
if (sectionsFromStorage) {
    jmpInfo.sections = JSON.parse(sectionsFromStorage);
}

let rawSettings = {};
Object.assign(rawSettings, jmpInfo.settings);
const settingsFromStorage = window.sessionStorage.getItem('settings');
if (settingsFromStorage) {
    rawSettings = JSON.parse(settingsFromStorage);
    Object.assign(jmpInfo.settings, rawSettings);
}

const settingsDescriptionsFromStorage = window.sessionStorage.getItem('settingsDescriptions');
if (settingsDescriptionsFromStorage) {
    jmpInfo.settingsDescriptions = JSON.parse(settingsDescriptionsFromStorage);
}

jmpInfo.settingsDescriptionsUpdate = [];
jmpInfo.settingsUpdate = [];
window.apiPromise = createApi();
window.initCompleted = new Promise(async (resolve) => {
    window.api = await window.apiPromise;

    // Runtime settings (such as audio devices and displays) can gain options
    // before the WebChannel is ready. Refresh after connecting so those early
    // updates aren't lost, and so sessionStorage can't keep stale descriptions.
    const currentDescriptions = await new Promise(descriptionResolve => {
        window.api.settings.settingDescriptions(descriptionResolve);
    });
    jmpInfo.settingsDescriptions = {};
    for (const section of currentDescriptions) {
        jmpInfo.settingsDescriptions[section.key] = section.settings;
    }
    window.sessionStorage.setItem("settingsDescriptions", JSON.stringify(jmpInfo.settingsDescriptions));

    const settingUpdate = (section, key) => (
        (data) => new Promise(resolve => {
            rawSettings[section][key] = data;
            window.sessionStorage.setItem("settings", JSON.stringify(rawSettings));
            window.api.settings.setValue(section, key, data, resolve);
        })
    );
    const setSetting = (section, key) => {
        Object.defineProperty(jmpInfo.settings[section], key, {
            set: settingUpdate(section, key),
            get: () => rawSettings[section][key]
        });
    };
    for (const settingGroup of Object.keys(rawSettings)) {
        jmpInfo.settings[settingGroup] = {};
        for (const setting of Object.keys(rawSettings[settingGroup])) {
            setSetting(settingGroup, setting, jmpInfo.settings[settingGroup][setting]);
        }
    }
    window.api.settings.sectionValueUpdate.connect(
        (section, data) => {
            Object.assign(rawSettings[section], data);
            for (const callback of jmpInfo.settingsUpdate) {
                try {
                    callback(section, data);
                } catch (e) {
                    console.error("Update handler failed:", e);
                }
            }

            // Settings will be outdated if page reloads, so save them to session storage
            window.sessionStorage.setItem("settings", JSON.stringify(rawSettings));
        }
    );
    window.api.settings.groupUpdate.connect(
        (section, data) => {
            jmpInfo.settingsDescriptions[section] = data.settings;
            for (const callback of jmpInfo.settingsDescriptionsUpdate) {
                try {
                    callback(section, data);
                } catch (e) {
                    console.error("Description update handler failed:", e);
                }
            }

            // Settings will be outdated if page reloads, so save them to session storage
            window.sessionStorage.setItem("settingsDescriptions", JSON.stringify(jmpInfo.settingsDescriptions));
        }
    );

    // Jellyfin Web owns cursor visibility in TV mode. Desktop-mode video
    // playback uses the native fullscreen idle timer instead.
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.attributeName === 'class') {
                if (jmpInfo.mode === 'tv') {
                    const isIdle = document.body.classList.contains('mouseIdle');
                    window.api.window.setCursorVisibility(!isIdle);
                }
            }
        }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    window.addEventListener('mousemove', () => {
        if (window.api && window.api.window && window.api.window.resetCursorIdleTimer) {
            window.api.window.resetCursorIdleTimer();
        }
    }, { passive: true });

    resolve();
});

window.NativeShell.AppHost = {
    init() {
        return Promise.resolve({
            deviceName: jmpInfo.deviceName,
            appName: "Jellyfin Desktop",
            appVersion: jmpInfo.version
        });
    },
    getDefaultLayout() {
        return jmpInfo.mode;
    },
    supports(command) {
        return features.includes(command.toLowerCase());
    },
    getDeviceProfile,
    getSyncProfile: getDeviceProfile,
    appName() {
        return "Jellyfin Desktop";
    },
    appVersion() {
        return jmpInfo.version;
    },
    deviceName() {
        return jmpInfo.deviceName;
    },
    exit() {
        window.api.system.exit();
    }
};

async function showSettingsModal() {
    await initCompleted;

    const tooltipCSS = `
        .tooltip {
            position: relative;
            display: inline-block;
            margin-left: 0.5rem;
            font-size: 18px;
            vertical-align: sub;
        }

        .tooltip .tooltip-text {
            visibility: hidden;
            width: max-content;
            max-width: 40em;
            background-color: black;
            color: white;
            text-align: left;
            position: absolute;
            z-index: 1;
            border-radius: 6px;
            padding: 5px;
            top: -4px;
            left: 25px;
            border: solid 1px grey;
            font-size: 12px;
        }

        .tooltip:hover .tooltip-text {
            visibility: visible;
        }`;

    var style = document.createElement('style')
    style.innerText = tooltipCSS
    document.head.appendChild(style)

    const modalContainer = document.createElement("div");
    modalContainer.className = "dialogContainer";
    modalContainer.style.backgroundColor = "rgba(0,0,0,0.5)";
    modalContainer.addEventListener("click", e => {
        if (e.target == modalContainer) {
            modalContainer.remove();
        }
    });
    document.body.appendChild(modalContainer);

    const modalContainer2 = document.createElement("div");
    modalContainer2.className = "focuscontainer dialog dialog-fixedSize dialog-small formDialog opened";
    modalContainer.appendChild(modalContainer2);

    const modalHeader = document.createElement("div");
    modalHeader.className = "formDialogHeader";
    modalContainer2.appendChild(modalHeader);

    const title = document.createElement("h3");
    title.className = "formDialogHeaderTitle";
    title.textContent = "Client Settings";
    modalHeader.appendChild(title);

    const modalContents = document.createElement("div");
    modalContents.className = "formDialogContent smoothScrollY";
    modalContents.style.paddingTop = "2em";
    modalContents.style.marginBottom = "6.2em";
    modalContainer2.appendChild(modalContents);

    const settingUpdateHandlers = {};
    for (const sectionOrder of jmpInfo.sections.sort((a, b) => a.order - b.order)) {
        const section = sectionOrder.key;
        const group = document.createElement("fieldset");
        group.className = "editItemMetadataForm editMetadataForm dialog-content-centered";
        group.style.border = 0;
        group.style.outline = 0;
        modalContents.appendChild(group);

        const createSection = async (clear) => {
            if (clear) {
                group.innerHTML = "";
            }

            const values = jmpInfo.settings[section];
            const settings = jmpInfo.settingsDescriptions[section];

            const legend = document.createElement("legend");
            const legendHeader = document.createElement("h2");
            legendHeader.textContent = section;
            legendHeader.style.textTransform = "capitalize";
            legend.appendChild(legendHeader);
            if (section == "other") {
                const legendSubHeader = document.createElement("h4");
                legendSubHeader.textContent = "Use this section to input custom MPV configuration. These will override the above settings.";
                legend.appendChild(legendSubHeader);
            }
            group.appendChild(legend);

            for (const setting of settings) {
                const label = document.createElement("label");
                label.className = "inputContainer";
                label.style.marginBottom = "1.8em";
                label.style.display = "block";

                let helpElement;
                if (setting.help) {
                    helpElement = document.createElement("div");
                    helpElement.className = "tooltip";
                    const helpIcon = document.createElement("span");
                    helpIcon.style.fontSize = "18px"
                    helpIcon.className = "material-icons help_outline";
                    helpElement.appendChild(helpIcon);
                    const tooltipElement = document.createElement("span");
                    tooltipElement.className = "tooltip-text";
                    tooltipElement.innerText = setting.help;
                    helpElement.appendChild(tooltipElement);
                }

                if (setting.options) {
                    const safeValues = {};
                    const control = document.createElement("select");
                    control.className = "emby-select-withcolor emby-select";
                    for (const option of setting.options) {
                        safeValues[String(option.value)] = option.value;
                        const opt = document.createElement("option");
                        opt.value = option.value;
                        opt.selected = option.value == values[setting.key];
                        let optionName = option.title;
                        const swTest = `${section}.${setting.key}.`;
                        const swTest2 = `${section}.`;
                        if (optionName.startsWith(swTest)) {
                            optionName = optionName.substring(swTest.length);
                        } else if (optionName.startsWith(swTest2)) {
                            optionName = optionName.substring(swTest2.length);
                        }
                        opt.appendChild(document.createTextNode(optionName));
                        control.appendChild(opt);
                    }
                    control.addEventListener("change", async (e) => {
                        jmpInfo.settings[section][setting.key] = safeValues[e.target.value];
                    });
                    const labelText = document.createElement('label');
                    labelText.className = "inputLabel";
                    labelText.textContent = (setting.displayName ? setting.displayName : setting.key) + ": ";
                    label.appendChild(labelText);
                    if (helpElement) label.appendChild(helpElement);
                    label.appendChild(control);
                } else if (setting.inputType === "textarea") {
                    const control = document.createElement("textarea");
                    control.className = "emby-select-withcolor emby-select";
                    control.style = "resize: none;"
                    control.value = values[setting.key];
                    control.rows = 5;
                    control.addEventListener("change", e => {
                        jmpInfo.settings[section][setting.key] = e.target.value;
                    });
                    const labelText = document.createElement('label');
                    labelText.className = "inputLabel";
                    labelText.textContent = (setting.displayName ? setting.displayName : setting.key) + ": ";
                    label.appendChild(labelText);
                    if (helpElement) label.appendChild(helpElement);
                    label.appendChild(control);
                } else {
                    const control = document.createElement("input");
                    const value = values[setting.key];
                    const isBoolean = typeof value === "boolean";
                    const isNumber = typeof value === "number";
                    control.type = isBoolean ? "checkbox" : (isNumber ? "number" : "text");

                    if (isBoolean) {
                        control.checked = value;
                    } else {
                        control.value = value == null ? "" : value;
                    }

                    control.addEventListener("change", e => {
                        const updatedValue = isBoolean
                            ? e.target.checked
                            : (isNumber ? Number(e.target.value) : e.target.value);
                        jmpInfo.settings[section][setting.key] = updatedValue;
                    });

                    const labelText = document.createElement('label');
                    labelText.className = "inputLabel";
                    labelText.textContent = (setting.displayName ? setting.displayName : setting.key) + ": ";
                    label.appendChild(labelText);
                    label.appendChild(control);
                    if (helpElement) label.appendChild(helpElement);
                }

                group.appendChild(label);
            }
        };
        settingUpdateHandlers[section] = () => createSection(true);
        createSection();
    }

    const onSectionUpdate = (section) => {
        if (section in settingUpdateHandlers) {
            settingUpdateHandlers[section]();
        }
    };
    jmpInfo.settingsDescriptionsUpdate.push(onSectionUpdate);
    jmpInfo.settingsUpdate.push(onSectionUpdate);

    if (jmpInfo.settings.main.userWebClient) {
        const group = document.createElement("fieldset");
        group.className = "editItemMetadataForm editMetadataForm dialog-content-centered";
        group.style.border = 0;
        group.style.outline = 0;
        modalContents.appendChild(group);
        const legend = document.createElement("legend");
        const legendHeader = document.createElement("h2");
        legendHeader.textContent = "Saved Server";
        legend.appendChild(legendHeader);
        const legendSubHeader = document.createElement("h4");
        legendSubHeader.textContent = (
            "The server you first connected to is your saved server. " +
            "It provides the web client for Jellyfin in the absence of a bundled one. " +
            "You can use this option to change it to another one. This does NOT log you off."
        );
        legend.appendChild(legendSubHeader);
        group.appendChild(legend);

        const resetSavedServer = document.createElement("button");
        resetSavedServer.className = "raised button-cancel block btnCancel emby-button";
        resetSavedServer.textContent = "Reset Saved Server"
        resetSavedServer.style.marginLeft = "auto";
        resetSavedServer.style.marginRight = "auto";
        resetSavedServer.style.maxWidth = "50%";
        resetSavedServer.addEventListener("click", async () => {
            window.jmpInfo.settings.main.userWebClient = '';
            window.location.href = jmpInfo.scriptPath + "/find-webclient.html";
        });
        group.appendChild(resetSavedServer);
    }

    const profileGroup = document.createElement("fieldset");
    profileGroup.className = "editItemMetadataForm editMetadataForm dialog-content-centered";
    profileGroup.style.border = 0;
    profileGroup.style.outline = 0;
    modalContents.appendChild(profileGroup);

    const profileLegend = document.createElement("legend");
    const profileHeader = document.createElement("h2");
    profileHeader.textContent = "Profiles";
    profileLegend.appendChild(profileHeader);
    const profileNames = await window.NativeShell.listProfiles();
    const activeProfile = await new Promise(resolve => window.api.system.activeProfileName(resolve));
    const profileSubHeader = document.createElement("h4");
    profileSubHeader.textContent = "Current profile: " + activeProfile + ". Switching restarts the app.";
    profileLegend.appendChild(profileSubHeader);
    profileGroup.appendChild(profileLegend);

    const profileLabel = document.createElement("label");
    profileLabel.className = "inputContainer";
    profileLabel.style.marginBottom = "1.8em";
    profileLabel.style.display = "block";
    const profileSelect = document.createElement("select");
    profileSelect.className = "emby-select-withcolor emby-select";
    for (const profileName of profileNames) {
        const profileOption = document.createElement("option");
        profileOption.value = profileName;
        profileOption.selected = profileName === activeProfile;
        profileOption.appendChild(document.createTextNode(profileName));
        profileSelect.appendChild(profileOption);
    }
    const profileLabelText = document.createElement("label");
    profileLabelText.className = "inputLabel";
    profileLabelText.textContent = "Switch to profile: ";
    profileLabel.appendChild(profileLabelText);
    profileLabel.appendChild(profileSelect);
    profileGroup.appendChild(profileLabel);

    const profileError = document.createElement("div");
    profileError.style.color = "#e05252";
    profileError.style.display = "none";
    profileGroup.appendChild(profileError);

    const switchProfileButton = document.createElement("button");
    switchProfileButton.className = "raised button-cancel block btnCancel emby-button";
    switchProfileButton.textContent = "Switch Profile";
    switchProfileButton.style.marginLeft = "auto";
    switchProfileButton.style.marginRight = "auto";
    switchProfileButton.style.maxWidth = "50%";
    switchProfileButton.addEventListener("click", async () => {
        profileError.style.display = "none";
        const switched = await window.NativeShell.switchProfile(profileSelect.value);
        if (!switched) {
            profileError.textContent = "Could not switch to profile: " + profileSelect.value;
            profileError.style.display = "block";
        }
    });
    profileGroup.appendChild(switchProfileButton);

    const closeContainer = document.createElement("div");
    closeContainer.className = "formDialogFooter";
    modalContents.appendChild(closeContainer);

    const close = document.createElement("button");
    close.className = "raised button-cancel block btnCancel formDialogFooterItem emby-button";
    close.textContent = "Close"
    close.addEventListener("click", () => {
        modalContainer.remove();
    });
    closeContainer.appendChild(close);
}

let lastFullscreenState = window.jmpInfo.settings.main.fullscreen;

window.jmpInfo.settingsUpdate.push(function(section) {
    if (section === 'main') {
        const currentFullscreenState = window.jmpInfo.settings.main.fullscreen;
        if (currentFullscreenState !== lastFullscreenState) {
            lastFullscreenState = currentFullscreenState;

            if (window.api && window.api.player) {
                window.api.player.notifyFullscreenChange(currentFullscreenState);
                console.log('Player fullscreen notified');
            }

            if (window.Events && window.playbackManager && window.playbackManager._currentPlayer) {
                window.Events.trigger(window.playbackManager._currentPlayer, 'fullscreenchange');
            }
        }
    }
});
