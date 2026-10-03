import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

function loadPlayer(sourcePath, globalName) {
    const calls = { volumes: [], audioTracks: [], secondarySubtitles: [], seeks: [], segmentUrls: [], events: [], settings: [] };
    const signalNames = [
        'playing', 'positionUpdate', 'finished', 'updateDuration', 'error', 'paused',
        'bufferedRangesUpdated', 'buffering', 'canceled', 'stopped', 'stateChanged',
        'videoPlaybackActive', 'windowVisible', 'onVideoRecangleChanged', 'onMetaData'
    ];
    const signals = Object.fromEntries(signalNames.map(name => [name, {
        listeners: new Set(),
        connect(listener) { this.listeners.add(listener); },
        disconnect(listener) { this.listeners.delete(listener); }
    }]));
    const window = {
        api: {
            player: Object.assign(signals, {
                setVolume(value) { calls.volumes.push(value); },
                setAudioStream(value) { calls.audioTracks.push(value); },
                setSecondarySubtitleStream(value) { calls.secondarySubtitles.push(value); },
                seekTo(value) { calls.seeks.push(value); }
            })
        },
        ApiClient: {
            getUrl(path) { calls.segmentUrls.push(path); return path; },
            getJSON() { return Promise.resolve({ Items: [] }); }
        },
        jmpInfo: { settings: { audio: { max_volume: 100 }, video: {} } }
    };
    const document = {
        elements: [],
        body: { children: [], appendChild(el) { this.children.push(el); } },
        createElement() {
            const element = { style: {}, remove() { element.removed = true; } };
            document.elements.push(element);
            return element;
        },
        addEventListener() {},
        removeEventListener() {}
    };
    const context = {
        window,
        jmpInfo: window.jmpInfo,
        document,
        setTimeout: () => 0,
        clearTimeout() {},
        console: { log() {}, debug() {}, warn() {}, error() {} }
    };
    runInNewContext(readFileSync(new URL(sourcePath, import.meta.url), 'utf8'), context);
    return { Player: window[globalName], calls, signals, window, document };
}

function loadDeviceProfile(videoSettings = {}) {
    // nativeshell.js touches window.jmpInfo at top level (fullscreen-state
    // tracker), so the mock window must carry the same jmpInfo object.
    const jmpInfo = { settings: { main: {}, video: { ...videoSettings }, audio: {} }, settingsUpdate: [] };
    const window = {
        sessionStorage: {
            getItem: () => null,
            setItem() {}
        },
        jmpInfo
    };
    const context = {
        window,
        jmpInfo,
        document: { addEventListener() {} },
        console: { log() {}, debug() {}, warn() {}, error() {} }
    };
    runInNewContext(readFileSync(new URL('../native/nativeshell.js', import.meta.url), 'utf8'), context);
    return context.getDeviceProfile();
}

function findSetting(sectionName, key) {
    const sections = JSON.parse(readFileSync(new URL('../resources/settings/settings_description.json', import.meta.url), 'utf8'));
    return sections.find(section => section.section === sectionName)?.values?.find(setting => setting.value === key);
}

function newVideoPlayer(Player, savedVolume = 1) {
    return new Player({
        events: { trigger() {} },
        loading: {},
        appRouter: {},
        globalize: {},
        appHost: {},
        appSettings: { get: () => savedVolume, set() {} },
        confirm: async () => {},
        dashboard: { default: { setBackdropTransparency() {} } }
    });
}

async function startFullscreenPlayback(fullscreen) {
    const { Player, window, document } = loadPlayer('../native/mpvVideoPlayer.js', '_mpvVideoPlayer');
    const fullscreens = [];
    window.api.window = { setFullScreen(value) { fullscreens.push(value); } };
    window.api.player.stop = () => {};
    window.api.player.setVideoRectangle = () => {};
    window.jmpInfo.settings.main = { fullscreen };
    document.body.classList = { remove() {} };

    const player = Object.create(Player.prototype);
    player.setPictureInPictureEnabled = () => {};
    player.loading = { show() {}, hide() {} };
    player.resetSubtitleOffset = () => {};
    player.createMediaElement = async () => ({});
    player.setCurrentSrc = async () => {};
    player.resetVideoZoom = () => {};
    player.setTransparency = () => {};
    await player.play({ fullscreen: true });
    return { player, window, fullscreens };
}

test('video player skips enabled intro and delayed outro segments only once', () => {
    const { Player, calls, window } = loadPlayer('../native/mpvVideoPlayer.js', '_mpvVideoPlayer');
    const player = Object.create(Player.prototype);
    player._segments = [
        { id: 'intro', type: 'Intro', start: 30_000, end: 90_000 },
        { id: 'outro', type: 'Outro', start: 600_000, end: 660_000 }
    ];
    player._duration = 660_000;
    player._skippedSegments = new Set();
    window.jmpInfo.settings.video = {
        skip_intro: true,
        skip_outro: true,
        skip_outro_delay: 5
    };

    player.checkSegmentSkip(35_000);
    player.checkSegmentSkip(36_000);
    assert.deepEqual(calls.seeks, [90_000]);

    player.checkSegmentSkip(604_000);
    assert.deepEqual(calls.seeks, [90_000]);
    player.checkSegmentSkip(606_000);
    player.checkSegmentSkip(607_000);
    assert.deepEqual(calls.seeks, [90_000, 659_500]);
});

test('video player leaves disabled intros and nearly finished segments alone', () => {
    const { Player, calls, window } = loadPlayer('../native/mpvVideoPlayer.js', '_mpvVideoPlayer');
    const player = Object.create(Player.prototype);
    player._segments = [
        { id: 'intro', type: 'Intro', start: 30_000, end: 90_000 }
    ];
    player._duration = 660_000;
    player._skippedSegments = new Set();

    window.jmpInfo.settings.video = { skip_intro: false, skip_outro: true };
    player.checkSegmentSkip(35_000);
    assert.deepEqual(calls.seeks, []);

    window.jmpInfo.settings.video = { skip_intro: true, skip_outro: false };
    player.checkSegmentSkip(89_500);
    assert.deepEqual(calls.seeks, []);
});

test('video player does not cap a new segment seek with the previous item duration', async () => {
    const { Player, calls, window } = loadPlayer('../native/mpvVideoPlayer.js', '_mpvVideoPlayer');
    const player = Object.create(Player.prototype);
    player._duration = 30_000;
    player._segments = [{ id: 'old-item', type: 'Intro', start: 5_000, end: 25_000 }];
    player._skippedSegments = new Set();
    player.resetSubtitleOffset = () => {};
    player.createMediaElement = async () => ({});
    player.setCurrentSrc = async () => {};

    await player.play({ fullscreen: false });
    assert.equal(player._duration, undefined);
    assert.equal(player._segments.length, 0);

    player._segments = [{ id: 'new-item', type: 'Intro', start: 30_000, end: 90_000 }];
    window.jmpInfo.settings.video = { skip_intro: true };
    player.checkSegmentSkip(35_000);
    assert.deepEqual(calls.seeks, [90_000]);
});

test('video player validates server segments and ignores a stale request failure', async () => {
    const { Player, calls, window } = loadPlayer('../native/mpvVideoPlayer.js', '_mpvVideoPlayer');
    const player = Object.create(Player.prototype);
    window.jmpInfo.settings.video = { skip_intro: true, skip_outro: false };
    player._currentPlayOptions = { item: { Id: 'item-1' } };

    window.ApiClient.getJSON = async () => ({ Items: [
        { Id: 'intro', Type: 'Intro', StartTicks: 30_000 * 10000, EndTicks: 90_000 * 10000 },
        { Id: 'bad-range', Type: 'Intro', StartTicks: 90_000 * 10000, EndTicks: 30_000 * 10000 },
        { Id: 'chapter', Type: 'Chapter', StartTicks: 0, EndTicks: 10_000 }
    ] });
    await player.loadMediaSegments({ item: { Id: 'item-1' } });
    assert.deepEqual(calls.segmentUrls, ['MediaSegments/item-1']);
    assert.deepEqual(JSON.parse(JSON.stringify(player._segments)), [
        { id: 'intro', type: 'Intro', start: 30_000, end: 90_000 }
    ]);

    let rejectRequest;
    window.ApiClient.getJSON = () => new Promise((resolve, reject) => { rejectRequest = reject; });
    const currentSegments = [{ id: 'new-item-intro', type: 'Intro', start: 1000, end: 5000 }];
    player._currentPlayOptions = { item: { Id: 'old-item' } };
    player._segments = currentSegments;
    const pending = player.loadMediaSegments({ item: { Id: 'old-item' } });
    player._currentPlayOptions = { item: { Id: 'new-item' } };
    rejectRequest(new Error('stale request failed'));
    await pending;
    assert.equal(player._segments, currentSegments);
});

function loadInputPlugin({ ready = false } = {}) {
    const calls = { commands: [], hostActions: [], hostInput: null, listeners: new Map(), removed: [], eventOff: [], eventHandlers: [] };
    const signal = {
        listeners: new Set(),
        connect(listener) { this.listeners.add(listener); },
        disconnect(listener) { this.listeners.delete(listener); }
    };
    const hostInput = {
        listeners: new Set(),
        connect(listener) { this.listeners.add(listener); calls.hostInput = listener; },
        disconnect(listener) { this.listeners.delete(listener); }
    };
    const api = {
        input: {
            hostInput,
            volumeChanged: signal,
            rateChanged: signal,
            positionSeek: signal,
            executeActions(actions) { calls.hostActions.push(actions); }
        },
        player: { playbackRateChanged: signal },
        system: { hello() {} }
    };
    const playbackManager = {
        getPlayerState() { return null; },
        currentTime() { return 0; }
    };
    const window = {
        jmpInfo: {
            settings: { main: { webMode: 'desktop', fullscreen: false } },
            settingsUpdate: []
        },
        Events: {
            on(object, name, handler) { calls.eventHandlers.push([object, name, handler]); },
            off(object, name, handler) {
                calls.eventOff.push([object, name, handler]);
                calls.eventHandlers = calls.eventHandlers.filter(([target, eventName, callback]) =>
                    target !== object || eventName !== name || callback !== handler);
            },
            trigger() {}
        },
        api: ready ? api : undefined,
        apiPromise: ready ? Promise.resolve(api) : new Promise(() => {}),
        addEventListener(type, listener) { calls.listeners.set(type, listener); },
        removeEventListener(type, listener) { calls.removed.push([type, listener]); }
    };
    const readyPromise = ready ? new Promise(resolve => setImmediate(resolve)) : Promise.resolve();
    const document = { querySelector: () => null };
    class HTMLElement {
        constructor(tagName, isContentEditable = false) {
            this.tagName = tagName;
            this.isContentEditable = isContentEditable;
        }
    }
    const context = {
        window,
        document,
        HTMLElement,
        setInterval,
        clearInterval,
        console: { log() {}, debug() {}, warn() {}, error() {} }
    };
    runInNewContext(readFileSync(new URL('../native/inputPlugin.js', import.meta.url), 'utf8'), context);
    const plugin = new window._inputPlugin({
        inputManager: { handleCommand: (...args) => calls.commands.push(args) },
        playbackManager
    });
    return { calls, document, HTMLElement, playbackManager, plugin, readyPromise, signal, hostInput, window };
}

function loadExternalNavigation() {
    const context = {};
    const source = readFileSync(new URL('../src/ui/ExternalNavigation.js', import.meta.url), 'utf8')
        .replace(/^\.pragma library\s*/m, '');
    runInNewContext(source, context);
    return context;
}

function loadUpdatePlugin({ currentVersion = '1.11.0', fetchImpl } = {}) {
    const calls = { fetches: [], checks: 0, confirmations: [], openedUrls: [], updateListener: null };
    const api = {
        system: {
            updateInfoEmitted: {
                connect(listener) { calls.updateListener = listener; }
            },
            checkForUpdates() { calls.checks++; },
            openExternalUrl(url) { calls.openedUrls.push(url); }
        }
    };
    const jmpInfo = { version: currentVersion };
    const window = { apiPromise: Promise.resolve(api) };
    const context = {
        window,
        jmpInfo,
        fetch: async (...args) => {
            calls.fetches.push(args);
            if (fetchImpl) return fetchImpl(...args);
            return {
                ok: true,
                status: 200,
                async json() {
                    return {
                        tag_name: 'v1.12.0',
                        html_url: 'https://github.com/Archerkattri/jellyfin-neo/releases/tag/v2.1.0',
                        draft: false,
                        prerelease: false
                    };
                }
            };
        },
        setTimeout(callback) { callback(); return 1; },
        console: { log() {}, debug() {}, warn(...args) { calls.warnings = args; }, error() {} }
    };
    runInNewContext(readFileSync(new URL('../native/updatePlugin.js', import.meta.url), 'utf8'), context);
    const plugin = new window._updatePlugin({
        confirm: async options => { calls.confirmations.push(options); }
    });
    const readyPromise = new Promise(resolve => setImmediate(resolve));
    return { calls, plugin, readyPromise };
}

function loadServerPicker({ savedServer = '', connectivityCheck } = {}) {
    const calls = { cancel: 0, connectivity: [], documentListeners: new Map() };
    const elements = new Map();

    class FakeElement {
        constructor() {
            this.attributes = new Map();
            this.listeners = new Map();
            this.classNames = new Set();
            this.classList = {
                add: name => this.classNames.add(name),
                remove: name => this.classNames.delete(name),
                toggle: (name, force) => {
                    if (force) this.classNames.add(name);
                    else this.classNames.delete(name);
                    return force;
                },
                contains: name => this.classNames.has(name)
            };
            this.dataset = {};
            this.value = '';
            this.textContent = '';
            this.innerText = '';
            this.hidden = false;
            this.disabled = false;
            this.focused = false;
        }
        addEventListener(type, listener) { this.listeners.set(type, listener); }
        setAttribute(name, value) { this.attributes.set(name, String(value)); }
        getAttribute(name) { return this.attributes.get(name) ?? null; }
        focus() { this.focused = true; }
    }

    for (const id of ['title', 'address-label', 'address-help', 'address', 'connect-form', 'connect-button', 'connection-status', 'spinner']) {
        elements.set(id, new FakeElement());
    }
    elements.get('connect-button').setAttribute('data-original-text', 'Connect');

    const document = {
        getElementById(id) { return elements.get(id); },
        addEventListener(type, listener) { calls.documentListeners.set(type, listener); },
        removeEventListener(type, listener) {
            if (calls.documentListeners.get(type) === listener) calls.documentListeners.delete(type);
        }
    };
    const window = {
        apiPromise: Promise.resolve(),
        api: { system: { cancelServerConnectivity() { calls.cancel++; } } },
        jmpInfo: { settings: { main: { userWebClient: savedServer } } },
        jmpCheckServerConnectivity: async server => {
            calls.connectivity.push(server);
            return connectivityCheck ? connectivityCheck(server) : Promise.reject(new Error('offline'));
        },
        location: ''
    };
    window.jmpCheckServerConnectivity.abort = () => {};

    const context = {
        window,
        document,
        navigator: { language: 'en-US' },
        console: { log() {}, debug() {}, warn() {}, error() {} }
    };
    runInNewContext(readFileSync(new URL('../native/find-webclient.lang.js', import.meta.url), 'utf8'), context);
    runInNewContext(readFileSync(new URL('../native/find-webclient.js', import.meta.url), 'utf8'), context);

    return { calls, elements, window, ready: new Promise(resolve => setImmediate(resolve)) };
}

function keyEvent(key, overrides = {}, path = []) {
    return {
        key,
        defaultPrevented: false,
        repeat: false,
        isComposing: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        composedPath: () => path,
        preventDefault() { this.defaultPrevented = true; },
        ...overrides
    };
}

for (const [name, path, globalName] of [
    ['video', '../native/mpvVideoPlayer.js', '_mpvVideoPlayer'],
    ['audio', '../native/mpvAudioPlayer.js', '_mpvAudioPlayer']
]) {
    test(`${name} player normalizes playback volume to a finite integer`, () => {
        const { Player, calls } = loadPlayer(path, globalName);
        const player = Object.create(Player.prototype);
        const saved = new Map();
        player.appSettings = {
            set: (...args) => { calls.settings.push(args); saved.set(args[0], args[1]); },
            get: key => saved.get(key)
        };
        player.events = { trigger: (...args) => calls.events.push(args) };

        player.setVolume(57.99999999999999);
        assert.equal(player.getVolume(), 58);
        assert.deepEqual(calls.volumes, [58]);
        assert.deepEqual(calls.settings, [['volume', 0.58]]);

        player.setVolume(140, false);
        assert.equal(player.getVolume(), 100);
        player.setVolume(-5, false);
        assert.equal(player.getVolume(), 0);
        player.setVolume(0);
        assert.equal(player.getSavedVolume(), 0);
        assert.equal(calls.settings.at(-1)[1], 0);
        player.setVolume(Number.NaN, false);
        player.setVolume(Number.POSITIVE_INFINITY, false);
        assert.deepEqual(calls.volumes, [58, 100, 0, 0]);
    });

    test(`${name} player keeps optional boost out of reported volume`, () => {
        const { Player, calls, window } = loadPlayer(path, globalName);
        const player = Object.create(Player.prototype);
        player.appSettings = { set() {} };
        player.events = { trigger() {} };
        window.jmpInfo.settings.audio.max_volume = 200;

        player.setVolume(157.7);
        assert.equal(player._volume, 158);
        assert.equal(player.getVolume(), 100);
        assert.deepEqual(calls.volumes, [158]);

        window.jmpInfo.settings.audio.max_volume = 500;
        player.setVolume(300);
        assert.equal(player._volume, 200);
        player.volumeUp();
        assert.equal(player._volume, 200);
        player.setVolume(150, false);
        player.volumeUp();
        assert.equal(player._volume, 152);
        assert.equal(player.getVolume(), 100);
        player.volumeDown();
        assert.equal(player._volume, 150);
        assert.deepEqual(calls.volumes, [158, 200, 200, 150, 152, 150]);
    });
}

test('video player maps transcoded playback to its sole mpv audio track', () => {
    const { Player, calls } = loadPlayer('../native/mpvVideoPlayer.js', '_mpvVideoPlayer');
    const player = Object.create(Player.prototype);
    const playOptions = {
        playMethod: 'Transcode',
        mediaSource: {
            TranscodingUrl: '/videos/stream.m3u8',
            MediaStreams: [
                { Type: 'Audio', Index: 1 },
                { Type: 'Video', Index: 2 },
                { Type: 'Audio', Index: 3 }
            ]
        }
    };

    assert.equal(player.getAudioTrackIndex(playOptions, 3), 1);
    player._currentPlayOptions = playOptions;
    player.setAudioStreamIndex(3);
    assert.deepEqual(calls.audioTracks, [1]);
});

test('video player recognizes transcoding from the transcoding URL alone', () => {
    const { Player } = loadPlayer('../native/mpvVideoPlayer.js', '_mpvVideoPlayer');
    const player = Object.create(Player.prototype);
    const playOptions = {
        mediaSource: {
            TranscodingUrl: '/videos/stream.m3u8',
            MediaStreams: [
                { Type: 'Audio', Index: 1 },
                { Type: 'Audio', Index: 3 }
            ]
        }
    };

    assert.equal(player.getAudioTrackIndex(playOptions, 3), 1);
});

test('video player preserves relative stream mapping for direct play', () => {
    const { Player, calls } = loadPlayer('../native/mpvVideoPlayer.js', '_mpvVideoPlayer');
    const player = Object.create(Player.prototype);
    const playOptions = {
        playMethod: 'DirectPlay',
        mediaSource: {
            MediaStreams: [
                { Type: 'Audio', Index: 1 },
                { Type: 'Video', Index: 2 },
                { Type: 'Audio', Index: 3 }
            ]
        }
    };

    assert.equal(player.getAudioTrackIndex(playOptions, 3), 2);
    player._currentPlayOptions = playOptions;
    player.setAudioStreamIndex(3);
    assert.deepEqual(calls.audioTracks, [2]);
});

test('audio boost setting stays bounded to the native mpv ceiling', () => {
    const maxVolume = findSetting('audio', 'max_volume');

    assert.ok(maxVolume);
    assert.equal(maxVolume.default, 100);
    assert.deepEqual(maxVolume.possible_values.map(([value]) => value), [100, 125, 150, 200]);
});

test('string settings provide select options before runtime device discovery', () => {

    assert.deepEqual(findSetting('main', 'forceFSScreen')?.possible_values, [['', 'Default display']]);
    assert.deepEqual(findSetting('audio', 'device')?.possible_values, [['auto', 'Autoselect device']]);
});

test('AV sync mode defaults to resample to avoid stutter', () => {
    const syncMode = findSetting('video', 'sync_mode');

    assert.ok(syncMode);
    assert.equal(syncMode.default, 'display-resample');
    assert.deepEqual(syncMode.possible_values.map(([value]) => value), ['audio', 'display-resample', 'display-adrop']);
});

test('demuxer cache settings expose conservative network read-ahead defaults', () => {

    const backbuffer = findSetting('video', 'demuxer_backbuffer');
    assert.ok(backbuffer);
    assert.deepEqual(backbuffer.default, [
        { value: 10, platforms: ['oe_rpi'] },
        { value: 50 }
    ]);
    assert.deepEqual(backbuffer.possible_values.map(([value]) => value), [10, 25, 50, 100]);

    const readahead = findSetting('video', 'demuxer_readahead');
    assert.ok(readahead);
    assert.equal(readahead.default, 5);
    assert.deepEqual(readahead.possible_values.map(([value]) => value), [1, 5, 10, 20]);

    const playerSource = readFileSync(new URL('../src/player/PlayerComponent.cpp', import.meta.url), 'utf8');
    assert.match(playerSource, /SETTINGS_SECTION_VIDEO, "demuxer_backbuffer"/);
    assert.match(playerSource, /demuxer-max-back-bytes/);
    assert.match(playerSource, /SETTINGS_SECTION_VIDEO, "demuxer_readahead"/);
    assert.match(playerSource, /demuxer-readahead-secs/);
});

test('desktop device profile delivers text subtitles externally for subtitle-offset parity', () => {
    const profile = loadDeviceProfile();
    const methods = new Map(profile.SubtitleProfiles.map(entry => [entry.Format, entry.Method]));

    // jellyfin-web only offers the subtitle-offset option for external streams
    // (canHandleOffsetOnCurrentSubtitle), so text formats must not advertise Embed.
    for (const format of ['srt', 'ass', 'sub', 'ssa', 'smi']) {
        assert.equal(methods.get(format), 'External');
    }

    // Bitmap subtitles keep native mpv rendering from the container.
    for (const format of ['pgssub', 'dvdsub', 'dvbsub', 'pgs']) {
        assert.equal(methods.get(format), 'Embed');
    }
});

test('developer and CI Qt versions stay aligned on a single version source', () => {
    const windowsCommon = readFileSync(new URL('../dev/windows/common.bat', import.meta.url), 'utf8');
    const macCommon = readFileSync(new URL('../dev/macos/common.sh', import.meta.url), 'utf8');
    const windowsSetup = readFileSync(new URL('../dev/windows/setup.bat', import.meta.url), 'utf8');
    const macSetup = readFileSync(new URL('../dev/macos/setup.sh', import.meta.url), 'utf8');
    const windowsWorkflow = readFileSync(new URL('../.github/workflows/build-windows.yml', import.meta.url), 'utf8');
    const macWorkflow = readFileSync(new URL('../.github/workflows/build-macos.yml', import.meta.url), 'utf8');

    const windowsVersion = windowsCommon.match(/if not defined QT_VERSION set QT_VERSION=(\S+)/i)?.[1];
    const macVersion = macCommon.match(/QT_VERSION="\$\{QT_VERSION:-([^}]+)\}"/)?.[1];
    const windowsCiVersion = windowsWorkflow.match(/QT_VERSION:\s*"([^"]+)"/)?.[1];
    const macCiVersion = macWorkflow.match(/QT_VERSION:\s*"([^"]+)"/)?.[1];

    assert.ok(windowsVersion);
    assert.equal(macVersion, windowsVersion);
    assert.equal(windowsCiVersion, windowsVersion);
    assert.equal(macCiVersion, windowsVersion);
    // The macOS installer step consumes the top-level env (single version source).
    assert.match(macWorkflow, /version:\s*"\$\{\{\s*env\.QT_VERSION\s*\}\}"/);

    const aqtCommit = '8c3695d4a4e1ceabf6a74dc6c79681656dc6b74b';
    for (const installerConfig of [windowsSetup, macSetup, windowsWorkflow, macWorkflow]) {
        assert.match(installerConfig, new RegExp(`aqtinstall\\.git@${aqtCommit}`));
    }
});

test('Windows developer and CI builds use the same published mpv package pin', () => {
    const windowsCommon = readFileSync(new URL('../dev/windows/common.bat', import.meta.url), 'utf8');
    const windowsSetup = readFileSync(new URL('../dev/windows/setup.bat', import.meta.url), 'utf8');
    const windowsWorkflow = readFileSync(new URL('../.github/workflows/build-windows.yml', import.meta.url), 'utf8');

    const release = windowsCommon.match(/if not defined MPV_RELEASE set MPV_RELEASE=(\S+)/i)?.[1];
    const version = windowsCommon.match(/if not defined MPV_VERSION set MPV_VERSION=(\S+)/i)?.[1];

    assert.ok(release);
    assert.ok(version);
    assert.match(windowsWorkflow, new RegExp(`MPV_RELEASE: "${release}"`));
    assert.match(windowsWorkflow, new RegExp(`MPV_VERSION: "${version}"`));
    assert.match(windowsSetup, /curl --fail --location --retry 3/);
    assert.match(windowsWorkflow, /github\.com\/shinchiro\/mpv-winbuild-cmake\/releases\/download/);
});

test('desktop Escape and Backspace navigate once only when the page did not consume them', () => {
    const { calls } = loadInputPlugin();
    const listener = calls.listeners.get('keydown');

    for (const key of ['Escape', 'Backspace']) {
        const event = keyEvent(key);
        listener(event);
        assert.equal(event.defaultPrevented, true);
    }
    assert.deepEqual(calls.commands.map(([command]) => command), ['back', 'back']);
    assert.equal(calls.commands.every(([, options]) => Object.keys(options).length === 0), true);

    listener(keyEvent('Escape', { defaultPrevented: true }));
    listener(keyEvent('Backspace', { ctrlKey: true }));
    listener(keyEvent('Backspace', { repeat: true }));
    listener(keyEvent('Backspace', { isComposing: true }));
    assert.equal(calls.commands.length, 2);
});

test('desktop navigation preserves editing, dialogs, fullscreen, and non-desktop modes', () => {
    const { calls, document, HTMLElement, window } = loadInputPlugin();
    const listener = calls.listeners.get('keydown');

    listener(keyEvent('Backspace', {}, [new HTMLElement('INPUT')]));
    listener(keyEvent('Backspace', {}, [new HTMLElement('TEXTAREA')]));
    listener(keyEvent('Backspace', {}, [new HTMLElement('DIV', true)]));
    document.querySelector = () => ({ open: true });
    listener(keyEvent('Escape'));
    document.querySelector = () => null;
    window.jmpInfo.settings.main.fullscreen = true;
    listener(keyEvent('Escape'));
    window.jmpInfo.settings.main.fullscreen = false;
    window.jmpInfo.settings.main.webMode = 'tv';
    listener(keyEvent('Escape'));

    assert.equal(calls.commands.length, 0);
});

test('destroying input plugin removes its desktop navigation listener', () => {
    const { calls, plugin } = loadInputPlugin();
    const listener = calls.listeners.get('keydown');
    plugin.attachedPlayer = {};
    plugin.destroy();

    assert.deepEqual(calls.removed, [['keydown', listener]]);
    assert.equal(calls.eventOff.length, 0);
});

test('destroying input plugin disconnects native signals and settings callbacks', async () => {
    const { calls, plugin, readyPromise, signal, hostInput, window } = loadInputPlugin({ ready: true });
    await readyPromise;
    assert.ok(signal.listeners.size > 0);
    assert.equal(hostInput.listeners.size, 1);
    assert.equal(window.jmpInfo.settingsUpdate.length, 1);

    plugin.destroy();

    assert.equal(signal.listeners.size, 0);
    assert.equal(hostInput.listeners.size, 0);
    assert.equal(window.jmpInfo.settingsUpdate.length, 0);
    assert.equal(calls.eventHandlers.length, 0);
    assert.ok(calls.eventOff.every(([, , handler]) => typeof handler === 'function'));
});

test('input plugin removes only its playback event handlers', async () => {
    const { calls, playbackManager, plugin, readyPromise, window } = loadInputPlugin({ ready: true });
    await readyPromise;

    const unrelatedManagerHandler = () => {};
    const player = { getVolume() { return 50; } };
    const unrelatedPlayerHandler = () => {};
    window.Events.on(playbackManager, 'playbackstart', unrelatedManagerHandler);
    window.Events.on(player, 'timeupdate', unrelatedPlayerHandler);

    const playbackStart = calls.eventHandlers.find(([target, eventName]) =>
        target === playbackManager && eventName === 'playbackstart')[2];
    playbackStart({}, player);
    assert.ok(calls.eventHandlers.some(([target]) => target === player));

    plugin.destroy();

    assert.deepEqual(calls.eventHandlers.map(([, , handler]) => handler), [
        unrelatedManagerHandler, unrelatedPlayerHandler
    ]);
    assert.ok(calls.eventOff.every(([, , handler]) => typeof handler === 'function'));
});

test('video player disconnects diagnostic signals when destroyed', () => {
    const { Player, signals, window } = loadPlayer('../native/mpvVideoPlayer.js', '_mpvVideoPlayer');
    const player = Object.create(Player.prototype);
    const playerSignals = window.api.player;
    const regularSignalNames = [
        'playing', 'positionUpdate', 'finished', 'updateDuration', 'error', 'paused', 'bufferedRangesUpdated'
    ];
    const regularHandlers = {
        playing: 'onPlaying', positionUpdate: 'onTimeUpdate', finished: 'onEnded',
        updateDuration: 'onDuration', error: 'onError', paused: 'onPause',
        bufferedRangesUpdated: 'onBufferedRangesUpdated'
    };
    player.removeMediaDialog = () => {};
    player._bufferedRanges = [];
    player._hasConnection = true;
    for (const method of [
        'onPlaying', 'onTimeUpdate', 'onEnded', 'onDuration', 'onError', 'onPause', 'onBufferedRangesUpdated'
    ]) {
        player[method] = () => {};
    }
    for (const name of regularSignalNames) {
        playerSignals[name].connect(player[regularHandlers[name]]);
    }
    player._debugSignalHandlers = Object.entries(signals)
        .filter(([name, signal]) => !regularSignalNames.includes(name) && typeof signal.connect === 'function')
        .map(([name, signal]) => {
            const handler = () => {};
            signal.connect(handler);
            return [signal, handler];
        });

    player.destroy();

    assert.ok(Object.values(signals)
        .filter(signal => typeof signal.connect === 'function')
        .every(signal => signal.listeners.size === 0));
    assert.equal(player._debugSignalHandlers.length, 0);
});

test('host keyboard actions are dispatched back to the native app', async () => {
    const { calls, readyPromise } = loadInputPlugin({ ready: true });
    await readyPromise;

    calls.hostInput(['up', 'enter', 'host:toggleWebMode']);
    assert.deepEqual(calls.commands.map(([command]) => command), ['up', 'select']);
    assert.deepEqual(JSON.parse(JSON.stringify(calls.hostActions)), [['host:toggleWebMode']]);
});

test('update plugin reads stable releases from the CORS-enabled GitHub API', async () => {
    const { calls, readyPromise } = loadUpdatePlugin();
    await readyPromise;
    await calls.updateListener('SSL_UNAVAILABLE');

    assert.equal(calls.checks, 1);
    assert.equal(calls.fetches.length, 1);
    assert.equal(calls.fetches[0][0], 'https://api.github.com/repos/Archerkattri/jellyfin-neo/releases/latest');
    assert.equal(calls.fetches[0][1].credentials, 'omit');
    assert.equal(calls.confirmations.length, 1);
    assert.deepEqual(calls.openedUrls, ['https://github.com/Archerkattri/jellyfin-neo/releases/tag/v2.1.0']);
});

test('update plugin skips development builds and does not offer a downgrade', async () => {
    const development = loadUpdatePlugin({ currentVersion: '2.0.0-dev' });
    await development.readyPromise;
    await development.calls.updateListener('SSL_UNAVAILABLE');
    assert.equal(development.calls.fetches.length, 0);
    assert.equal(development.calls.confirmations.length, 0);

    const newerStable = loadUpdatePlugin({ currentVersion: '2.0.0' });
    await newerStable.readyPromise;
    await newerStable.calls.updateListener('https://github.com/Archerkattri/jellyfin-neo/releases/tag/v1.12.0');
    assert.equal(newerStable.calls.confirmations.length, 0);
    assert.equal(newerStable.calls.openedUrls.length, 0);
});

test('update plugin rejects release links outside the configured fork', async () => {
    const release = loadUpdatePlugin({
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            async json() {
                return {
                    tag_name: 'v2.2.0',
                    html_url: 'https://github.com/jellyfin/jellyfin-desktop/releases/tag/v2.2.0',
                    draft: false,
                    prerelease: false
                };
            }
        })
    });
    await release.readyPromise;
    await release.calls.updateListener('SSL_UNAVAILABLE');

    assert.equal(release.calls.confirmations.length, 0);
    assert.equal(release.calls.openedUrls.length, 0);
});

test('server picker labels its address field and announces connection failures', async () => {
    const { calls, elements, ready } = loadServerPicker();
    await ready;

    const address = elements.get('address');
    const form = elements.get('connect-form');
    address.value = '  media.example:8096  ';
    elements.get('address').listeners.get('input')();
    assert.equal(elements.get('connect-button').disabled, false);

    form.listeners.get('submit')({ preventDefault() {} });
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(calls.connectivity, ['http://media.example:8096']);
    assert.equal(elements.get('title').innerText, 'Connect to Server');
    assert.equal(elements.get('address-label').innerText, 'Server Address');
    assert.equal(elements.get('connection-status').hidden, false);
    assert.match(elements.get('connection-status').textContent, /unable to connect/i);
    assert.equal(elements.get('connection-status').dataset.state, 'error');
    assert.equal(elements.get('connect-button').textContent, 'Connect');
});

test('server picker cancels pending connections and ignores late success', async () => {
    let resolveCheck;
    const pendingCheck = new Promise(resolve => { resolveCheck = resolve; });
    const { calls, elements, window, ready } = loadServerPicker({ connectivityCheck: () => pendingCheck });
    await ready;

    const form = elements.get('connect-form');
    elements.get('address').value = 'https://media.example';
    form.listeners.get('submit')({ preventDefault() {} });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(form.dataset.state, 'connecting');
    assert.equal(elements.get('spinner').hidden, false);
    assert.equal(elements.get('connect-button').textContent, 'Cancel');
    form.listeners.get('submit')({ preventDefault() {} });
    assert.equal(calls.cancel, 1);
    assert.equal(form.dataset.state, 'idle');
    assert.equal(elements.get('spinner').hidden, true);

    resolveCheck('https://media.example/web/');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(window.location, '');
    assert.equal(window.jmpInfo.settings.main.userWebClient, '');
});

test('server picker styles stay responsive and honor reduced-motion preferences', () => {
    const html = readFileSync(new URL('../native/find-webclient.html', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../native/find-webclient.css', import.meta.url), 'utf8');

    assert.match(html, /<label id="address-label" for="address">/);
    assert.match(html, /aria-live="polite"/);
    assert.match(css, /@media \(max-width: 680px\)/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(css, /:focus-visible/);
});

test('new-window handling opens the requested user URL, not the last hovered link', () => {
    const navigation = loadExternalNavigation();
    const source = readFileSync(new URL('../src/ui/webview.qml', import.meta.url), 'utf8');
    const requestedUrl = 'https://jellyfin.org/docs/';

    assert.equal(navigation.userInitiatedRequestedUrl({
        userInitiated: true,
        requestedUrl: { toString: () => requestedUrl }
    }), requestedUrl);
    assert.equal(navigation.userInitiatedRequestedUrl({
        userInitiated: false,
        requestedUrl: { toString: () => 'https://popup.example/' }
    }), '');
    assert.equal(navigation.userInitiatedRequestedUrl({ userInitiated: true, requestedUrl: '' }), '');
    assert.match(source, /ExternalNavigation\.userInitiatedRequestedUrl\(request\)/);
    assert.doesNotMatch(source, /openExternalUrl\(web\.currentHoveredUrl\)/);
    assert.doesNotMatch(source, /currentHoveredUrl/);
});

test('macOS releases ad-hoc sign without secrets and fail only on partial signing secrets', () => {
    const macWorkflow = readFileSync(new URL('../.github/workflows/build-macos.yml', import.meta.url), 'utf8');
    const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');

    // Tagged builds must not hard-fail when no signing secrets are configured;
    // they warn and fall through to the dev ad-hoc signing path instead.
    assert.doesNotMatch(macWorkflow, /refs\/tags\/v/);
    assert.match(macWorkflow, /::warning::.*ad-hoc signed/);

    // A partial secret set is a misconfiguration and must still fail.
    assert.match(macWorkflow, /secrets are incomplete/);

    // The changelog must describe the actual three-state behavior.
    assert.match(changelog, /ad-hoc signed without notarization/);
    assert.match(changelog, /Developer ID signed and notarized/);
    assert.match(changelog, /only some of the signing secrets fails/);
});


test('window geometry save and restore use matching keys and defaults', () => {
    const source = readFileSync(new URL('../src/ui/WindowManager.cpp', import.meta.url), 'utf8');
    const header = readFileSync(new URL('../src/ui/WindowManager.h', import.meta.url), 'utf8');

    // Screen name must round-trip through one key: save writes screenNameKey(),
    // loadLastScreen must read that same key instead of a divergent literal.
    const screenKey = source.match(/screenNameKey\(\) const \{ return "([^"]+)"; \}/)?.[1];
    assert.ok(screenKey);
    assert.match(source, /QScreen\* WindowManager::loadLastScreen[\s\S]*?screenNameKey\(\)/);
    assert.doesNotMatch(source, /SETTINGS_SECTION_STATE, "lastusedscreen"/);
    assert.doesNotMatch(source, /"ScreenName"/);

    // "Unchanged" size must mean the default size, never the restored size:
    // comparing against the restored size deletes the saved keys on clean quit.
    assert.match(source, /sizeUnchanged = \(size == WEBUI_SIZE\)/);
    assert.doesNotMatch(source, /m_initial/);
    assert.doesNotMatch(header, /m_initial/);

    // Position save must refresh the current screen first so multi-monitor
    // moves persist instead of the stale startup screen.
    assert.match(source, /updateCurrentScreen\(\);\s*\n\s*m_windowedGeometry\.moveTo/);
});

test('video screenshot settings default to a configurable directory, name template, and format', () => {

    const directory = findSetting('video', 'screenshot.directory');
    const shotTemplate = findSetting('video', 'screenshot.template');
    const format = findSetting('video', 'screenshot.format');

    assert.ok(directory);
    assert.equal(directory.default, '');
    assert.ok(shotTemplate);
    assert.equal(shotTemplate.default, 'jellyfin-shot%n');
    assert.ok(format);
    assert.equal(format.default, 'png');
    assert.deepEqual(format.possible_values.map(([value]) => value), ['png', 'jpg', 'webp']);
});

test('keyboard map binds a key to the screenshot host command', () => {
    const raw = readFileSync(new URL('../resources/inputmaps/keyboard.json', import.meta.url), 'utf8');
    const stripped = raw.split('\n').filter(line => !line.trimStart().startsWith('//')).join('\n');
    const mapping = JSON.parse(stripped).mapping;

    assert.ok(Object.values(mapping).includes('host:screenshot'));
});

test('video player wheel steps true volume and reports the boosted level', () => {
    const { Player, calls, window, document } = loadPlayer('../native/mpvVideoPlayer.js', '_mpvVideoPlayer');
    window.jmpInfo.settings.audio.max_volume = 200;
    const player = newVideoPlayer(Player);
    player._volume = 150;
    player._videoDialog = {};

    player.onWheel({ deltaY: -120, preventDefault() {} });
    assert.equal(player._volume, 152);
    assert.equal(player.getVolume(), 100);
    assert.equal(document.elements.length, 1);
    assert.equal(document.elements[0].textContent, '152%');

    player.onWheel({ deltaY: 120, preventDefault() {} });
    assert.equal(player._volume, 150);
    assert.equal(document.elements.length, 1);
    assert.equal(document.elements[0].textContent, '150%');
    assert.deepEqual(calls.volumes, [152, 150]);
});

test('video player adds and removes the wheel listener with its media dialog', () => {
    const source = readFileSync(new URL('../native/mpvVideoPlayer.js', import.meta.url), 'utf8');

    assert.match(source, /document\.addEventListener\('wheel', this\.onWheel, \{ passive: false \}\)/);
    assert.match(source, /document\.removeEventListener\('wheel', this\.onWheel\)/);
});


function loadCursorBridge() {
    const calls = { resets: 0, listeners: new Map() };
    const jmpInfo = {
        mode: 'desktop',
        settings: { main: {}, video: {}, audio: {} },
        settingsUpdate: [],
        settingsDescriptionsUpdate: []
    };
    const api = {
        settings: {
            settingDescriptions(resolve) { resolve([]); },
            setValue() {},
            sectionValueUpdate: { connect() {} },
            groupUpdate: { connect() {} }
        },
        window: {
            setCursorVisibility() {},
            resetCursorIdleTimer() { calls.resets++; }
        }
    };
    const window = {
        qt: {},
        sessionStorage: { getItem: () => null, setItem() {} },
        addEventListener(type, listener, options) {
            calls.listeners.set(type, { listener, options });
        },
        jmpInfo
    };
    const context = {
        window,
        jmpInfo,
        document: {
            addEventListener(type, listener) {
                if (type === 'DOMContentLoaded') {
                    listener();
                }
            },
            body: { classList: { contains: () => false } }
        },
        MutationObserver: class {
            observe() {}
        },
        QWebChannel: function (transport, resolve) {
            resolve({ objects: api });
        },
        console: { log() {}, debug() {}, warn() {}, error() {} }
    };
    runInNewContext(readFileSync(new URL('../native/nativeshell.js', import.meta.url), 'utf8'), context);
    return { calls, ready: context.window.initCompleted, window: context.window };
}

test('mouse movement resets the native cursor idle timer', async () => {
    const { calls, ready, window } = loadCursorBridge();
    await ready;

    const mousemove = calls.listeners.get('mousemove');
    assert.ok(mousemove);
    assert.equal(mousemove.options.passive, true);

    mousemove.listener();
    assert.equal(calls.resets, 1);

    // Native builds without the reset slot must keep movement a safe no-op.
    window.api.window = {};
    mousemove.listener();
    assert.equal(calls.resets, 1);

    // Native side of the bridge: invokable slot feeding cursor activity.
    const header = readFileSync(new URL('../src/ui/WindowManager.h', import.meta.url), 'utf8');
    const source = readFileSync(new URL('../src/ui/WindowManager.cpp', import.meta.url), 'utf8');
    assert.match(header, /Q_INVOKABLE void resetCursorIdleTimer\(\);/);
    assert.match(source, /void WindowManager::resetCursorIdleTimer\(\)\r?\n\{\r?\n  handleCursorActivity\(\);/);
});


test('video player toggles picture-in-picture through the always-on-top bridge', () => {
    const { Player, window } = loadPlayer('../native/mpvVideoPlayer.js', '_mpvVideoPlayer');
    const player = Object.create(Player.prototype);
    const pinCalls = [];
    window.api.window = { setAlwaysOnTop(value) { pinCalls.push(value); } };
    player._currentSrc = 'https://media.example/stream.mkv';

    assert.equal(player.isPictureInPictureEnabled(), false);
    assert.equal(player.supports('PictureInPicture'), true);

    player.setPictureInPictureEnabled(true);
    assert.equal(player.isPictureInPictureEnabled(), true);
    assert.deepEqual(pinCalls, [true]);

    // Redundant enables must not re-pin the window.
    player.setPictureInPictureEnabled(true);
    assert.deepEqual(pinCalls, [true]);

    player.togglePictureInPicture();
    assert.equal(player.isPictureInPictureEnabled(), false);
    assert.deepEqual(pinCalls, [true, false]);
});

test('video player refuses picture-in-picture without playback and exits it on stop', () => {
    const { Player, window } = loadPlayer('../native/mpvVideoPlayer.js', '_mpvVideoPlayer');
    const player = Object.create(Player.prototype);
    const pinCalls = [];
    window.api.window = { setAlwaysOnTop(value) { pinCalls.push(value); } };
    player.events = { trigger() {} };

    // No active media: enabling is refused and never touches the bridge.
    player.setPictureInPictureEnabled(true);
    assert.equal(player.isPictureInPictureEnabled(), false);
    assert.deepEqual(pinCalls, []);

    // A missing native bridge degrades to state tracking instead of throwing.
    delete window.api.window;
    player._currentSrc = 'https://media.example/stream.mkv';
    player.setPictureInPictureEnabled(true);
    assert.equal(player.isPictureInPictureEnabled(), true);

    // Ending playback exits PiP and unpins the window.
    window.api.window = { setAlwaysOnTop(value) { pinCalls.push(value); } };
    player.onEndedInternal();
    assert.equal(player.isPictureInPictureEnabled(), false);
    assert.deepEqual(pinCalls, [false]);
    assert.equal(player._currentSrc, null);
});


test('video player maps secondary subtitle selection to mpv secondary-sid', () => {
    const { Player, calls } = loadPlayer('../native/mpvVideoPlayer.js', '_mpvVideoPlayer');
    const player = Object.create(Player.prototype);
    player._currentPlayOptions = {
        mediaSource: {
            MediaStreams: [
                { Type: 'Video', Index: 0 },
                { Type: 'Subtitle', Index: 1 },
                { Type: 'Subtitle', Index: 2 },
                { Type: 'Subtitle', Index: 3, IsExternal: true, DeliveryMethod: 'External', DeliveryUrl: 'http://example/subs.srt' }
            ]
        }
    };

    player.setSecondarySubtitleStreamIndex(2);
    assert.equal(player._secondarySubtitleTrackIndexToSetOnPlaying, 2);
    assert.deepEqual(calls.secondarySubtitles, [2]);

    player.setSecondarySubtitleStreamIndex(3);
    assert.deepEqual(calls.secondarySubtitles, [2, '#,http://example/subs.srt']);

    player.setSecondarySubtitleStreamIndex(-1);
    assert.deepEqual(calls.secondarySubtitles, [2, '#,http://example/subs.srt', -1]);
});

test('secondary subtitle position defaults near the top of the screen', () => {
    const secondaryPos = findSetting('subtitles', 'secondary_pos');

    assert.ok(secondaryPos);
    assert.equal(secondaryPos.default, 10);
    assert.deepEqual(secondaryPos.possible_values.map(([value]) => value), [5, 10, 25, 50]);
});

test('native player drives dual subtitles through mpv secondary-sid', () => {
    const componentSource = readFileSync(new URL('../src/player/PlayerComponent.cpp', import.meta.url), 'utf8');
    const componentHeader = readFileSync(new URL('../src/player/PlayerComponent.h', import.meta.url), 'utf8');

    assert.match(componentHeader, /setSecondarySubtitleStream/);
    assert.match(componentHeader, /SecondarySubtitle/);
    assert.match(componentSource, /secondary-sid/);
    assert.match(componentSource, /MediaType::SecondarySubtitle/);
    assert.match(componentSource, /secondary-sub-pos/);
    assert.match(componentSource, /SETTINGS_SECTION_SUBTITLES, "secondary_pos"/);
});


function loadNativeShellBridge() {
    const jmpInfo = { settings: { main: {}, video: {}, audio: {} }, settingsUpdate: [] };
    const window = {
        sessionStorage: {
            getItem: () => null,
            setItem() {}
        },
        jmpInfo,
        api: {
            system: {
                profileNames(callback) { callback(['Default', 'Kids']); },
                activeProfileName(callback) { callback('Default'); },
                switchProfile(name, callback) { callback(name === 'Kids'); }
            }
        }
    };
    const context = {
        window,
        jmpInfo,
        document: { addEventListener() {} },
        console: { log() {}, debug() {}, warn() {}, error() {} }
    };
    runInNewContext(readFileSync(new URL('../native/nativeshell.js', import.meta.url), 'utf8'), context);
    return window;
}

test('native shell bridges in-app profile switching to the system component', async () => {
    const window = loadNativeShellBridge();

    assert.deepEqual(await window.NativeShell.listProfiles(), ['Default', 'Kids']);
    assert.equal(await window.NativeShell.switchProfile('Kids'), true);
    assert.equal(await window.NativeShell.switchProfile('Gone'), false);
});

test('profile switch backend relaunches with the selected profile flag', () => {
    const header = readFileSync(new URL('../src/system/SystemComponent.h', import.meta.url), 'utf8');
    const source = readFileSync(new URL('../src/system/SystemComponent.cpp', import.meta.url), 'utf8');
    const shell = readFileSync(new URL('../native/nativeshell.js', import.meta.url), 'utf8');

    assert.match(header, /Q_INVOKABLE QStringList profileNames\(\) const;/);
    assert.match(header, /Q_INVOKABLE QString activeProfileName\(\) const;/);
    assert.match(header, /Q_INVOKABLE bool switchProfile\(const QString& name\);/);
    assert.match(source, /ProfileManager::profileByName\(name\)/);
    assert.match(source, /ProfileManager::setDefaultProfile\(\*profile\)/);
    assert.match(source, /QStringLiteral\("--profile"\) << name/);
    assert.match(source, /QProcess::startDetached/);
    assert.match(shell, /window\.NativeShell\.switchProfile\(profileSelect\.value\)/);
    assert.match(shell, /Switch Profile/);
});


test('KDE Wayland display switching stays gated with a platform fallback', () => {
    const component = readFileSync(new URL('../src/display/DisplayComponent.cpp', import.meta.url), 'utf8');
    const manager = readFileSync(new URL('../src/display/kde/DisplayManagerKDE.cpp', import.meta.url), 'utf8');
    const displayHeader = readFileSync(new URL('../src/display/DisplayManager.h', import.meta.url), 'utf8');

    // Runtime platform gate: the KDE manager is only attempted on Wayland sessions.
    assert.match(component, /platformName\(\) == "wayland"/);
    // Safe fallback: a failed KDE init deletes the manager so the platform chain below still runs.
    assert.match(component, /if \(!m_displayManager->initialize\(\)\)[\s\S]*?delete m_displayManager;[\s\S]*?m_displayManager = nullptr;/);
    // Wayland has no global window positions, so lookup goes through the window's screen.
    assert.match(component, /getDisplayFromWindow\(activeWindow\)/);
    assert.match(displayHeader, /virtual int getDisplayFromWindow\(QWindow\* window\);/);
    // Runtime protocol detection: bind only the registry version that enumerates outputs.
    assert.match(manager, /kde_output_device_registry_v2_interface\.name\) == 0 && version >= 21/);
    // Refuse mode switches when the protocols are absent or hotplug made indices stale.
    assert.match(manager, /if \(!m_display \|\| !m_queue \|\| !m_registry \|\| !m_management\)/);
    assert.match(manager, /m_privId >= static_cast<int>\(m_registry->m_devices\.size\(\)\)/);
});


test('Windows WebEngine GPU flags reach Chromium and preserve user flags', () => {
    const mainSource = readFileSync(new URL('../src/main.cpp', import.meta.url), 'utf8');
    const detectSource = readFileSync(new URL('../src/player/OpenGLDetect.cpp', import.meta.url), 'utf8');
    const detectHeader = readFileSync(new URL('../src/player/OpenGLDetect.h', import.meta.url), 'utf8');

    // --disable-gpu was accepted on the command line but never reached Chromium.
    assert.match(mainSource, /parser\.isSet\("disable-gpu"\)[\s\S]*?chromiumFlags << "--disable-gpu"/);
    // User-set QTWEBENGINE_CHROMIUM_FLAGS must survive the app's own flags.
    assert.match(mainSource, /qgetenv\("QTWEBENGINE_CHROMIUM_FLAGS"\)[\s\S]*?chromiumFlags\.prepend/);
    // The GL probe must run after early-exit CLI handling (so --help skips it)
    // but before Chromium flags are frozen and the QApplication exists.
    assert.ok(mainSource.indexOf('detectOpenGLEarly()') > mainSource.indexOf('QQuickWindow::setGraphicsApi'));
    assert.ok(mainSource.indexOf('detectOpenGLEarly()') < mainSource.indexOf('QStringList chromiumFlags'));
    // The WGL interop probe gates the software-compositing fallback on Windows.
    assert.match(detectSource, /wglDXOpenDeviceNV/);
    assert.match(detectHeader, /hasOpenGLDXInterop/);
    assert.match(mainSource, /hasOpenGLDXInterop\(\)[\s\S]*?--disable-gpu-compositing/);
});


test('HDMI bitstream passthrough defaults off and reaches mpv audio-spdif', () => {

    // Conservative default: the Basic device type disables passthrough, so
    // HDMI receivers get direct PCM until the user opts into bitstreaming.
    assert.equal(findSetting('audio', 'devicetype')?.default, 'basic');
    for (const codec of ['ac3', 'dts', 'eac3', 'dts-hd', 'truehd']) {
        assert.equal(findSetting('audio', `passthrough.${codec}`)?.default, false);
    }

    // TrueHD (Atmos) / DTS-HD (DTS:X) toggles stay available on PC HDMI;
    // only macOS and Pi builds exclude them.
    for (const codec of ['eac3', 'dts-hd', 'truehd']) {
        assert.deepEqual(findSetting('audio', `passthrough.${codec}`)?.platforms_excluded, ['osx', 'oe_rpi']);
    }

    const playerSource = readFileSync(new URL('../src/player/PlayerComponent.cpp', import.meta.url), 'utf8');
    const playerHeader = readFileSync(new URL('../src/player/PlayerComponent.h', import.meta.url), 'utf8');
    const audioCtlSource = readFileSync(new URL('../src/settings/AudioSettingsController.cpp', import.meta.url), 'utf8');

    // mpv gets the enabled codecs as its audio-spdif list, including the
    // object-audio carriers (Atmos rides TrueHD/E-AC3, DTS:X rides DTS-HD).
    assert.match(playerHeader, /AudioCodecsAll\(\) \{ return \{ "ac3", "dts", "eac3", "dts-hd", "truehd" \}; \};/);
    assert.match(playerSource, /audioSection->value\("passthrough\." \+ key\)\.toBool\(\)/);
    assert.match(playerSource, /m_mpv->setProperty\( "audio-spdif", passthroughCodecs\);/);

    // Wiring runs at mpv init and the HDMI device type reveals every codec.
    const initBody = playerSource.slice(
        playerSource.indexOf('void PlayerComponent::initializeMpv()'),
        playerSource.indexOf('void PlayerComponent::setVideoRectangle')
    );
    assert.ok(initBody.includes('setAudioConfiguration();'));
    assert.match(audioCtlSource, /AUDIO_DEVICE_TYPE_HDMI\)[\s\S]*?setHiddenPassthrough\(PlayerComponent::AudioCodecsAll\(\), false\)/);
});


test('gapless audio defaults on and reaches mpv without touching video queue', () => {
    const gapless = findSetting('audio', 'gapless');

    assert.ok(gapless);
    assert.equal(gapless.default, true);

    const playerSource = readFileSync(new URL('../src/player/PlayerComponent.cpp', import.meta.url), 'utf8');
    assert.match(playerSource, /SETTINGS_SECTION_AUDIO, "gapless"/);
    assert.match(playerSource, /gapless-audio/);
    // Video queue path keeps its stop-then-append shape: gapless-audio only
    // affects consecutive audio transitions, not loadfile video loads.
    assert.match(playerSource, /command << "append-play"/);
    assert.match(playerSource, /extraArgs \+= "vid=no,"/);
});



test('experimental HDR passthrough stays off unless explicitly enabled', () => {
    const passthrough = findSetting('video', 'hdr_passthrough');

    assert.ok(passthrough);
    assert.equal(passthrough.default, false);

    const playerSource = readFileSync(new URL('../src/player/PlayerComponent.cpp', import.meta.url), 'utf8');
    assert.match(playerSource, /SETTINGS_SECTION_VIDEO, "hdr_passthrough"/);
    assert.match(playerSource, /target-colorspace-hint/);
    assert.match(playerSource, /hdr-compute-peak/);
});


test('HDR playback diagnostics report the signal only when passthrough is on', () => {
    const playerSource = readFileSync(new URL('../src/player/PlayerComponent.cpp', import.meta.url), 'utf8');
    // Debug overlay reports the HDR signal mpv sees (peak/primaries/transfer).
    assert.match(playerSource, /video-params\/sig-peak/);
    assert.match(playerSource, /video-params\/primaries/);
    assert.match(playerSource, /video-params\/gamma/);
    // The playback diagnostic is gated on the experimental setting, so the
    // default-off path emits nothing new.
    const helper = playerSource.match(/void PlayerComponent::logHdrPlaybackDiagnostics\(\)[\s\S]*?\n}/);
    assert.ok(helper);
    assert.match(helper[0], /SETTINGS_SECTION_VIDEO, "hdr_passthrough"/);
    assert.match(helper[0], /return;/);
    // It runs when the video output is (re)configured for a playing file.
    assert.match(playerSource, /strcmp\(prop->name, "vo-configured"\)[\s\S]{0,500}?logHdrPlaybackDiagnostics\(\)/);
});



function loadNativeShellWithGamepad({ enableWebGamepad } = {}) {
    const main = {};
    if (enableWebGamepad !== undefined) main.enableWebGamepad = enableWebGamepad;
    const jmpInfo = { settings: { main, video: {}, audio: {} }, settingsUpdate: [] };
    const navigator = { getGamepads() { return ['throttle']; } };
    const window = {
        sessionStorage: {
            getItem: () => null,
            setItem() {}
        },
        jmpInfo,
        navigator
    };
    const context = {
        window,
        jmpInfo,
        navigator,
        document: { addEventListener() {} },
        console: { log() {}, debug() {}, warn() {}, error() {} }
    };
    runInNewContext(readFileSync(new URL('../native/nativeshell.js', import.meta.url), 'utf8'), context);
    return { navigator, window };
}

test('web gamepad can be disabled for HOTAS throttles without affecting the default', () => {
    const enabled = loadNativeShellWithGamepad({ enableWebGamepad: true });
    // JSON round-trip: arrays built inside the vm realm carry its Array prototype,
    // so compare them structurally like the host-action assertions do.
    const seen = (...navigators) => navigators.map(n => JSON.parse(JSON.stringify(n.getGamepads())));
    assert.deepEqual(seen(enabled.navigator), [['throttle']]);

    const absent = loadNativeShellWithGamepad();
    assert.deepEqual(seen(absent.navigator), [['throttle']]);

    const disabled = loadNativeShellWithGamepad({ enableWebGamepad: false });
    assert.deepEqual(seen(disabled.navigator), [[]]);
});

test('joystick and web gamepad settings are exposed with safe defaults', () => {

    const sdl = findSetting('main', 'sdlEnabled');
    assert.ok(sdl);
    assert.equal(sdl.default, true);
    assert.ok(!sdl.hidden);
    assert.ok(sdl.display_name);

    const webGamepad = findSetting('main', 'enableWebGamepad');
    assert.ok(webGamepad);
    assert.equal(webGamepad.default, true);
    assert.ok(!webGamepad.hidden);
    assert.ok(webGamepad.display_name);
});


test('playback options expose bitrate cap, external player, and HDR preference settings', () => {

    const bitrate = findSetting('video', 'max_streaming_bitrate');
    assert.ok(bitrate);
    assert.equal(bitrate.default, 0);
    assert.deepEqual(bitrate.possible_values.map(([value]) => value), [0, 80000000, 40000000, 20000000, 10000000, 4000000]);

    const external = findSetting('video', 'external_player');
    assert.ok(external);
    assert.equal(external.default, false);

    const hdr = findSetting('video', 'hdr_preference');
    assert.ok(hdr);
    assert.equal(hdr.default, 'auto');
    assert.deepEqual(hdr.possible_values.map(([value]) => value), ['auto', 'dovi', 'hdr10']);
});

test('device profile caps transcoded bitrate only when a cap is configured', () => {
    assert.equal('MaxStreamingBitrate' in loadDeviceProfile(), false);
    assert.equal('MaxStreamingBitrate' in loadDeviceProfile({ max_streaming_bitrate: 0 }), false);
    assert.equal(loadDeviceProfile({ max_streaming_bitrate: 20000000 }).MaxStreamingBitrate, 20000000);
});

test('device profile HDR preference overrides the Dolby Vision force-transcode flag', () => {
    const doviExcluded = profile => profile.CodecProfiles.some(entry =>
        (entry.Conditions || []).some(condition =>
            condition.Property === 'VideoRangeType' && condition.Value === 'DOVI'));

    assert.equal(doviExcluded(loadDeviceProfile()), false);
    assert.equal(doviExcluded(loadDeviceProfile({ force_transcode_dovi: true })), true);
    assert.equal(doviExcluded(loadDeviceProfile({ force_transcode_dovi: true, hdr_preference: 'dovi' })), false);
    assert.equal(doviExcluded(loadDeviceProfile({ hdr_preference: 'hdr10' })), true);
    assert.equal(doviExcluded(loadDeviceProfile({ hdr_preference: 'auto' })), false);
});

test('video player hands the stream URL to the system player when enabled', async () => {
    const { Player, window } = loadPlayer('../native/mpvVideoPlayer.js', '_mpvVideoPlayer');
    const player = Object.create(Player.prototype);
    const opened = [];
    window.api.system = { openExternalUrl(url) { opened.push(url); } };
    window.jmpInfo.settings.video = { external_player: true };

    await player.setCurrentSrc({}, { url: 'https://media.example/videos/1/stream.mkv' });
    assert.deepEqual(opened, ['https://media.example/videos/1/stream.mkv']);
    assert.equal(player._currentSrc, 'https://media.example/videos/1/stream.mkv');
});

test('video player source keeps the in-app load path beside the external handoff', () => {
    const source = readFileSync(new URL('../native/mpvVideoPlayer.js', import.meta.url), 'utf8');

    assert.match(source, /jmpInfo\.settings\.video\.external_player/);
    assert.match(source, /window\.api\.system\.openExternalUrl\(val\)/);
    assert.match(source, /player\.load\(val,/);
});


test('video player remembers manual audio and subtitle picks per series', () => {
    const { Player, calls, window } = loadPlayer('../native/mpvVideoPlayer.js', '_mpvVideoPlayer');
    const player = Object.create(Player.prototype);
    const saved = new Map();
    player.appSettings = {
        set: (...args) => { calls.settings.push(args); saved.set(args[0], args[1]); },
        get: key => saved.get(key)
    };
    player._started = true;
    player._currentPlayOptions = {
        item: { Id: 'episode-1', SeriesId: 'series-1' },
        mediaSource: {
            MediaStreams: [
                { Type: 'Audio', Index: 1, Language: 'eng' },
                { Type: 'Audio', Index: 2, Language: 'jpn' },
                { Type: 'Subtitle', Index: 3, Language: 'eng' }
            ]
        }
    };
    const subtitleTracks = [];
    window.api.player.setSubtitleStream = value => subtitleTracks.push(value);

    player.setAudioStreamIndex(2);
    assert.deepEqual(calls.audioTracks, [2]);
    assert.equal(saved.get('mpv-series-audio-series-1'), 'jpn');

    player.setSubtitleStreamIndex(3);
    assert.deepEqual(subtitleTracks, [1]);
    assert.equal(saved.get('mpv-series-subtitle-series-1'), 'eng');

    player.setSubtitleStreamIndex(-1);
    assert.deepEqual(subtitleTracks, [1, -1]);
    assert.equal(saved.get('mpv-series-subtitle-series-1'), 'off');

    // Programmatic defaults applied before the first frame are not remembered.
    const writes = calls.settings.length;
    player._started = false;
    player.setAudioStreamIndex(1);
    assert.equal(calls.settings.length, writes);

    // Items outside a series keep the server default.
    player._started = true;
    player._currentPlayOptions = { item: { Id: 'movie-1' }, mediaSource: { MediaStreams: [] } };
    player.setAudioStreamIndex(1);
    assert.equal(calls.settings.length, writes);
});

test('video player reapplies remembered per-series languages on the next episode', async () => {
    const { Player, window } = loadPlayer('../native/mpvVideoPlayer.js', '_mpvVideoPlayer');
    const player = Object.create(Player.prototype);
    const saved = new Map([
        ['mpv-series-audio-series-1', 'jpn'],
        ['mpv-series-subtitle-series-1', 'off']
    ]);
    player.appSettings = { get: key => saved.get(key), set: (key, value) => saved.set(key, value) };
    const loads = [];
    window.api.player.load = (...args) => { loads.push(args); args[args.length - 1](); };

    const options = {
        url: 'https://media.example/episode-2.mkv',
        item: { Id: 'episode-2', SeriesId: 'series-1' },
        mediaSource: {
            DefaultAudioStreamIndex: 1,
            DefaultSubtitleStreamIndex: 3,
            MediaStreams: [
                { Type: 'Video', Index: 0 },
                { Type: 'Audio', Index: 1, Language: 'eng' },
                { Type: 'Audio', Index: 2, Language: 'jpn' },
                { Type: 'Subtitle', Index: 3, Language: 'eng' }
            ]
        }
    };

    await player.setCurrentSrc({}, options);
    assert.equal(player._audioTrackIndexToSetOnPlaying, 2);
    assert.equal(player._subtitleTrackIndexToSetOnPlaying, -1);
    assert.equal(loads.length, 1);
    assert.equal(loads[0][3], 2);
    assert.equal(loads[0][4], -1);

    // Unknown languages fall back to the server default tracks.
    saved.set('mpv-series-audio-series-1', 'fre');
    saved.delete('mpv-series-subtitle-series-1');
    await player.setCurrentSrc({}, options);
    assert.equal(player._audioTrackIndexToSetOnPlaying, 1);
    assert.equal(player._subtitleTrackIndexToSetOnPlaying, 3);
});

test('Windows CI and developer scripts keep a usable ARM64 job', () => {
    const windowsWorkflow = readFileSync(new URL('../.github/workflows/build-windows.yml', import.meta.url), 'utf8');
    const windowsCommon = readFileSync(new URL('../dev/windows/common.bat', import.meta.url), 'utf8');

    // Qt publishes no native win64_msvc2022_arm64 package; the job must use the
    // cross-compiled arch on a native ARM64 runner (ARM64 Qt tools cannot run on x64).
    assert.match(windowsWorkflow, /artifact: windows-arm64/);
    assert.match(windowsWorkflow, /qt_arch: win64_msvc2022_arm64_cross_compiled/);
    assert.match(windowsWorkflow, /runs_on: windows-11-arm/);
    assert.match(windowsWorkflow, /runs-on: \$\{\{ matrix\.runs_on \}\}/);
    assert.match(windowsWorkflow, /vcvars: vcvarsarm64\.bat/);
    assert.match(windowsWorkflow, /mpv_arch: aarch64/);
    assert.doesNotMatch(windowsWorkflow, /qt_arch: win64_msvc2022_arm64\r?\n/);

    // Local scripts expose the same arch selection.
    assert.match(windowsCommon, /WINARCH/);
    assert.match(windowsCommon, /win64_msvc2022_arm64_cross_compiled/);
    assert.match(windowsCommon, /MPV_ARCH=aarch64/);
    assert.match(windowsCommon, /vcvarsarm64\.bat/);
});

test('media title is shown on the mpv OSD when title metadata arrives', () => {
    const playerSource = readFileSync(new URL('../src/player/PlayerComponent.cpp', import.meta.url), 'utf8');
    const handler = playerSource.slice(
        playerSource.indexOf('void PlayerComponent::notifyMetadata'),
        playerSource.indexOf('void PlayerComponent::notifyVolumeChange')
    );

    assert.ok(handler.includes('metadataChanged'));
    assert.match(handler, /metadata\.value\("Name"\)/);
    assert.match(handler, /"show-text"/);
});


function loadUpdatePluginWithRelease({ release, systemFlags = {}, userAgent = '' }) {
    const opened = [];
    const confirmed = [];
    let updateHandler = null;
    const jmpInfo = { version: '2.1.0', userAgent };
    const window = {
        apiPromise: Promise.resolve({
            system: {
                ...systemFlags,
                updateInfoEmitted: { connect(handler) { updateHandler = handler; } },
                checkForUpdates() {},
                openExternalUrl(url) { opened.push(url); }
            }
        }),
        jmpInfo
    };
    const context = {
        window,
        jmpInfo,
        fetch: async () => ({ ok: true, json: async () => release }),
        setTimeout: (fn) => { fn(); return 0; },
        clearTimeout() {},
        console: { log() {}, debug() {}, warn() {}, error() {} }
    };
    runInNewContext(readFileSync(new URL('../native/updatePlugin.js', import.meta.url), 'utf8'), context);
    const Plugin = window._updatePlugin;
    new Plugin({ confirm: async (options) => { confirmed.push(options); } });
    return {
        opened,
        confirmed,
        trigger: async () => {
            for (let i = 0; i < 20 && !updateHandler; i++) await new Promise(resolve => setImmediate(resolve));
            assert.ok(updateHandler, 'update plugin connected to updateInfoEmitted');
            await updateHandler('SSL_UNAVAILABLE');
        }
    };
}

function updateRelease(overrides = {}) {
    return {
        tag_name: 'v2.2.0',
        html_url: 'https://github.com/Archerkattri/jellyfin-neo/releases/tag/v2.2.0',
        draft: false,
        prerelease: false,
        assets: [],
        ...overrides
    };
}

test('update plugin downloads the single matching installer asset directly', async () => {
    const exeUrl = 'https://github.com/Archerkattri/jellyfin-neo/releases/download/v2.2.0/JellyfinDesktop-2.2.0-x64.exe';
    const windows = loadUpdatePluginWithRelease({
        release: updateRelease({ assets: [
            { name: 'JellyfinDesktop-2.2.0-x64.exe', browser_download_url: exeUrl },
            { name: 'JellyfinDesktop-2.2.0-x64.zip', browser_download_url: 'https://github.com/Archerkattri/jellyfin-neo/releases/download/v2.2.0/JellyfinDesktop-2.2.0-x64.zip' }
        ] }),
        systemFlags: { isWindows: true, isMacos: false, isLinux: false },
        userAgent: 'JellyfinDesktop/2.1.0 (Windows; x86_64) Chrome/131.0.0.0'
    });
    await windows.trigger();
    assert.equal(windows.confirmed.length, 1);
    assert.deepEqual(windows.opened, [exeUrl]);

    // Native platform flags missing (older shell): fall back to the user agent.
    const dmgUrl = 'https://github.com/Archerkattri/jellyfin-neo/releases/download/v2.2.0/JellyfinDesktop-2.2.0-arm64.dmg';
    const mac = loadUpdatePluginWithRelease({
        release: updateRelease({ assets: [
            { name: 'JellyfinDesktop-2.2.0-arm64.dmg', browser_download_url: dmgUrl }
        ] }),
        userAgent: 'JellyfinDesktop/2.1.0 (Darwin; arm64) Chrome/131.0.0.0'
    });
    await mac.trigger();
    assert.deepEqual(mac.opened, [dmgUrl]);
});

test('update plugin falls back to the release page for ambiguous or Linux assets', async () => {
    // x64 and arm64 installers: the local arch is unknown, so do not guess.
    const release = updateRelease({ assets: [
        { name: 'JellyfinDesktop-2.2.0-x64.exe', browser_download_url: 'https://github.com/Archerkattri/jellyfin-neo/releases/download/v2.2.0/JellyfinDesktop-2.2.0-x64.exe' },
        { name: 'JellyfinDesktop-2.2.0-arm64.exe', browser_download_url: 'https://github.com/Archerkattri/jellyfin-neo/releases/download/v2.2.0/JellyfinDesktop-2.2.0-arm64.exe' }
    ] });
    const ambiguous = loadUpdatePluginWithRelease({
        release,
        systemFlags: { isWindows: true, isMacos: false, isLinux: false },
        userAgent: 'JellyfinDesktop/2.1.0 (Windows; x86_64) Chrome/131.0.0.0'
    });
    await ambiguous.trigger();
    assert.equal(ambiguous.confirmed.length, 1);
    assert.deepEqual(ambiguous.opened, [release.html_url]);

    // Linux: a .deb and an AppImage need different install flows, let the user pick.
    const linux = loadUpdatePluginWithRelease({
        release: updateRelease({ assets: [
            { name: 'JellyfinDesktop-x86_64.AppImage', browser_download_url: 'https://github.com/Archerkattri/jellyfin-neo/releases/download/v2.2.0/JellyfinDesktop-x86_64.AppImage' }
        ] }),
        systemFlags: { isWindows: false, isMacos: false, isLinux: true },
        userAgent: 'JellyfinDesktop/2.1.0 (Linux; x86_64) Chrome/131.0.0.0'
    });
    await linux.trigger();
    assert.deepEqual(linux.opened, [release.html_url]);
});

test('linux xbox mapping claims SDL evdev names without double-matching other maps', () => {
    // Upstream #950: Xbox input was ignored while the window was unfocused on
    // Linux because no SDL joystick name matched the linux idmatcher, leaving
    // only the focus-gated web Gamepad path. Qt matches idmatchers unanchored
    // (QRegularExpression::match), like RegExp.test here; both engines support
    // the negative lookaheads below.
    const idmatcherOf = path => {
        const text = readFileSync(new URL(path, import.meta.url), 'utf8');
        const line = text.split('\n').find(candidate =>
            candidate.includes('"idmatcher"') && !candidate.trimStart().startsWith('//'));
        return new RegExp(JSON.parse(line.slice(line.indexOf(':') + 1).replace(/,\s*$/, '')));
    };
    const linux = idmatcherOf('../resources/inputmaps/xbox-controller-linux.json');
    const dualshock = idmatcherOf('../resources/inputmaps/dualshock4.json');
    const mac = idmatcherOf('../resources/inputmaps/xbox-controller-mac.json');

    // Canonical Linux SDL joystick names (SDL_gamecontrollerdb.h / xpad evdev).
    for (const name of [
        'Microsoft X-Box 360 pad',
        'Microsoft X-Box One pad',
        'Microsoft X-Box One pad v2',
        'Generic X-Box pad',
        'Xbox 360 Wireless Receiver (XBOX)',
        'Xbox Wireless Controller',
        'Xbox Elite Wireless Controller',
        'Xbox One Controller'
    ]) {
        assert.ok(linux.test(name), `${name} matches the linux xbox map`);
        assert.ok(!dualshock.test(name), `${name} must not also match the dualshock map`);
    }

    // *360*Controller names stay claimed by the mac map alone (carve-out).
    for (const name of ['Xbox 360 Wireless Controller', 'X360 Wireless Controller']) {
        assert.ok(mac.test(name), `${name} still matches the mac xbox map`);
        assert.ok(!linux.test(name), `${name} must not also match the linux xbox map`);
        assert.ok(!dualshock.test(name), `${name} must not also match the dualshock map`);
    }

    // Sony pads keep the dualshock map and never match the xbox maps.
    for (const name of [
        'Wireless Controller',
        'Sony Computer Entertainment Wireless Controller',
        'Sony Interactive Entertainment DualSense Wireless Controller'
    ]) {
        assert.ok(dualshock.test(name), `${name} matches the dualshock map`);
        assert.ok(!linux.test(name), `${name} must not match the linux xbox map`);
    }
});


test('video player zooms with Ctrl+wheel and clamps to sane limits', () => {
    const { Player, calls, window, document } = loadPlayer('../native/mpvVideoPlayer.js', '_mpvVideoPlayer');
    const zooms = [];
    window.api.player.setVideoZoom = value => zooms.push(value);
    const player = newVideoPlayer(Player);
    player._videoDialog = {};

    player.onWheel({ deltaY: -120, ctrlKey: true, preventDefault() {} });
    assert.equal(player._videoZoom, 0.25);
    assert.deepEqual(zooms, [0.25]);
    assert.deepEqual(calls.volumes, []);

    player.onWheel({ deltaY: 120, ctrlKey: true, preventDefault() {} });
    assert.equal(player._videoZoom, 0);
    assert.deepEqual(zooms, [0.25, 0]);

    // Sane limits: 0.5x..4x (video-zoom -1..2); non-finite input resets.
    player.setVideoZoom(99);
    assert.equal(player._videoZoom, 2);
    player.setVideoZoom(-99);
    assert.equal(player._videoZoom, -1);
    player.setVideoZoom(Number.NaN);
    assert.equal(player._videoZoom, 0);
    assert.deepEqual(zooms, [0.25, 0, 2, -1, 0]);

    // A plain wheel still adjusts the volume instead of zooming.
    player.onWheel({ deltaY: -120, preventDefault() {} });
    assert.equal(calls.volumes.length, 1);
    assert.equal(zooms.length, 5);
    assert.equal(document.elements.length, 1);
});

test('video zoom respects its settings toggle and resets when playback ends', () => {
    const { Player, window } = loadPlayer('../native/mpvVideoPlayer.js', '_mpvVideoPlayer');
    const zooms = [];
    window.api.player.setVideoZoom = value => zooms.push(value);
    const player = Object.create(Player.prototype);
    player.events = { trigger() {} };

    // Default on: no explicit setting keeps Ctrl+wheel zooming.
    assert.equal(player.isVideoZoomAllowed(), true);

    player.setVideoZoom(1);
    assert.deepEqual(zooms, [1]);

    window.jmpInfo.settings.video = { allow_zoom: false };
    assert.equal(player.isVideoZoomAllowed(), false);

    player.onEndedInternal();
    assert.equal(player._videoZoom, 0);
    assert.deepEqual(zooms, [1, 0]);

    // A missing native bridge degrades to state tracking instead of throwing.
    delete window.api.player.setVideoZoom;
    player.setVideoZoom(1);
    assert.equal(player._videoZoom, 1);
});

test('video zoom toggle defaults on and reaches mpv video-zoom', () => {
    const allowZoom = findSetting('video', 'allow_zoom');

    assert.ok(allowZoom);
    assert.equal(allowZoom.default, true);

    const componentSource = readFileSync(new URL('../src/player/PlayerComponent.cpp', import.meta.url), 'utf8');
    const componentHeader = readFileSync(new URL('../src/player/PlayerComponent.h', import.meta.url), 'utf8');

    assert.match(componentHeader, /setVideoZoom/);
    assert.match(componentSource, /video-zoom/);
});

test('video player exits playback-entered fullscreen when the media dialog closes', async () => {
    const { player, window, fullscreens } = await startFullscreenPlayback(false);
    assert.equal(player._fullscreenBeforePlayback, false);

    // Fullscreen entered mid-playback (player OSD button -> host:fullscreen).
    window.jmpInfo.settings.main.fullscreen = true;
    player._videoDialog = null;

    // Back button / episode end tears the dialog down via destroy().
    player.removeMediaDialog();
    assert.deepEqual(fullscreens, [false]);
    assert.equal(player._fullscreenBeforePlayback, undefined);

    // A second teardown (playbackmanager also destroys) must not re-exit.
    player.removeMediaDialog();
    assert.deepEqual(fullscreens, [false]);
});

test('video player keeps pre-existing fullscreen when the media dialog closes', async () => {
    const { player, window, fullscreens } = await startFullscreenPlayback(true);
    assert.equal(player._fullscreenBeforePlayback, true);

    player._videoDialog = null;
    player.removeMediaDialog();
    assert.deepEqual(fullscreens, []);
    assert.equal(player._fullscreenBeforePlayback, undefined);
});

test('video player keeps the first fullscreen capture across back-to-back items', async () => {
    const { player, window } = await startFullscreenPlayback(false);

    // Autoplay-next replays without tearing the dialog down.
    window.jmpInfo.settings.main.fullscreen = true;
    await player.play({ fullscreen: true });
    assert.equal(player._fullscreenBeforePlayback, false);
});


test('Chromium GPU rasterization is not forced (Flatpak flicker #1112)', () => {
    const mainSource = readFileSync(new URL('../src/main.cpp', import.meta.url), 'utf8');

    // Forcing GPU rasterization overrides Chromium per-GPU heuristics: on
    // sandboxed or blocklisted GPUs (Flatpak, some native Wayland drivers) the
    // GPU tile budget is exhausted ("tile memory limits exceeded"), leaving
    // tiles undrawn or flickering -- worse with backdrop-filter blur skins.
    assert.doesNotMatch(mainSource, /"--enable-gpu-rasterization"/);
    // The remaining argv flag must survive: only the rasterization override goes.
    assert.match(mainSource, /"--disable-features=MediaSessionService"/);
});

test('sub643-resync-fires-once-on-first-timeupdate', () => {
    const { Player, window } = loadPlayer('../native/mpvVideoPlayer.js', '_mpvVideoPlayer');
    const subs = [];
    window.api.player.setSubtitleStream = (value) => { subs.push(value); };
    const player = newVideoPlayer(Player, null);
    // Simulate an auto-selected embedded track armed at playback start.
    player._subtitleTrackIndexToSetOnPlaying = 2;
    player._sub643JellyIndex = 2;
    player._sub643Param = 1;
    player._sub643Armed = true;
    player._sub643Done = false;

    // First position event re-selects the track off->on...
    player.onTimeUpdate(120);
    assert.deepEqual(subs, [-1, 1]);

    // ...and later position events never re-fire within the same playback.
    player.onTimeUpdate(240);
    assert.deepEqual(subs, [-1, 1]);

    // External subtitle URLs pass through the same cycle untouched.
    player._sub643Armed = true;
    player._sub643Done = false;
    player._sub643Param = '#,http://x/s.srt';
    player.onTimeUpdate(360);
    assert.deepEqual(subs, [-1, 1, -1, '#,http://x/s.srt']);
});

test('sub643-noop-without-active-subtitle', async () => {
    const { Player, window } = loadPlayer('../native/mpvVideoPlayer.js', '_mpvVideoPlayer');
    const subs = [];
    window.api.player.setSubtitleStream = (value) => { subs.push(value); };
    window.api.player.load = (...args) => { args[args.length - 1](); };
    const player = Object.create(Player.prototype);
    await player.setCurrentSrc({}, {
        url: 'http://x/v.mkv',
        mediaSource: { MediaStreams: [] },
        item: {}
    });
    assert.equal(player._sub643Armed, false);
    assert.equal(player._sub643Param, undefined);
    assert.equal(player._sub643MaybeResync('timeupdate'), false);
    assert.deepEqual(subs, []);
});

test('sub643-divergent-subtitle-action-cancels-resync', async () => {
    const { Player, window } = loadPlayer('../native/mpvVideoPlayer.js', '_mpvVideoPlayer');
    const subs = [];
    window.api.player.setSubtitleStream = (value) => { subs.push(value); };
    window.api.player.load = (...args) => { args[args.length - 1](); };
    const player = Object.create(Player.prototype);
    await player.setCurrentSrc({}, {
        url: 'http://x/v.mkv',
        mediaSource: {
            DefaultSubtitleStreamIndex: 2,
            MediaStreams: [
                { Index: 2, Type: 'Subtitle', Language: 'eng' },
                { Index: 3, Type: 'Subtitle', Language: 'spa' }
            ]
        },
        item: {}
    });
    assert.equal(player._sub643Armed, true);
    assert.equal(player._sub643Param, 1);

    // Re-applying the identical auto default (web initial sync) is
    // state-neutral and leaves the resync armed...
    player.setSubtitleStreamIndex(2);
    assert.equal(player._sub643Armed, true);

    // ...but switching tracks (or turning subs off) disarms it for good.
    player.setSubtitleStreamIndex(3);
    assert.equal(player._sub643Armed, false);
    assert.equal(player._sub643UserTouched, true);
    assert.equal(player._sub643FallbackTimer, null);
    subs.length = 0;
    assert.equal(player._sub643MaybeResync('timeupdate'), false);
    assert.deepEqual(subs, []);
});

test('sub643-setting-gates-workaround-default-on', async () => {
    const resync = findSetting('subtitles', 'resync_on_start');
    assert.ok(resync);
    assert.equal(resync.default, true);

    // A missing key (configs predating the setting) counts as enabled...
    const source = readFileSync(new URL('../native/mpvVideoPlayer.js', import.meta.url), 'utf8');
    assert.match(source, /subtitles\?\.resync_on_start !== false/);
    // ...and the blind fallback timer never exceeds 1500ms.
    assert.match(source, /_sub643MaybeResync\('fallback'\), 1500\)/);

    // ...while an explicit OFF leaves playback untouched.
    const { Player, window } = loadPlayer('../native/mpvVideoPlayer.js', '_mpvVideoPlayer');
    window.jmpInfo.settings.subtitles = { resync_on_start: false };
    window.api.player.load = (...args) => { args[args.length - 1](); };
    const player = Object.create(Player.prototype);
    await player.setCurrentSrc({}, {
        url: 'http://x/v.mkv',
        mediaSource: { DefaultSubtitleStreamIndex: 2, MediaStreams: [{ Index: 2, Type: 'Subtitle' }] },
        item: {}
    });
    assert.equal(player._sub643Armed, false);
});

function loadOffline0Spike() {
    const window = {};
    runInNewContext(readFileSync(new URL('../native/downloadSpike.js', import.meta.url), 'utf8'), {
        window,
        console: { log() {}, debug() {}, warn() {}, error() {} }
    });
    return window._downloadSpike;
}

test('offline0-download-profile-separates-sidecar-and-burnin-subs', () => {
    const spike = loadOffline0Spike();
    const profile = spike.getDownloadDeviceProfile();
    const methods = Object.fromEntries(profile.SubtitleProfiles.map(entry => [entry.Format, entry.Method]));
    assert.equal(methods.srt, 'External');
    assert.equal(methods.vtt, 'External');
    assert.equal(methods.ass, 'External');
    assert.equal(methods.pgssub, 'Encode');
    assert.equal(methods.dvdsub, 'Encode');
    // runInNewContext results carry the inner realm's prototypes, so compare
    // them structurally (same JSON-normalize trick as the gamepad test).
    assert.deepEqual(JSON.parse(JSON.stringify(profile.DirectPlayProfiles.map(entry => entry.Type).sort())), ['Audio', 'Video']);
    assert.ok(profile.TranscodingProfiles.every(entry => entry.Protocol === 'http'));
    assert.equal(spike.getDownloadDeviceProfile(8000000).MaxStreamingBitrate, 8000000);
});

test('offline0-pick-prefers-direct-source', () => {
    const spike = loadOffline0Spike();
    const transcode = { Id: 't1', SupportsTranscoding: true, TranscodingUrl: '/Videos/i1/stream.mp4?x=1' };
    const direct = { Id: 'd1', SupportsDirectPlay: true, Container: 'mkv' };
    const pick = spike.pickDownloadSource({ MediaSources: [transcode, direct] });
    assert.equal(pick.kind, 'direct');
    assert.equal(pick.mediaSource, direct);
    assert.equal(pick.resumable, true);
    assert.equal(pick.warning, null);
});

test('offline0-pick-flags-hls-only-and-empty', () => {
    const spike = loadOffline0Spike();
    const hls = spike.pickDownloadSource({ MediaSources: [
        { Id: 'h1', SupportsTranscoding: true, TranscodingUrl: '/Videos/i1/master.m3u8?x=1' }
    ] });
    assert.equal(hls.kind, 'hls-only');
    assert.equal(hls.resumable, false);
    assert.equal(hls.warning, 'hls-only');
    const empty = spike.pickDownloadSource({ MediaSources: [] });
    assert.equal(empty.kind, 'none');
    assert.equal(empty.mediaSource, null);
    assert.equal(empty.warning, 'no-source');
});

test('offline0-direct-url-uses-static-stream-form', () => {
    const spike = loadOffline0Spike();
    assert.equal(
        spike.buildMediaDownloadUrl('https://srv:8096/', 'i1', { Id: 'ms1', Container: 'mkv' }),
        'https://srv:8096/Videos/i1/stream.mkv?Static=true&mediaSourceId=ms1');
    assert.equal(
        spike.buildMediaDownloadUrl('https://srv:8096', 'i1', { Id: 'ms2', Container: 'FLAC' }, 'audio'),
        'https://srv:8096/Audio/i1/stream.flac?Static=true&mediaSourceId=ms2');
    assert.match(
        spike.buildMediaDownloadUrl('https://srv', 'i1', { Id: 'ms3', Container: 'MKV;evil' }),
        /stream\.mkv\?/);
    assert.equal(
        spike.buildMediaDownloadUrl('https://srv', 'i1', null),
        'https://srv/Items/i1/Download');
    const transcoded = spike.buildMediaDownloadUrl('https://srv', 'i1',
        { Id: 'ms9', TranscodingUrl: '/Videos/i1/stream.mp4?Static=false' });
    assert.equal(transcoded, 'https://srv/Videos/i1/stream.mp4?Static=false');
    for (const url of [transcoded, spike.buildMediaDownloadUrl('https://srv', 'i1', { Id: 'ms1' })]) {
        assert.doesNotMatch(url, /Token=|api_key/i);
    }
});

test('offline0-subtitle-url-verbatim-or-fallback', () => {
    const spike = loadOffline0Spike();
    const source = { Id: 'ms1' };
    assert.equal(
        spike.buildSubtitleUrl('https://srv', 'i1', source,
            { Index: 4, DeliveryMethod: 'External', DeliveryUrl: 'https://cdn/x.srt' }),
        'https://cdn/x.srt');
    assert.equal(
        spike.buildSubtitleUrl('https://srv', 'i1', source,
            { Index: 4, DeliveryMethod: 'External', DeliveryUrl: '/Videos/i1/ms1/Subtitles/4/0/Stream.srt' }),
        'https://srv/Videos/i1/ms1/Subtitles/4/0/Stream.srt');
    assert.equal(
        spike.buildSubtitleUrl('https://srv', 'i1', source, { Index: 4, Codec: 'subrip' }),
        'https://srv/Videos/i1/ms1/Subtitles/4/0/Stream.srt');
    assert.equal(
        spike.buildSubtitleUrl('https://srv', 'i1', source, { Index: 5, Codec: 'webvtt' }),
        'https://srv/Videos/i1/ms1/Subtitles/5/0/Stream.vtt');
});

test('offline0-subtitle-selection-flags-encode-only-default', () => {
    const spike = loadOffline0Spike();
    const selected = spike.selectDownloadSubtitles({
        DefaultSubtitleStreamIndex: 3,
        MediaStreams: [
            { Index: 3, Type: 'Subtitle', DeliveryMethod: 'Encode', IsTextSubtitleStream: false },
            { Index: 4, Type: 'Subtitle', Language: 'eng', DeliveryMethod: 'External',
              DeliveryUrl: '/s/4.srt', IsTextSubtitleStream: true },
            { Index: 1, Type: 'Audio', Language: 'eng' }
        ]
    }, { languages: ['eng'] });
    assert.deepEqual(JSON.parse(JSON.stringify(selected.sidecars)), [4]);
    assert.deepEqual(JSON.parse(JSON.stringify(selected.burnInOnly)), [3]);
});

test('offline0-probe-negotiates-and-validates-range', async () => {
    const spike = loadOffline0Spike();
    const directSource = {
        Id: 'ms1', SupportsDirectPlay: true, Container: 'mkv', Size: 1234,
        DefaultSubtitleStreamIndex: 4,
        MediaStreams: [
            { Index: 4, Type: 'Subtitle', Codec: 'subrip', DeliveryMethod: 'External',
              DeliveryUrl: '/Videos/i1/ms1/Subtitles/4/0/Stream.srt' }
        ]
    };
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
        calls.push({ url, options });
        if (url.includes('/PlaybackInfo')) {
            return { ok: true, status: 200, async json() { return { MediaSources: [directSource] }; } };
        }
        return { ok: true, status: 206, body: { cancel: async () => {} } };
    };
    const plan = await spike.probeDownloadPlan({
        serverUrl: 'https://srv', token: 'secret', userId: 'u1', itemId: 'i1',
        mediaSourceId: 'ms0', audioStreamIndex: 1, fetchImpl
    });
    assert.equal(plan.kind, 'direct');
    assert.equal(plan.url, 'https://srv/Videos/i1/stream.mkv?Static=true&mediaSourceId=ms1');
    assert.equal(plan.resumable, true);
    assert.equal(plan.rangeStatus, 206);
    assert.equal(plan.expectedSize, 1234);
    assert.deepEqual(JSON.parse(JSON.stringify(plan.subtitles)), [{ index: 4, ext: 'srt', url: 'https://srv/Videos/i1/ms1/Subtitles/4/0/Stream.srt' }]);
    assert.equal(plan.warning, null);

    const postBody = JSON.parse(calls[0].options.body);
    assert.ok(Array.isArray(postBody.DeviceProfile.DirectPlayProfiles));
    assert.equal(postBody.MediaSourceId, 'ms0');
    assert.equal(postBody.AudioStreamIndex, 1);
    for (const call of calls) {
        assert.equal(call.options.headers.Authorization, 'MediaBrowser Token="secret"');
        assert.doesNotMatch(call.url, /secret/);
    }
    assert.equal(calls[1].options.headers.Range, 'bytes=0-0');

    const transcodeCalls = [];
    const transcodeFetch = async (url, options = {}) => {
        transcodeCalls.push({ url, options });
        if (url.includes('/PlaybackInfo')) {
            return { ok: true, status: 200, async json() { return { MediaSources: [
                { Id: 'ms9', SupportsTranscoding: true,
                  TranscodingUrl: '/Videos/i1/stream.mp4?Static=false', MediaStreams: [] }
            ] }; } };
        }
        return { ok: true, status: 200, body: { cancel: async () => {} } };
    };
    const transcodePlan = await spike.probeDownloadPlan({
        serverUrl: 'https://srv', itemId: 'i1', fetchImpl: transcodeFetch
    });
    assert.equal(transcodePlan.kind, 'transcode');
    assert.equal(transcodePlan.url, 'https://srv/Videos/i1/stream.mp4?Static=false');
    assert.equal(transcodePlan.resumable, false);
    assert.equal(transcodePlan.warning, 'no-resume');
});

test('offline0-spike-script-is-injected', () => {
    const source = readFileSync(new URL('../src/system/SystemComponent.cpp', import.meta.url), 'utf8');
    assert.match(source, /":\/web-client\/extension\/downloadSpike\.js"/);
});
function loadPlugin0Manifest() {
    const context = {
        window: {},
        console: { log() {}, debug() {}, warn() {}, error() {} }
    };
    runInNewContext(readFileSync(new URL('../native/pluginManifest.js', import.meta.url), 'utf8'), context);
    return context.window._validatePluginManifest;
}

test('plugin0-manifest-accepts-valid', () => {
    const validate = loadPlugin0Manifest();

    // Design's Discord example shape (Tier 2, full manifest).
    const native = validate({
        id: 'org.jellyfin.discord-presence',
        version: '1.2.0',
        apiVersion: 1,
        tier: 'native',
        entry: 'discordpresence',
        capabilities: ['webchannel-export', 'host-commands', 'local-sockets', 'settings-ui'],
        capabilityRationale: { 'local-sockets': 'Talks to the local Discord client over IPC.' },
        name: 'Discord Rich Presence',
        author: 'Example Author'
    });
    assert.equal(native.ok, true);
    assert.equal(native.manifest.id, 'org.jellyfin.discord-presence');
    assert.deepEqual(JSON.parse(JSON.stringify(native.manifest.capabilities)), ['webchannel-export', 'host-commands', 'local-sockets', 'settings-ui']);

    // Minimal Tier-1 web plugin: capabilities/rationale default to empty.
    const web = validate({ id: 'theme-dark', version: '0.1.0-beta.1', apiVersion: 1, tier: 'web', entry: 'theme-dark' });
    assert.equal(web.ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(web.manifest.capabilities)), []);
});

test('plugin0-manifest-rejects-missing-field', () => {
    const validate = loadPlugin0Manifest();
    const good = { id: 'org.example.p', version: '1.0.0', apiVersion: 1, tier: 'web', entry: 'p' };

    for (const key of ['id', 'version', 'apiVersion', 'tier', 'entry']) {
        const broken = { ...good };
        delete broken[key];
        assert.equal(validate(broken).ok, false, `${key} is required`);
    }
    for (const notObject of [null, undefined, 42, 'x', [], '{not json']) {
        assert.equal(validate(notObject).ok, false, `${String(notObject)} is not a manifest`);
    }
    assert.match(validate({}).error, /invalid or missing/);
});

test('plugin0-manifest-rejects-bad-version', () => {
    const validate = loadPlugin0Manifest();
    const good = { id: 'org.example.p', version: '1.0.0', apiVersion: 1, tier: 'web', entry: 'p' };

    for (const version of ['', '1', '1.2', 'v1.2.0', '1.2.0.4', 42, null]) {
        assert.equal(validate({ ...good, version }).ok, false, `version ${String(version)} rejected`);
    }
    assert.equal(validate({ ...good, version: '2.0.0+build.1' }).ok, true);
    for (const apiVersion of [0, -1, 1.5, '1', null, Number.NaN]) {
        assert.equal(validate({ ...good, apiVersion }).ok, false, `apiVersion ${String(apiVersion)} rejected`);
    }
    const future = validate({ ...good, apiVersion: 999 });
    assert.equal(future.ok, false);
    assert.match(future.error, /unsupported "apiVersion"/);
});

test('plugin0-manifest-rejects-path-traversal-entry', () => {
    const validate = loadPlugin0Manifest();
    const good = { id: 'org.example.p', version: '1.0.0', apiVersion: 1, tier: 'native' };

    for (const entry of ['', '.', '..', '../evil', 'a/b', 'a\\b', '/abs/path', 'C:\\x', 'has space', 'a..b/c']) {
        assert.equal(validate({ ...good, entry }).ok, false, `entry ${JSON.stringify(entry)} rejected`);
    }
    for (const entry of ['discordpresence', 'my-plugin_v2.0', 'a..b']) {
        assert.equal(validate({ ...good, entry }).ok, entry !== 'a..b', `entry ${entry}`);
    }
});

test('plugin0-manifest-rejects-unknown-capability', () => {
    const validate = loadPlugin0Manifest();
    const good = { id: 'org.example.p', version: '1.0.0', apiVersion: 1, tier: 'web', entry: 'p' };

    assert.equal(validate({ ...good, capabilities: ['runUserScript'] }).ok, false);
    assert.equal(validate({ ...good, capabilities: ['network', 'evil'] }).ok, false);
    assert.equal(validate({ ...good, capabilities: 'network' }).ok, false);
    assert.equal(validate({ ...good, capabilities: [42] }).ok, false);
    assert.equal(validate({
        ...good,
        capabilities: ['network'],
        capabilityRationale: { 'local-sockets': 'undeclared' }
    }).ok, false);
    assert.equal(validate({ ...good, capabilityRationale: ['x'] }).ok, false);
    const all = validate({
        ...good,
        capabilities: ['webchannel-export', 'host-commands', 'settings-ui', 'local-sockets', 'network', 'process-spawn']
    });
    assert.equal(all.ok, true);
});

test('plugin0-cpp-skeleton-matches-design', () => {
    const iface = readFileSync(new URL('../src/plugins/api/ClientPluginInterface.h', import.meta.url), 'utf8');
    assert.match(iface, /org\.jellyfin\.ClientPlugin\/1/);
    assert.match(iface, /ClientPluginApiVersion = 1/);
    assert.match(iface, /webChannelObject\(\)/);
    assert.match(iface, /companionScript\(\)/);

    const component = readFileSync(new URL('../src/plugins/PluginComponent.h', import.meta.url), 'utf8');
    assert.match(component, /componentName\(\) override \{ return "plugins"; \}/);
    assert.match(component, /componentExport\(\) override \{ return false; \}/);

    const manager = readFileSync(new URL('../src/core/ComponentManager.cpp', import.meta.url), 'utf8');
    assert.match(manager, /plugins\/PluginComponent\.h/);
    assert.match(manager, /PluginComponent::Get\(\)/);

    const cmake = readFileSync(new URL('../src/plugins/CMakeLists.txt', import.meta.url), 'utf8');
    assert.match(cmake, /PluginComponent\.cpp/);
    assert.match(cmake, /PluginManifest\.cpp/);
    assert.match(readFileSync(new URL('../src/CMakeLists.txt', import.meta.url), 'utf8'), /add_subdirectory\(plugins\)/);

    // Phase 0 changes no loader behavior: the injected blob list is untouched.
    const system = readFileSync(new URL('../src/system/SystemComponent.cpp', import.meta.url), 'utf8');
    assert.match(system, /:\/web-client\/extension\/nativeshell\.js/);
    assert.doesNotMatch(system, /[Pp]luginManifest/);
    assert.doesNotMatch(system, /plugin\.json/);
});
