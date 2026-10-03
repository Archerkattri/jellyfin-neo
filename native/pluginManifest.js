// Phase 0: client-side mirror of src/plugins/api/PluginManifest (fail-closed
// plugin.json validation). Phase 1's Tier-1 loader reuses this as the
// client-side gate before appending a web plugin's script; keep the rule
// sets in sync. Unknown/extra keys are ignored for forward compatibility.
window._validatePluginManifest = (() => {
    const SUPPORTED_API_VERSION = 1;
    const KNOWN_CAPABILITIES = new Set([
        'webchannel-export',
        'host-commands',
        'settings-ui',
        'local-sockets',
        'network',
        'process-spawn'
    ]);
    const ID_PATTERN = /^[A-Za-z0-9._-]+$/;
    const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
    const ENTRY_PATTERN = /^[A-Za-z0-9._-]+$/;

    function fail(error) {
        return { ok: false, error };
    }

    function validatePluginManifest(manifest) {
        if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
            return fail('manifest must be an object');
        }
        const { id, version, apiVersion, tier, entry } = manifest;
        if (typeof id !== 'string' || id.length === 0 || !ID_PATTERN.test(id)) {
            return fail('invalid or missing "id"');
        }
        if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
            return fail('invalid or missing "version"');
        }
        if (typeof apiVersion !== 'number' || !Number.isInteger(apiVersion) || apiVersion < 1) {
            return fail('invalid or missing "apiVersion"');
        }
        if (apiVersion > SUPPORTED_API_VERSION) {
            return fail(`unsupported "apiVersion" ${apiVersion}`);
        }
        if (tier !== 'web' && tier !== 'native') {
            return fail('invalid or missing "tier"');
        }
        if (typeof entry !== 'string' || entry.length === 0 || entry === '.' || entry === '..'
                || entry.includes('/') || entry.includes('\\') || entry.includes('..')
                || !ENTRY_PATTERN.test(entry)) {
            return fail('invalid or missing "entry"');
        }
        const capabilities = manifest.capabilities ?? [];
        if (!Array.isArray(capabilities)) {
            return fail('"capabilities" must be an array');
        }
        for (const cap of capabilities) {
            if (typeof cap !== 'string' || !KNOWN_CAPABILITIES.has(cap)) {
                return fail(`unknown capability "${cap}"`);
            }
        }
        const rationale = manifest.capabilityRationale ?? {};
        if (rationale === null || typeof rationale !== 'object' || Array.isArray(rationale)) {
            return fail('"capabilityRationale" must be an object');
        }
        for (const key of Object.keys(rationale)) {
            if (!capabilities.includes(key)) {
                return fail(`rationale for undeclared capability "${key}"`);
            }
        }
        return { ok: true, manifest: { id, version, apiVersion, tier, entry, capabilities: [...capabilities] } };
    }

    validatePluginManifest.SUPPORTED_API_VERSION = SUPPORTED_API_VERSION;
    return validatePluginManifest;
})();
