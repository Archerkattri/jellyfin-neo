# Sample Theme (Tier-1 web plugin)

Reference plugin proving the Phase-1 host surface end to end. It renders one
small badge in the corner of the page using `window.JellyfinDesktop` only.

## What it demonstrates

- `plugin.json` manifest shape for `tier: "web"` (passes the Phase-0
  `window._validatePluginManifest` gate: `id`/`version`/`apiVersion`/
  `tier`/`entry`/`capabilities`).
- The Phase-1 host object contract from
  `research_notes/plugin-api-design.md`: `plugin.{id, version}`,
  `events.on(object, signal, cb)`, `host.log()`.
- The Tier-2 `host.showToast(title, message)` verb: the plugin announces
  its load with a toast when the host object offers it.
- Defensive loading: the script no-ops cleanly when `window.JellyfinDesktop`
  is absent (e.g. older builds without Phase-1 support).

## How to install

Copy this directory to `<profile>/plugins/` so the layout becomes:

```text
<profile>/plugins/sample-theme/plugin.json
<profile>/plugins/sample-theme/sample-theme.js
```

No build step; Phase-1 loads enabled Tier-1 scripts from the profile dir.

## How to verify

1. Enable the plugin in Client Settings (plugins section).
2. Restart the client and open any page.
3. A `Sample Theme (org.jellyfin.sample-theme)` badge is pinned to the
   bottom-right corner; starting playback updates its
   `data-playback-state` attribute. A `Sample Theme` toast appears
   bottom-left on load (Tier-2 hosts only).
4. With devtools attached (`--remote-debugging-port=9222`), the console
   shows `[sample-theme] loaded for org.jellyfin.sample-theme` via
   `host.log`.
