# Jellyfin Neo — hardware smoke runbook (v2.1.0)

Machine-owner checklist. CI proves the code compiles and unit tests pass;
this proves the built apps install, launch, play, and behave on real
hardware. Work top to bottom; every item is PASS/FAIL with the evidence
noted. Paste the result table (section 6) back when done.

Artifacts: the [Actions page](https://github.com/Archerkattri/jellyfin-neo/actions)
(per-OS workflow artifacts) or the release page once v2.1.0 is tagged.
Expected names: `JellyfinDesktop-<ver>-x64.exe/.zip`,
`JellyfinDesktop-<ver>-arm64.exe/.zip`,
`JellyfinDesktop-<ver>-arm64.dmg`, `JellyfinDesktop-<ver>-x86_64.dmg`,
`<distro>-jellyfin-desktop_<ver>_<arch>.deb`, `JellyfinDesktop-<ver>.AppImage`.

Log locations (attach on any FAIL):
- Windows: `%LOCALAPPDATA%\Jellyfin Desktop\profiles\<profile-id>\logs\`
- Linux: `~/.local/share/jellyfin-desktop/profiles/<profile-id>/logs/`
- Linux (Flatpak): `~/.var/app/org.jellyfin.JellyfinDesktop/data/jellyfin-desktop/profiles/<profile-id>/logs/`
- macOS: `~/Library/Logs/Jellyfin Desktop/profiles/<profile-id>/`

Useful flags: `--version`, `--fullscreen`, `--disable-gpu`,
`--remote-debugging-port <port>`, `--config-dir <dir>`, `--profile <name>`.

## 1. Install + launch (every artifact you have hardware for)

| # | Artifact | Steps | PASS |
|---|----------|-------|------|
| 1.1 | Win x64 installer | Run `.exe`, launch from Start menu | Window opens, server screen renders |
| 1.2 | Win x64 portable | Extract `.zip`, run `Jellyfin Desktop.exe` | Same, no install |
| 1.3 | Win ARM64 installer/zip | Install/run on ARM64 Windows | Launches (first-ever ARM run) |
| 1.4 | macOS arm64/x86_64 `.dmg` | Drag to Applications, launch | Launches (ad-hoc: right-click Open on first run) |
| 1.5 | `.deb` (your distro) | `sudo apt install ./<file>.deb`, run `jellyfin-desktop` | Launches, `--version` prints 2.1.0 |
| 1.6 | `.AppImage` | `chmod +x`, launch | Launches |

## 2. Core playback smoke (one Windows + one other OS minimum)

1. Connect to a real server (HTTP + HTTPS if available).
2. Play a movie: video + audio correct, seeking works.
3. Fullscreen in/out 3x (button + F11/Esc); move window across monitors if two exist.
4. Subtitles on/off; external SRT if available (expect correct scale — #643 fix).
5. Volume keys + mute; 10-minute soak play (note any freeze/stutter with timestamp).

## 3. Issue probes (the reason this runbook exists)

### 3.1 Trailers with/without GPU (#1160) — Windows, any GPU
1. Play any item with a trailer/cinema-mode intro. If it plays: PASS, note GPU model.
2. If it fails/black-screens: relaunch with `--disable-gpu`, retry the same trailer.
   - Trailer works with `--disable-gpu` -> evidence for the GPU-decode hypothesis; FAIL (bug present), attach log.
   - Still fails -> different cause; FAIL, attach log + GPU model.
3. If a YouTube-trailer error dialog/console line appears, record the exact
   `onError` code (open devtools via `--remote-debugging-port 9222`, read console).

### 3.2 Fullscreen/NVIDIA matrix (#1079) — Windows 11 + NVIDIA
1. Play video, enter fullscreen on the primary monitor, exit. Repeat on the
   secondary monitor if present. PASS = clean transitions, no black screen.
2. With OS HDR on (if the monitor supports it): enter/exit fullscreen; note any
   stuck HDR state or washed-out UI after exit.

### 3.3 GPU raster removal (#1112) — any OS with discrete GPU
1. Play high-motion 1080p+ content fullscreen for 5 minutes.
2. PASS = no checkerboard tiles, no flicker, no GPU-process crash lines in the log.
   (Forensics option: `--remote-debugging-port`, inspect GraphicsFeatureStatus.)

### 3.4 Pre-AVX2 CPU (#1248) — old CPU or VM with AVX2 disabled
1. Launch the x64 build. EXPECTED: a message box naming the missing AVX2 media
   library, then a clean exit (no `0xc0000142`, no silent crash). Record exit code.
2. If it launches and plays normally, record CPU model (fallback worked end to end).

### 3.5 CoreAudio hotplug — macOS
1. Start playback, then switch output device (Speakers -> AirPods/Bluetooth) mid-play.
2. PASS = audio follows or pauses cleanly; FAIL = crash (attach the macOS crash
   report + app log).

### 3.6 Flatpak flicker — Linux Flatpak (if available)
1. Run the Flatpak build, play video windowed + fullscreen.
2. PASS = no flicker; note compositor (X11/Wayland) either way.

## 4. Offline Phase 0 probes (gates offline Phase 1)

On any desktop build connected to your real server, open devtools
(`--remote-debugging-port 9222` -> `http://localhost:9222`), paste on any item
page (replace `<ITEM_ID>`; get it from the item URL):

```js
const plan = await window._downloadSpike.probeDownloadPlan({
    serverUrl: ApiClient.serverAddress(),
    token: ApiClient.accessToken(),
    userId: (await ApiClient.getCurrentUser()).Id,
    itemId: '<ITEM_ID>'
});
console.log(JSON.stringify(plan, null, 2));
```

Run once each for a **movie**, an **episode**, and an **audio track**. Record
per item: `kind`, `resumable`, `rangeStatus`, `warning`, `burnInOnly`.
- `kind "direct"` + `rangeStatus 206` on all three -> GREEN, Phase 1 approved.
- `hls-only`/`no-source` on the primary library -> STOP, report back (profile rework first).

## 5. Plugin Phase 0 smoke

1. Create `<profile-dir>/plugins/demo/plugin.json` (valid: `id`, `version`,
   `apiVersion: 1`, `tier: "web"`, `entry`) plus one with a bad `entry`
   (`../escape`).
2. Launch, read the log. PASS = `Found plugin: demo` + `Skipping invalid
   plugin` lines, no startup failure.

## 6. Report-back table

| Item | Result | Evidence (one line) |
|------|--------|---------------------|
| 1.1-1.6 (each artifact) | PASS/FAIL/SKIP(no hw) | |
| 2 core smoke | | |
| 3.1 trailers | | GPU model, --disable-gpu result, onError code |
| 3.2 NVIDIA matrix | | |
| 3.3 raster | | |
| 3.4 pre-AVX2 | | exit code / CPU |
| 3.5 CoreAudio | | |
| 3.6 Flatpak | | compositor |
| 4 offline probes | | 3 result blocks |
| 5 plugin smoke | | log lines |
