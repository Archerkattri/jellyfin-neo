// Tier-2: pure-JS mirror of the PluginComponent install/uninstall path-safety
// rules (fail-closed). The C++ side is authoritative; this module lets
// settings UI/diagnostics compute the same plan without native calls, and is
// the unit-testable surface for the traversal rules. Keep in sync with
// src/plugins/PluginComponent.cpp. Unknown/extra manifest keys are ignored
// for forward compatibility (via the shared validator).
window._pluginInstallPlan = (() => {
    const DIR_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

    function fail(error) {
        return { ok: false, error };
    }

    // Single safe path segment. Mirrors PluginComponent::isSafeDirName: the
    // manifest id pattern already excludes separators, but "." and ".."
    // match that pattern and must be rejected to stop plugins-dir escapes.
    function isSafePluginDirName(name) {
        return typeof name === 'string' && name.length > 0
            && name !== '.' && name !== '..'
            && DIR_NAME_PATTERN.test(name);
    }

    function normalizeBase(pluginsDir) {
        if (typeof pluginsDir !== 'string' || pluginsDir.length === 0
                || pluginsDir.includes('\0')) {
            return null;
        }
        // Compare with one separator flavor and no trailing slashes.
        const unified = pluginsDir.replace(/\\/g, '/').replace(/\/+$/, '');
        if (unified.length === 0) {
            return null;
        }
        // Resolve dot segments so "a/../b" bases cannot hide escapes.
        const absolute = unified.startsWith('/');
        const parts = [];
        for (const segment of unified.split('/')) {
            if (segment === '' || segment === '.') {
                continue;
            }
            if (segment === '..') {
                if (parts.length === 0) {
                    return null;
                }
                parts.pop();
                continue;
            }
            parts.push(segment);
        }
        const resolved = (absolute ? '/' : '') + parts.join('/');
        return resolved.length > 0 ? resolved : null;
    }

    function joinWithin(pluginsDir, name) {
        const base = normalizeBase(pluginsDir);
        if (base === null || !isSafePluginDirName(name)) {
            return null;
        }
        // name is one safe segment, so this join cannot escape; verify the
        // containment explicitly anyway (fail-closed, defense in depth).
        const target = base + '/' + name;
        if (!target.startsWith(base + '/')) {
            return null;
        }
        return { base, target };
    }

    // Plan installing `manifest` (a parsed plugin.json object) into
    // `pluginsDir`. The manifest must pass window._validatePluginManifest.
    function planInstall(pluginsDir, manifest) {
        if (typeof window._validatePluginManifest !== 'function') {
            return fail('manifest validator unavailable');
        }
        let result;
        try {
            result = window._validatePluginManifest(manifest);
        } catch (e) {
            return fail('manifest validation failed');
        }
        if (!result || result.ok !== true) {
            return fail(result && result.error ? `invalid manifest: ${result.error}` : 'invalid manifest');
        }
        const joined = joinWithin(pluginsDir, result.manifest.id);
        if (joined === null) {
            return fail('install target escapes the plugins directory');
        }
        return { ok: true, id: result.manifest.id, pluginsDir: joined.base, targetDir: joined.target };
    }

    // Plan removing the installed plugin dir for `id` from `pluginsDir`.
    function planUninstall(pluginsDir, id) {
        if (!isSafePluginDirName(id)) {
            return fail('refusing to uninstall unsafe plugin id');
        }
        const joined = joinWithin(pluginsDir, id);
        if (joined === null) {
            return fail('plugin path escapes the plugins directory');
        }
        return { ok: true, id, pluginsDir: joined.base, targetDir: joined.target };
    }

    return { isSafePluginDirName, planInstall, planUninstall };
})();
