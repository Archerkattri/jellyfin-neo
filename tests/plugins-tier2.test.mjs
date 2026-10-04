import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { runInNewContext } from 'node:vm';

function runScript(relPath, context) {
    runInNewContext(readFileSync(new URL(relPath, import.meta.url), 'utf8'), context, { filename: relPath });
}

function quietConsole() {
    return { log() {}, debug() {}, warn() {}, error() {} };
}

function manifestContext() {
    const window = {};
    const context = { window, console: quietConsole() };
    runScript('../native/pluginManifest.js', context);
    return window._validatePluginManifest;
}

function installPlanContext({ withValidator = true } = {}) {
    const window = {};
    const context = { window, console: quietConsole() };
    if (withValidator) {
        runScript('../native/pluginManifest.js', context);
    }
    runScript('../native/pluginInstall.js', context);
    return window._pluginInstallPlan;
}

function validManifest(overrides = {}) {
    return {
        id: 'org.jellyfin.sample-theme',
        version: '1.0.0',
        apiVersion: 1,
        tier: 'web',
        entry: 'sample-theme',
        capabilities: [],
        ...overrides
    };
}

describe('manifest validation (native/pluginManifest.js)', () => {
    test('accepts a full valid web manifest', () => {
        const validate = manifestContext();
        const result = validate(validManifest({
            capabilities: ['settings-ui'],
            capabilityRationale: { 'settings-ui': 'theme toggle' }
        }));
        assert.equal(result.ok, true);
        assert.equal(result.manifest.id, 'org.jellyfin.sample-theme');
        assert.deepEqual([...result.manifest.capabilities], ['settings-ui']);
    });

    test('accepts a minimal manifest and ignores unknown keys', () => {
        const validate = manifestContext();
        const { capabilities, ...minimal } = validManifest({ name: 'Extra', license: 'MIT' });
        const result = validate(minimal);
        assert.equal(result.ok, true);
        assert.deepEqual([...result.manifest.capabilities], []);
    });

    test('accepts the shipped sample-theme plugin.json', () => {
        const validate = manifestContext();
        const manifest = JSON.parse(readFileSync(new URL('../dev/plugins/sample-theme/plugin.json', import.meta.url), 'utf8'));
        assert.equal(validate(manifest).ok, true);
    });

    test('rejects non-objects and bad identity fields', () => {
        const validate = manifestContext();
        for (const manifest of [null, [], 'x', 42, validManifest({ id: undefined }),
                validManifest({ id: '' }), validManifest({ id: 'bad/id' }), validManifest({ id: 'bad id' })]) {
            assert.equal(validate(manifest).ok, false, JSON.stringify(manifest));
        }
    });

    test('rejects bad versions and apiVersions', () => {
        const validate = manifestContext();
        for (const manifest of [validManifest({ version: undefined }), validManifest({ version: '1.0' }),
                validManifest({ apiVersion: 0 }), validManifest({ apiVersion: 1.5 }),
                validManifest({ apiVersion: '1' }), validManifest({ apiVersion: 99 })]) {
            assert.equal(validate(manifest).ok, false, JSON.stringify(manifest));
        }
    });

    test('rejects bad tiers and unsafe entries', () => {
        const validate = manifestContext();
        for (const manifest of [validManifest({ tier: 'desktop' }), validManifest({ tier: undefined }),
                validManifest({ entry: 'a/b' }), validManifest({ entry: 'a\\b' }),
                validManifest({ entry: '..' }), validManifest({ entry: '.' }),
                validManifest({ entry: '' }), validManifest({ entry: '..hidden' })]) {
            assert.equal(validate(manifest).ok, false, JSON.stringify(manifest));
        }
    });

    test('rejects capability violations', () => {
        const validate = manifestContext();
        for (const manifest of [validManifest({ capabilities: 'settings-ui' }),
                validManifest({ capabilities: ['nope'] }),
                validManifest({ capabilityRationale: [] }),
                validManifest({ capabilityRationale: { 'settings-ui': 'undeclared' } })]) {
            assert.equal(validate(manifest).ok, false, JSON.stringify(manifest));
        }
    });
});

describe('install-plan path safety (native/pluginInstall.js)', () => {
    test('isSafePluginDirName accepts plain segments only', () => {
        const { isSafePluginDirName } = installPlanContext();
        assert.equal(isSafePluginDirName('org.jellyfin.sample-theme'), true);
        assert.equal(isSafePluginDirName('a..b'), true); // dots inside a segment are not traversal
        for (const name of ['', '.', '..', '../x', 'a/b', 'a\\b', 'a b', null, 42, 'x\0y']) {
            assert.equal(isSafePluginDirName(name), false, JSON.stringify(name));
        }
    });

    test('planInstall maps a valid manifest into the plugins dir', () => {
        const { planInstall } = installPlanContext();
        const plan = planInstall('/profiles/main/plugins/', validManifest());
        assert.equal(plan.ok, true);
        assert.equal(plan.id, 'org.jellyfin.sample-theme');
        assert.equal(plan.pluginsDir, '/profiles/main/plugins');
        assert.equal(plan.targetDir, '/profiles/main/plugins/org.jellyfin.sample-theme');
    });

    test('planInstall rejects invalid manifests fail-closed', () => {
        const { planInstall } = installPlanContext();
        for (const manifest of [null, validManifest({ id: 'bad/id' }), validManifest({ apiVersion: 99 })]) {
            const plan = planInstall('/plugins', manifest);
            assert.equal(plan.ok, false, JSON.stringify(manifest));
            assert.match(plan.error, /invalid manifest/);
        }
    });

    test('planInstall rejects validator-passing ids that escape (..)', () => {
        const { planInstall } = installPlanContext();
        // ".." matches the manifest id pattern, so the dir-name gate must catch it.
        const plan = planInstall('/plugins', validManifest({ id: '..' }));
        assert.equal(plan.ok, false);
        assert.match(plan.error, /escapes/);
    });

    test('planInstall fails without the shared validator or a usable base', () => {
        const { planInstall } = installPlanContext({ withValidator: false });
        assert.equal(planInstall('/plugins', validManifest()).ok, false);
        const withValidator = installPlanContext();
        assert.equal(withValidator.planInstall('', validManifest()).ok, false);
        assert.equal(withValidator.planInstall(null, validManifest()).ok, false);
    });

    test('planUninstall resolves inside the plugins dir', () => {
        const { planUninstall } = installPlanContext();
        const plan = planUninstall('/profiles/main/plugins', 'org.jellyfin.sample-theme');
        assert.equal(plan.ok, true);
        assert.equal(plan.targetDir, '/profiles/main/plugins/org.jellyfin.sample-theme');
    });

    test('planUninstall refuses traversal attacks and bad bases', () => {
        const { planUninstall } = installPlanContext();
        for (const id of ['..', '.', '../evil', '..\\evil', 'a/b', 'a\\b', '', null]) {
            const plan = planUninstall('/profiles/main/plugins', id);
            assert.equal(plan.ok, false, JSON.stringify(id));
        }
        assert.equal(planUninstall('', 'org.jellyfin.sample-theme').ok, false);
        assert.equal(planUninstall('/x\0y', 'org.jellyfin.sample-theme').ok, false);
    });

    test('planUninstall tolerates windows separators and trailing slashes', () => {
        const { planUninstall } = installPlanContext();
        const plan = planUninstall('C:\\profiles\\main\\plugins\\', 'theme-x');
        assert.equal(plan.ok, true);
        assert.equal(plan.targetDir, 'C:/profiles/main/plugins/theme-x');
    });
});

function mockPlayer() {
    const signals = {};
    for (const name of ['metadataChanged', 'playbackStateChanged', 'positionChanged',
            'durationChanged', 'playbackStopped']) {
        signals[name] = {
            listeners: [],
            connect(listener) { this.listeners.push(listener); },
            emit(...args) { for (const listener of this.listeners) { listener(...args); } }
        };
    }
    return signals;
}

function hostContext({ withDocument = true } = {}) {
    const jmpInfo = { settings: { main: {}, video: {}, audio: {} }, settingsUpdate: [] };
    const elements = [];
    const timers = [];
    const body = { children: [], appendChild(element) { this.children.push(element); } };
    // nativeshell's loader awaits document.addEventListener at import time, so
    // even the no-DOM case stubs it; the fail-closed path under test is the
    // missing createElement below.
    const document = !withDocument ? { addEventListener() {}, removeEventListener() {} } : {
        body,
        documentElement: body,
        addEventListener() {},
        removeEventListener() {},
        createElement(tag) {
            const element = {
                tag, style: {}, children: [], attributes: {},
                setAttribute(key, value) { this.attributes[key] = value; },
                appendChild(child) { this.children.push(child); },
                remove() { this.removed = true; }
            };
            elements.push(element);
            return element;
        }
    };
    const window = {
        sessionStorage: { getItem: () => null, setItem() {} },
        jmpInfo
    };
    const context = {
        window,
        jmpInfo,
        document,
        setTimeout(callback, ms) { timers.push({ callback, ms }); return timers.length; },
        console: quietConsole()
    };
    runScript('../native/nativeshell.js', context);
    return { host: window.JellyfinDesktop.host, window, body, elements, timers };
}

describe('host APIs (window.JellyfinDesktop.host)', () => {
    test('exposes the Tier-2 verbs alongside the Tier-1 surface', () => {
        const { host } = hostContext();
        assert.equal(typeof host.log, 'function');
        assert.equal(typeof host.showToast, 'function');
        assert.equal(typeof host.nowPlaying, 'function');
    });

    test('showToast rejects invalid input and missing DOM fail-closed', () => {
        const { host } = hostContext();
        assert.equal(host.showToast('', 'm'), false);
        assert.equal(host.showToast('t', ''), false);
        assert.equal(host.showToast(42, 'm'), false);
        assert.equal(host.showToast('t', null), false);
        assert.equal(hostContext({ withDocument: false }).host.showToast('t', 'm'), false);
    });

    test('showToast renders a text-only toast and auto-dismisses', () => {
        const { host, body, timers } = hostContext();
        assert.equal(host.showToast('Hi', 'Loaded'), true);
        assert.equal(body.children.length, 1);
        const toast = body.children[0];
        assert.equal(toast.children[0].textContent, 'Hi');
        assert.equal(toast.children[1].textContent, 'Loaded');
        assert.ok(!('innerHTML' in toast.children[0]));
        assert.equal(timers.length, 1);
        assert.equal(timers[0].ms, 4000);
        timers[0].callback();
        assert.equal(toast.removed, true);
    });

    test('showToast honors durationMs, caps at 3, and supports sticky', () => {
        const { host, body, timers } = hostContext();
        assert.equal(host.showToast('t', 'one', { durationMs: 10 }), true);
        assert.equal(timers[0].ms, 10);
        host.showToast('t', 'two');
        host.showToast('t', 'three');
        host.showToast('t', 'four');
        assert.equal(body.children.length, 4);
        assert.equal(body.children[0].removed, true);
        assert.equal(body.children[3].removed, undefined);
        const before = timers.length;
        host.showToast('t', 'sticky', { durationMs: 0 });
        assert.equal(timers.length, before);
    });

    test('nowPlaying is null without the bridge', () => {
        const { host } = hostContext();
        assert.equal(host.nowPlaying(), null);
    });

    test('nowPlaying snapshots player signals once the bridge appears', () => {
        const { host, window } = hostContext();
        assert.equal(host.nowPlaying(), null); // no bridge yet; must retry later
        const player = mockPlayer();
        window.api = { player };
        assert.equal(host.nowPlaying(), null); // subscribed, nothing played yet
        player.metadataChanged.emit({ Name: 'Song', Artists: ['A'], Album: 'B', MediaType: 'Audio' });
        player.playbackStateChanged.emit('Playing');
        player.positionChanged.emit(1000);
        player.durationChanged.emit(200000);
        assert.deepEqual({ ...host.nowPlaying() }, {
            title: 'Song', artist: 'A', album: 'B', mediaType: 'Audio',
            state: 'Playing', positionMs: 1000, durationMs: 200000
        });
    });

    test('nowPlaying prefers Artists[0], falls back to AlbumArtist', () => {
        const { host, window } = hostContext();
        const player = mockPlayer();
        window.api = { player };
        host.nowPlaying();
        player.metadataChanged.emit({ Name: 'Track', AlbumArtist: 'Solo' });
        assert.equal(host.nowPlaying().artist, 'Solo');
        player.metadataChanged.emit({ Name: 'Track', Artists: ['Band'], AlbumArtist: 'Solo' });
        assert.equal(host.nowPlaying().artist, 'Band');
    });

    test('nowPlaying returns a copy and resets on stop', () => {
        const { host, window } = hostContext();
        const player = mockPlayer();
        window.api = { player };
        host.nowPlaying();
        player.metadataChanged.emit({ Name: 'Song' });
        player.positionChanged.emit('bogus'); // non-numeric positions are ignored
        const snapshot = host.nowPlaying();
        assert.equal(snapshot.positionMs, null);
        snapshot.title = 'mutated';
        assert.equal(host.nowPlaying().title, 'Song');
        player.playbackStopped.emit(false);
        assert.equal(host.nowPlaying(), null);
    });

    test('sample theme plugin demos showToast through the host only', () => {
        const calls = [];
        const window = {
            JellyfinDesktop: {
                plugin: { id: 'org.jellyfin.sample-theme' },
                host: {
                    log() {},
                    showToast(title, message) { calls.push([title, message]); return true; }
                },
                events: { on() { return true; } }
            }
        };
        const context = {
            window,
            document: {
                createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
                getElementById: () => null,
                body: { appendChild() {} }
            },
            console: quietConsole()
        };
        runScript('../dev/plugins/sample-theme/sample-theme.js', context);
        assert.deepEqual(calls, [['Sample Theme', 'Loaded for org.jellyfin.sample-theme']]);
    });
});
