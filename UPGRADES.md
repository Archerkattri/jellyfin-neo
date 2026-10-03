# Jellyfin Desktop — Upgrades Wishlist

> Note: `research_notes/` wave records and `reports/` live in the private build archive, not the public tree — path mentions below refer to that archive.
Consolidated from GitHub issues/PRs (ranked by reactions), `features.jellyfin.org`
(Fider votes), Jellyfin forum threads, Reddit/HN sentiment, YouTube reviews, and
Plex-churn research. Researched Oct 2026. v2.1.0 is the current checkout.

Status legend: `wanted` = no known PR · `PR #n` = open PR exists ·
`v3` = expected in upstream v3 rewrite · `server` = server-side, not desktop scope.
`done` = implemented in this checkout (wave 1, 2026-10-02, JS suite 36/36 green).

Release-gate companion: [Jellyfin Desktop Roadmap Update](reports/Jellyfin%20Desktop%20Roadmap%20Update.md)
(Sep 23–Oct 2, 2026 delta: v2.1.0 blockers, Qt baseline, PR review cautions).

## 1. Playback core (highest demand)

| Upgrade | Demand / source | Status |
|---|---|---|
| True HDR output (HLG/PQ BT.2020/2084), no forced SDR tone-map | [#523](https://github.com/jellyfin/jellyfin-desktop/issues/523) (33 reactions), [#972](https://github.com/jellyfin/jellyfin-desktop/issues/972) macOS washed-out, [#897](https://github.com/jellyfin/jellyfin-desktop/issues/897) tonemap regression, forum "Desktop cannot output HDR" | `partial` (gated setting + HDR diagnostics landed; full output blocked and HARDENED: mpv#18343 closed not-planned, no Vulkan/HDR render API for embedders, no HDR Qt Quick in 6.11 — see research_notes/wave3/hdr-spike.md; wave 7 re-check of prerelease channels: still blocked, zero 2026 movement toward output (Qt 6.12 has reporting-only ICC color-space item, mpv render.h 0 commits); new triggers: mpv#16818 gpu-next backend merge / lhc70000 follow-up PR, any MPV_RENDER_API_TYPE_* addition, QTBUG-126035 fix version; fork report validates the subsurface-bypass design — see research_notes/wave7/hdrmove-REPORT.md) |
| Refresh-rate / resolution switching (Kodi/Plex-HTPC parity) | Long-standing ask; broken on Wayland [#1195](https://github.com/jellyfin/jellyfin-desktop/issues/1195) | `done` for KDE Wayland (`PR #1246` ported with runtime detection + fallback); other compositors blocked on protocol support |
| TrueHD Atmos / DTS:X bitstream passthrough over PC HDMI | Forum cluster ("Can't play Dolby TrueHD + Atmos", "DTS:X passthrough"); [#338](https://github.com/jellyfin/jellyfin-desktop/issues/338) TrueHD-stereo-no-sound open | `done` (already implemented: devicetype+per-codec toggles → mpv audio-spdif; regression test added) |
| Configurable buffer/cache size ("buffer X min/MB before playing") | [#1000](https://github.com/jellyfin/jellyfin-desktop/issues/1000) (top open by engagement); 4K-over-WiFi stutter | `done` (demuxer_backbuffer/demuxer_readahead settings + test) |
| Fix fullscreen breakage (black screen, 2nd-monitor exit, HDR state corruption) | [#1079](https://github.com/jellyfin/jellyfin-desktop/issues/1079), [#1187](https://github.com/jellyfin/jellyfin-desktop/issues/1187) Win11, [#1085](https://github.com/jellyfin/jellyfin-desktop/issues/1085) state not reset | `partial` (#1085 + #1187-stuck FIXED: restore host fullscreen in removeMediaDialog; #1079 blocked with driver-layer analysis + instrumentation matrix; #1187-switch-glitch needs frame-alignment record) |
| AV Sync default → Resample (current default stutters/jumps) | [#1117](https://github.com/jellyfin/jellyfin-desktop/issues/1117) | `done` (sync_mode default + test) |
| Audio-track selection for transcoded media | `PR #1243` | `done` (branch already equivalent; verified + test delta ported) |
| Segment auto-skip (intro/recap) | `PR #1229`; Plex has skip intro; Fider trailers/skip asks | `done` (branch already superset; verified + 2 test asserts ported) |
| Force-transcoding / quality options in client settings | Old-client parity ask; Fider "better transcoding control" (85) | `done` (max_streaming_bitrate cap via device profile) |
| External player support (launch VLC/mpv) | Fider 65 votes | `done` (external_player handoff via openExternalUrl; one-way, video only) |
| Choose DV vs HDR output | Fider 19 votes | `done` (hdr_preference auto/dovi/hdr10 in device profile) |

## 2. Subtitles

| Upgrade | Demand / source | Status |
|---|---|---|
| Dual/secondary subtitles (e.g. original + translation) | [#482](https://github.com/jellyfin/jellyfin-desktop/issues/482) (47 reactions) refiled as [#1223](https://github.com/jellyfin/jellyfin-desktop/issues/1223); jellyfin-web 10.9 already has it | `partial` (native secondary-sid wiring + settings + JS bridge done; picker UI lives in jellyfin-web) |
| Fix auto-loaded subs rendering crammed/misformatted | [#643](https://github.com/jellyfin/jellyfin-desktop/issues/643) (35 reactions) | `done` (wave 7: invisible auto re-select workaround landed — one-shot sid no→N on first position event for auto-selected tracks, default-on setting, 4 tests, suite 77/77; upstream mpv#17846 still open/stalled with zero activity since Jun 12, no shipping binary from any channel contains it, v0.42.0 milestone exists but 10 items out — full mpv-from-source recipe recorded for a forked-CI build; remove workaround if upstream ever merges — see research_notes/wave7/sub643-REPORT.md) |
| Restore subtitle-offset option in v2 | [#1109](https://github.com/jellyfin/jellyfin-desktop/issues/1109) (present in web player) | `done` (text subs delivered External + device-profile test) |
| Per-series default audio + subtitle language (stop resetting to dub) | [#749](https://github.com/jellyfin/jellyfin-desktop/issues/749) (29 reactions) | `done` (per-series language memory in appSettings + re-apply) |
| Offline video download must include external subtitle | [#617](https://github.com/jellyfin/jellyfin-desktop/issues/617) | `partial` (design §7 + wave-8 Phase 0 spike landed: download DeviceProfile negotiation probe + subtitle fallback-URL builder, 8 tests; Phase 1 trigger = direct+206 probe on movie/episode/track — see research_notes/wave8/offline-phase0-REPORT.md) |

## 3. Audio / volume

| Upgrade | Demand / source | Status |
|---|---|---|
| Volume over 100% (150/200/300% option) | [#1037](https://github.com/jellyfin/jellyfin-desktop/issues/1037) | `done` (max_volume chain verified + `PR #1228` wheel-volume/indicator delta ported) |
| Non-primary audio streams don't play on Linux | [#1217](https://github.com/jellyfin/jellyfin-desktop/issues/1217) | `done` (verified already-fixed: transcode→aid=1 mapping in tree + server-source proof; no-op) |
| Gapless music playback | Fider 647 votes | `done` (audio.gapless default-on → mpv gapless-audio; true E2E additionally needs audio pre-queue flow, follow-up) |

## 4. Offline / downloads

| Upgrade | Demand / source | Status |
|---|---|---|
| Download playlists/collections/albums for offline music (not one song at a time) | [#604](https://github.com/jellyfin/jellyfin-desktop/issues/604) (22 reactions); Fider Offline Sync 817 | `partial` (design delivered + wave-8 Phase 0 spike landed: probeDownloadPlan proves server negotiation before any queue/DB/UI, 8 tests, suite 91/91; Phase 1 = single-item MVP gated on green probes — see research_notes/wave8/offline-phase0-REPORT.md) |
| Offline video downloads that actually work + include subs | [#617](https://github.com/jellyfin/jellyfin-desktop/issues/617); Plex-churn: "offline sync unreliable" | `partial` (design §7 + wave-8 Phase 0: selectDownloadSubtitles/buildSubtitleUrl spike + burnInOnly surfacing, covered by the 8 offline0- tests) |

## 5. Window / UI / UX

| Upgrade | Demand / source | Status |
|---|---|---|
| Picture-in-Picture mode | [#576](https://github.com/jellyfin/jellyfin-desktop/issues/576); Fider 22 votes | `done` (minimal slice: always-on-top toggle + state safety + web feature string) |
| In-app profile/user switching + picker at launch (shared HTPCs) | [#1093](https://github.com/jellyfin/jellyfin-desktop/issues/1093) (10 reactions); v2.0 only has launch flags | `done` (WebChannel backend + Client Settings trigger; restart-based) |
| Screenshot keybind + configurable path (`screenshot-template`) | [#532](https://github.com/jellyfin/jellyfin-desktop/issues/532) (22 reactions) | `done` (takeScreenshot + Ctrl+S + settings + 2 tests) |
| UI performance (laggy vs web UI) | [#299](https://github.com/jellyfin/jellyfin-desktop/issues/299) (55 reactions, closed); still cited in 2026 comparisons | `partial` (static audit complete: 2 safe wins landed — per-event settings lookup + popup-filter cast; dominant cost likely WebEngine layer compositing, needs runtime A/B) |
| Remember window size/position | [#1065](https://github.com/jellyfin/jellyfin-desktop/issues/1065) | `done` (size-wipe + screen-key + stale-screen fixes + test) |
| ESC exits fullscreen; Backspace/Esc navigation | [#1056](https://github.com/jellyfin/jellyfin-desktop/issues/1056) | `done` (`#1227` + `PR #1239` both verified branch-equivalent) |
| Fix Linux right-click-after-fullscreen, input grab | [#166](https://github.com/jellyfin/jellyfin-desktop/issues/166), [#175](https://github.com/jellyfin/jellyfin-desktop/issues/175) open | `done` for #175 (web-gamepad kill switch + SDL setting exposed); `blocked` for #166 (no in-repo cause; Qt/Chromium menu-grab suspect — see research_notes/wave3/input-grab.md) |
| Fix YouTube trailers not playing (worked in 1.12) | [#1160](https://github.com/jellyfin/jellyfin-desktop/issues/1160) | `blocked` (log forensics: YT onError ~1s AFTER PLAYING starts; mpv/UA/codecs/popup ruled out with evidence; prime suspect = GPU-decode failure after --disable-gpu removal — decisive test: `--disable-gpu` trailer run; web one-liner follow-up noted) |
| Fix logging deadlock + watch-history loss | `PR #1240` | `done` (branch equivalent, verified no-op) |
| Fix macOS CoreAudio hotplug crash (audio-device change, incl. Bluetooth) | [#1247](https://github.com/jellyfin/jellyfin-desktop/issues/1247) (repro + mpv-revision pin needed; mpv PR #18383 predates window) | `done` (CLOSE: fix commit verified inside pinned mpv via compare API + inside Homebrew mpv via backport patch — current builds on both platforms include it) |
| Xbox/controller input ignored when window not focused (Linux) | [#950](https://github.com/jellyfin/jellyfin-desktop/issues/950) | `done` (Linux Xbox idmatcher fixed to SDL evdev names + DS4 de-collision + SDL hint ordering) |
| OSD title, pinch-to-zoom video, media-keys polish | [#1136](https://github.com/jellyfin/jellyfin-desktop/issues/1136), [#116](https://github.com/jellyfin/jellyfin-desktop/issues/116), [#3](https://github.com/jellyfin/jellyfin-desktop/issues/3) (closed) | `done` (OSD title on track change; Ctrl+wheel/pinch video zoom 0.5x–4x + toggle) |

## 6. Platform / packaging

| Upgrade | Demand / source | Status |
|---|---|---|
| Windows ARM64 binaries (stop x86 emulation on battery) | [#214](https://github.com/jellyfin/jellyfin-desktop/issues/214) | `done` (ARM64 CI job on windows-11-arm + WINARCH scripts + packaging; `#1251` shim declined; needs first CI run — verified 2026-10-02: windows-11-arm GA + FREE on public repos, no billing blocker) |
| Wayland: refresh-sync, display switching, Flatpak GUI flicker | [#1195](https://github.com/jellyfin/jellyfin-desktop/issues/1195), [#1112](https://github.com/jellyfin/jellyfin-desktop/issues/1112) | `done` for #1195-class switching on KDE (`PR #1246`); `done` for #1112 root cause (removed forced --enable-gpu-rasterization that exhausted tile memory; GUI retest + chrome://gpu before/after still wanted) |
| macOS: cursor-hide, window snapping, signing | `PR #1245`, `PR #1244`, `PR #1241` (draft) | `done` (#1245 delta ported; #1244 + #1241 verified already-present no-ops) |
| Desktop auto-updates | Fider 14 votes | `partial` (one-click direct installer download; silent auto-install blocked per-OS with design — elevation, Gatekeeper, install-type split) |
| Fix Windows startup failure on pre-AVX2 CPUs (`0xc0000142`); establish supported CPU baseline | [#1248](https://github.com/jellyfin/jellyfin-desktop/issues/1248) (mpv fallback exists; Qt/WebEngine baseline unverified) | `partial` (RE-SCOPED: pre-AVX2 CAN run the app — Qt/SSE2, Chromium/SSE3; 0x142 is DLL_INIT_FAILED not illegal-instruction, so no AVX2 gate; graceful MessageBox+exit patched for missing/failed fallback; true root cause needs reporter dump) |

## 7. Extensibility

| Upgrade | Demand / source | Status |
|---|---|---|
| Client plugin API (unblocks Discord Rich Presence, Chromecast w/o proprietary blobs) | [#1186](https://github.com/jellyfin/jellyfin-desktop/issues/1186) | `partial` (design + wave-8 Phase 0 skeleton landed: src/plugins/api/ contract + fail-closed manifest validator + profile scanner, JS mirror + 6 tests, suite 91/91; Phase 1 = Tier-1 web-plugin loading when a consumer exists — see research_notes/wave8/plugin-phase0-REPORT.md) |

## 8. Plex-churn drivers (why people won't switch / why they leave Plex)

Jellyfin's openings, from HN/Reddit/press (Jun–Jul 2026):

- **Client polish gap** — "Some client apps aren't as polished as Plex's" (How-To Geek). Fix: UI speed + stability items in §5.
- **DVR + recurring bugs + Roku app** — "tries Jellyfin every ~6 months, returns to Plex" (HN). DVR/Roku are `server`/other-client scope; desktop contributes via stability.
- **Live TV / IPTV guide quality** — "complete trash, no good guide" (HN). Mostly `server` scope (12.0 shipped EPG/HDHomeRun/M3U fixes); desktop should surface guide cleanly.
- **Hardware-transcoding setup friction** — manual settings vs Plex one-click. Partly desktop (setup wizard/defaults), partly `server`.
- Plex's self-inflicted wounds (lifetime $750, social-app bloat, Hetzner blocking) are driving users our way — stability + onboarding is the highest-leverage work.

Third-party clients (Findroid, Streamyfin, Swiftfin, Finamp) lead desktop on:
offline support, downloads, skip segments, and UI polish — see §2/§4/§5.

## 9. Harvestable open PRs (verified 2026-10-02, merge-readiness NOT yet checked)

| PR | What it implements | Maps to |
|---|---|---|
| [#1243](https://github.com/jellyfin/jellyfin-desktop/pull/1243) | Audio-track selection for transcoded media | §1 — reviewed, branch equivalent |
| [#1240](https://github.com/jellyfin/jellyfin-desktop/pull/1240) | Logging-deadlock + watch-history-loss fix | §5 — reviewed, branch equivalent |
| [#1249](https://github.com/jellyfin/jellyfin-desktop/pull/1249) / [#1250](https://github.com/jellyfin/jellyfin-desktop/pull/1250) / [#1251](https://github.com/jellyfin/jellyfin-desktop/pull/1251) | ARM/WGL startup-crash stack | §6 — #1249+#1250 ported, #1251 declined (IAT hook, no ARM hw) |
| [#1246](https://github.com/jellyfin/jellyfin-desktop/pull/1246) | KDE Wayland display switching | §1/§6 — ported with runtime detection + fallback |
| [#1245](https://github.com/jellyfin/jellyfin-desktop/pull/1245) | macOS cursor hide | §6 — delta ported (reset slot + app-wide filter + JS bridge) |
| [#1244](https://github.com/jellyfin/jellyfin-desktop/pull/1244) | macOS window snapping | §6 — reviewed, branch superset |
| [#1241](https://github.com/jellyfin/jellyfin-desktop/pull/1241) (draft) | macOS signing | §6 — reviewed, local flow stricter (no-op) |
| [#1239](https://github.com/jellyfin/jellyfin-desktop/pull/1239) | Esc/Backspace navigation | §5 — reviewed, branch equivalent |
| [#1229](https://github.com/jellyfin/jellyfin-desktop/pull/1229) | Segment auto-skip | §1 — reviewed, branch superset |
| [#1228](https://github.com/jellyfin/jellyfin-desktop/pull/1228) | Volume clamp/boost | §3 — ported (wheel volume + indicator + tests) |
| [#1227](https://github.com/jellyfin/jellyfin-desktop/pull/1227) | Esc-fullscreen handling | §1/§5 — reviewed, branch equivalent |

Review cautions (from roadmap report, Sep 23–Oct 2 delta):

- `#1249`–`#1251` are stacked proposals, not merged fixes. `#1251` adds an
  invasive GPU-interop hook — needs strong review + hardware testing before any take.
- `#1249` cites QtWebEngine 6.9; compatibility with this branch's Qt 6.11.3 baseline
  must be tested, not assumed. `#1250` fixes Chromium flag plumbing (`--disable-gpu`
  not reaching Chromium; app flags clobbering `QTWEBENGINE_CHROMIUM_FLAGS`).
- `#1246` (KDE Wayland refresh switching) is compositor-specific: take only with
  runtime protocol detection + fallback.
- `#1245` (fullscreen cursor): compare against local behavior first; cosmetic.
- v2.1.0 is now on Qt 6.11.3 (wave 7: online-repo binaries proven to contain the QTBUG-141377
  fix; Linux configure + 103/103 build + ctest 6/6 green; Windows/macOS compile legs need CI).
  Exception: AppImage stays on 6.11.2 — Arch never shipped 6.11.3 and stable is still all-6.11.2
  (6.12.0 exists only in testing; no qt6-webengine 6.12.0 final anywhere — wave-8 STAY-6.11.2 decision
  with triggers, see research_notes/wave8/appimage-REPORT.md). Qt 6.12: snapshots found (wave 7) and
  extension-fetch automation landed + executed green on Linux (wave 8); 6.12 adoption still gated on
  final binaries + win/mac validation. Non-Linux 6.11.3 legs statically validated XPLAT-CLEAN (wave 8);
  actual compile still needs CI on push.

## Wave 1 — applied 2026-10-02 (10 lanes + synthesis)

- Blockers: Debian-job credential gating (fork CI fix); macOS signing three-state (ad-hoc without secrets, fail only on partial set) + CHANGELOG alignment.
- Upgrades: AV-sync default resample, demuxer cache settings, screenshot keybind + path settings, window geometry save/restore, subtitle-offset parity, volume-chain verification, PR #1227/#1243/#1229 equivalence review with test deltas ported.
- Verification: `node --test tests/player-regressions.test.mjs` 36/36 green (was 28); JSON + workflow YAML parse; C++ API usage verified by inspection (no Qt build in this environment).
- Deferred to wave 2: big-ticket items (true HDR, refresh switching, passthrough, offline, PiP, plugin API, dual subs, profile UI) + remaining PR review (#1228, #1239, #1240, #1244–#1246, ARM stack #1249–#1251 with review cautions).

## Wave 2 — applied 2026-10-02 (10 lanes + synthesis)

- PR harvests: #1228 ported (wheel volume + fullscreen indicator); #1239/#1240/#1244 verified branch-equivalent (no-op with evidence); #1245 delta ported (cursor reset slot + JS bridge); #1246 ported (KDE Wayland switching, 3-layer runtime gating, optional CMake probe); #1249+#1250 ported (WGL fallback + Chromium flag plumbing), #1251 declined (import-table hook, single-laptop evidence, no ARM hardware).
- Upgrades: PiP minimal slice (#576); in-app profile switching backend + settings trigger (#1093); dual-subtitle native slice (#482, partial — picker UI is jellyfin-web).
- Verification: `node --test tests/player-regressions.test.mjs` 48/48 green (was 36); C++ by inspection (no Qt build here); macOS/ARM/Wayland paths need platform CI + hardware smoke.

## Wave 3 — applied 2026-10-02 (9 lanes delivered, 1 silent)

- Upgrades: passthrough verified-implemented + test; gapless knob default-on; HDR experimental gated slice + full pipeline design; #175 HOTAS fix (web-gamepad kill switch + SDL setting); bitrate cap + external player + DV/HDR preference bundle; per-series track memory (#749); ARM64 CI + packaging (#214).
- Reviews: #1241 no-op (local stricter); #643 blocked with mpv-bisect diagnosis; #166 blocked (Qt/Chromium suspect); #1160 blocked (needs GUI repro).
- Missing: fix-trailers lane produced no output files (covered by owner triage instead).
- Verification: `node --test tests/player-regressions.test.mjs` 61/61 green (was 48); C++ by inspection; platform/hardware paths need CI + smoke.

## Wave 4 — applied 2026-10-02 (6 lanes + synthesis)

- Upgrades: OSD media title (#1136); pinch/Ctrl+wheel video zoom + toggle (#116); one-click update download with safe fallbacks (auto-install blocked per-OS, design recorded); Xbox Linux mapping fix (#950); #1217 verified already-fixed (no-op with server-source proof); stable-vs-nightly download docs.
- Verification: `node --test tests/player-regressions.test.mjs` 68/68 green (was 61); fixed one helper-name collision the lanes missed.
- Terminal state: every tracker row is now `done`, `partial` (with recorded next step), `blocked` (with diagnosis + repro), `v3`, or `server`. Nothing left `wanted`.

## Wave 5 — build milestone + partial losses (2026-10-02)

- FIRST REAL BUILD in this environment: Qt 6.11.2 via aqt + full compile, 103/103 build steps, 0 errors, 6/6 ctest green (independently re-run by owner twice). The no-Qt-build caveat is dead. Qt SDK persists at dev/linux/deps; build tree at /tmp/jf-first-compile/build (ephemeral — rebuildable).
- Owner fixes from build findings: setup.sh mk-build-deps now runs in a temp dir (fixes 777 DrvFs checkout failure, verified); ComponentManager QQmlPropertyMap deprecation fixed via create(), zero warnings (verified by rebuild).
- freetype follow-up DISPROVEN: libfreetype-dev Provides libfreetype6-dev on noble — debian/control is correct as-is, no change.
- Wave-5 lane outputs were mostly lost to a runtime restart (/tmp wiped): HDR + offline verdicts survive only as summaries; fullscreen/643/1160/1247-1248/perf/1112/plugin-api lane results lost. Regenerating in wave 6 to persistent storage.

## Wave 6 — unblock results (2026-10-02, 9 lanes + synthesis)

- Fixed: #1112 (forced GPU rasterization removed — tile-memory root cause), #1085 + #1187-stuck (fullscreen restore in dialog teardown), #1248 re-scoped + graceful fallback-missing handling (proven NOT AVX2-related).
- Closed by evidence: #1247 (mpv fix verified inside pinned + Homebrew mpv — current builds include it).
- Landed slices: HDR diagnostics (default-off silent), 2 UI-perf event-loop wins + full audit, offline + plugin-api architecture designs.
- Still blocked with deep diagnoses: #1160 (H1 = GPU-decode failure, `--disable-gpu` decisive test), #1079 (driver-layer matrix), #643 (mpv#17846 unmerged, pin current).
- Verification: node suite 73/73 (was 68); full Linux rebuild in persistent ~/jf-build: configure 0, build 0, 0 warnings, ctest 6/6 green. (Windows-only `#1248` MessageBox code is `_M_X64`-guarded so it was inspection-verified only — needs the Windows CI leg.)

## Wave 7 — implement the caveats: prereleases, nightlies, source builds (2026-10-03, 6 lanes + owner)

- Qt 6.11.3 BUMP IMPLEMENTED (was: conditional on packages + tests): online-repo binaries for
  linux/windows/mac install via the pinned aqt; the 6.11.3 WebEngine is PROVEN to contain the
  QTBUG-141377 fix (embedded Chromium string 153.0.8010.52, uptake change 773529); the final tree
  configures + builds 103/103 + ctest 6/6 on 6.11.3 (owner re-verified after the bump in
  ~/jf-build-6113). All aqt-pipeline pins + dev scripts + Debian packaging + docs +
  CHANGELOG moved; v2.1.0 baseline is now 6.11.3. AppImage stays on 6.11.2 (Arch never shipped
  6.11.3 — verified: qt6-base jumped 6.11.2 → 6.12.0, qt6-webengine tops out at 6.11.2) — documented
  skew until Arch has a coherent newer set. Caveats remaining: no v6.11.3 git tags / official_releases
  tarballs yet (online-repo-only artifacts); Windows/macOS compile legs need CI on push.
- Qt 6.12 + WebEngine 6.140.0: FOUND AS SNAPSHOTS on all 3 OSes (online-repo extensions,
  version 6.12.0-0-202609281005, Linux SHA1-verified, extracted SDK structurally complete) — the
  "no 6.140 product" caveat is dead. Owner trial spike: 6.12.0 base via aqt + manual 7z overlay →
  tree configures + builds + ctest 6/6 with ZERO code changes (~/jf-build-6120, qmake
  6.12.0, WebEngine .so.6.140.0, binary `--version` smoke OK). 6.12 NOT adopted for v2.1.0:
  snapshot-not-final, extensions not aqt-installable (pinned aqt has no --extension flag — CI needs
  a new fetch step), win/mac + packaging legs unvalidated. Proven feasible: fast-follow item.
- #643 DONE without upstream: invisible auto re-select workaround merged (native/mpvVideoPlayer.js
  one-shot sid no→N on first position event for auto-selected tracks, default-on setting, 4 tests);
  suite 77/77. mpv watch: #17846 still open/stalled (zero activity since Jun 12), no shipping binary
  in any channel contains it (logic-sealed: unmerged + no equivalent in master), v0.42.0 milestone
  exists (10 open, none subtitle-related) but no tags/RC; shinchiro 20261003 (mpv 3186d369f9) has no
  fix — do NOT bump the pin. Full mpv-from-source recipe recorded (FEASIBLE-ELSEWHERE: ~8-16 h cold
  3-arch clang build; #17846 applies cleanly to master; forked-CI build recommended over this WSL
  box) — shelved as unnecessary given the workaround.
- HDR: still blocked after prerelease re-check (Qt dev/Gerrit, 6.12 notes, mpv master + open PRs,
  Windows 2026 updates) — zero movement toward display output; new triggers recorded (mpv#16818
  gpu-next merge or lhc70000 follow-up PR, any MPV_RENDER_API_TYPE_* addition, QTBUG-126035 fix
  version, target-colorspace-hint manual change); fork report validates the subsurface-bypass design.
- Infra note: the wave-7 workflow args arrived as an encoded string, so lane output paths did not
  resolve — lanes improvised (reports in tree root + ~ + /tmp, incl. one missing report
  reconstructed by the owner from scratch). Owner evacuated all lane dirs, verified the tree
  byte-identical to the pre-wave backup before merging, and archived all six reports (+ build logs)
  to research_notes/wave7/.
- Verification: node suite 77/77 (was 73); 6.11.3 rebuild + ctest 6/6 on the final tree; 6.12.0 +
  6.140.0 configure + build + ctest 6/6 green with no source changes. Reports: research_notes/wave7/
  (qt6113, qt6140-reconstructed, mpvwatch, mpvsrc, sub643, hdrmove).

## Wave 8 — remaining work: fetch automation, Phase 0 spikes, AppImage, xplat (2026-10-03, 5 lanes + owner)

- Qt 6.12 extension-fetch automation LANDED (dev/qt/fetch-qtwebengine-ext.sh + .ps1, CI wiring in
  win/mac workflows + Debian Dockerfile, dev setup.sh/setup.bat gates, docs): version-gated so 6.11.x
  is untouched; fail-closed SHA1 from per-archive sidecars; idempotent + --check-only. Key lane finds:
  pinned aqt resolves `-m qtwebengine` on 6.12 to the STALE JULY snapshot (callers must omit it — wired);
  the webview plugin archive is required too (owner's manual SDK lacked it — script completed it);
  win-ARM64 extension EXISTS, mac is universal (no separate arm64). Owner executed the merged script
  end-to-end on Linux: download + verify + extract + check-only all green. Win/mac/powerShell paths
  verified as far as possible without those hosts (parse + download/verify/tamper logic executed under
  pwsh; archive listings + HEAD checks live). 6.12 adoption still gated on final binaries + win/mac runs.
- Offline Phase 0 spike LANDED (native/downloadSpike.js + 1-line SystemComponent injection + 8 tests):
  POSTs PlaybackInfo with a download DeviceProfile, fetches one ranged byte (206 proves resume), builds
  static/transcode/fallback URLs + subtitle fallback URLs with burnInOnly surfacing. Zero behavior change
  unless invoked from console. Phase 1 (DownloadComponent + queue MVP) gated on direct+206 probes for a
  movie, an episode, and a track; hls-only/no-source verdicts STOP the build and reroute to the profile.
- Plugin API Phase 0 skeleton LANDED (src/plugins/api/ contract + fail-closed manifest validator +
  profile scanner + CMake wiring, JS validator mirror + 6 tests, 398+/0-): scans <profile>/plugins/*,
  never fails startup, no loader behavior change (guard test asserts it). Compiles clean in the real
  build (new TUs + AUTOMOC + add_subdirectory wiring proven). Phase 1 (Tier-1 web loading) starts when
  a consumer exists; scanner output is its input list.
- AppImage verdict: STAY-6.11.2, no tree change. Pinned ARCH_SNAPSHOT=2026/08/29 is coherent,
  immutable, still served; aqt-switch spiked statically (feasible via USE_STATIC_MPVQT precedent)
  but NOT justified (real surgery + slower CI + WebEngine repackaging risk for zero API gain);
  Arch-6.12 declared BROKEN (no webengine 6.12.0 final anywhere; stable still all-6.11.2 — corrects
  the wave-7 "jumped to 6.12.0" shorthand: 6.12.0-1/2 are testing/staging only). Triggers recorded;
  2026/10/02 pre-verified as fallback snapshot.
- xplat-verify: XPLAT-CLEAN, zero defects. Workflows parse; every 6.11.3 arch/module combo exists
  under the pinned aqt (win x64 + ARM64-cross + mac universal, qtwebengine/qtpdf present); no version
  stray outside the deliberate AppImage pair + history; CMakePresets paths match installer layouts;
  Debian 4-way gate unanimous on 6.11.3; repo's own alignment test passes (after the wave-8 update below).
- Owner merge fixes: plugin patch lacked `new file mode` headers (git apply rejected /dev/null —
  repaired byte-preserving after a first ASCII attempt stripped CRs and taught the lesson); Qt
  version-alignment test updated for the parameterized macOS workflow (reads top-level env + locks
  the `${{ env.QT_VERSION }}` wiring instead of a literal). Offline in-patch tests verified identical
  to the separate file (no double-append); plugin guard test confirmed offline-compatible (no entry
  counting). Suite 91/91 (was 77). Reports: research_notes/wave8/ (qt612-fetch, offline-phase0,
  plugin-phase0, appimage, xplat).
- Verification: node suite 91/91; incremental rebuild on Qt 6.11.3 incl. new plugin TUs (relink
  clean) + ctest 6/6; fetch script executed end-to-end by owner; workflow YAML re-parsed
  post-apply. All green on the final tree.

## Wave 9 — production sweep: de-slop, hygiene, push readiness (2026-10-03, 6 lanes + owner)

- C++ (2 fixes): F1 fail-open narrowing bug in the plugin manifest validator (apiVersion 1e30-class
  doubles → UB cast → accepted; now rejected in the double domain, matching the JS mirror); F2
  MessageBox duplication folded into one helper (strings script-verified byte-identical). Long
  considered-left list (house-style banners/braces, fail-closed boundary checks, Phase-0 surfaces).
- JS (91/91 on lane copy): 1 restating comment removed; test-helper dedup (settings lookup x13,
  Player construction x3, fullscreen setups x3 — all mutation-proven live); 3 dishonest test names
  renamed (assertions unchanged); 958 LF lines restored to CRLF in 7 upstream-convention files.
  All console.log/diagnostics proven upstream-verbatim or pattern-mirroring — left.
- Docs (14 files): real accuracy fixes — macOS log path profiles/ segment, mpv config-dir reword,
  nonexistent --software-rendering → --disable-gpu (2 READMEs), MinGW/WiX attribution, qtserialport
  module list, bug template paths + OS/version examples, 103/103 steps (not TUs), personal paths →
  ~ forms, 👍 → reactions, dead C:/ links → relative, freetype + fider + QNAM corrections in notes.
- Repo: .gitignore safety net (dev/*/deps/, build/, *.log, *.7z, venvs, node, scratch dirs) + .gitattributes
  (* text=auto, sh→LF, bat→CRLF, debian LF). Broad-add sweep measured 12,976 files incl. 2.1 GB SDK —
  now just the legit source set. 8 CRLF-shebang scripts normalized (one would have reddened macOS CI);
  2 executable .cpps fixed; empty debian/install removed (launcher ships via CMake); AppRun +x confirmed
  in Dockerfile; submodule pointer verified exact-match (2ebbd38, no drift).
- Secrets: ZERO secrets/tokens/keys/emails/private hosts. 33 personal-path lines scrubbed to portable
  forms (14 files); all 7 workflows read fully — fork-safe (upstream credentials unreachable from fork
  runs, no owner/repo hardcodes). Residual: internal process detail in notes (archived out, see below).
- Build audit: zero genuine TODO/FIXME (9 false positives tabled); 15 lines of per-playback MPV tracers
  + 1 stray printf removed; version strings coherent (6.11.3 everywhere except deliberate AppImage pair);
  counts match reality (91/91 executed, 6/6 ctest from LastTest.log, 103 steps for the build documented);
  compiler flags sane (Wall/Wextra/shadow, no blanket -Werror, Release/LTO, no debug defines).
- Owner merges + renames: 3 patch overlaps hand-resolved (docs↔secrets UPGRADES/build-linux-qt,
  JS-EOL↔tracer-delete, subsumed .gitignore hunks); fork renamed Archerkattri/jellyfin-desktop →
  Archerkattri/jellyfin-neo (updater + README + 11 test fixtures, old name zero hits); research_notes/ +
  reports/ + aqtinstall.log archived OUT of the public tree (private archive with restore note);
  UPGRADES.md kept as the public roadmap with an archive note; unlogged "23 targets" relabeled to prose.
- Verification: node suite 91/91; post-sweep rebuild exit 0 (22 targets, 0 warnings) + ctest 6/6, log
  saved. Reports: research_notes/wave9/ in the private archive (slop-cpp/js/docs/repo/secrets/build).

## Caveat sweep (2026-10-02 websearch)

- ARM CI cost: resolved — windows-11-arm GA + free/unmetered on public repos (multiple 2026 sources). Push to run the ARM64 job.
- mpv watch items unchanged: v0.42.0 unreleased (latest v0.41.0 Dec 2025); mpv#17846 still open, untouched since Jun 12. #643/#1247 watches continue.
- Qt: no movement — 6.11.3 still absent from official_releases; no 6.140 WebEngine product in online repos; 6.12 migration still blocked on WebEngine binaries.
- Upstream jellyfin-desktop since Oct 1: only the #1249–#1251 stack (already handled). No new issues/PRs affecting the tracker.
- Hardware-bound items (#1160 GPU test, #1079 matrix, #1112 chrome://gpu, macOS/ARM smoke) still need a machine owner; macOS standard runners are also free on public repos, so CI covers compile legs on push.

## 10. Not desktop scope (tracked for awareness)

- Maintain-HDR / HDR-to-HDR transcode path (`server` transcoder tone-maps everything to SDR)
- DVR, Live TV guide backend, pre-transcoding, MySQL backend (`server`)
- Roku / VidaaOS / AppleTV / Xbox apps (other clients)
- OIDC/SSO, 2FA, passkeys (`server`)
