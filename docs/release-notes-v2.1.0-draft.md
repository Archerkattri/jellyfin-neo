# Jellyfin Neo v2.1.0 release notes (planning draft)

The published notes are the `## v2.1.0` section of CHANGELOG.md (also the
GitHub Release body, extracted automatically at tag time). This file keeps
the planning list and the verification record.

## Verification record for the v2.1.0 cut

- Full CI matrix green on every platform (Windows x64/ARM64, macOS
  arm64/x86_64, AppImage, Debian/Ubuntu) plus node 156/156.
- Windows portable smoke passed on the owner machine (launch, no crash).
- NOT verified before cut: macOS DMG first launch, AppImage first launch,
  and playback against a real server (no server was available). Buyer
  beware on those paths; see Known limitations.

## Highlights

- Plugin system (Phase 1): loader, per-plugin settings, sample theme plugin
- Subtitle reliability: auto-selected-track fix, secondary-subtitle wiring,
  per-series language memory, subtitle offset option
- Playback: TrueHD Atmos / DTS:X passthrough toggles, configurable
  buffer/cache, gapless music, resample A/V-sync default, segment auto-skip,
  per-client bitrate cap, HDR preference + diagnostics
- Everyday UX: picture-in-picture toggle, screenshot keybind (Ctrl+S), in-app
  profile switching, window size/position memory, volume boost to 300%,
  KDE Wayland refresh-rate switching
- Platform: Windows ARM64 binaries, Qt 6.11.3, macOS cursor/window fixes,
  CoreAudio hotplug fix in the bundled mpv, Windows pre-AVX2 fallback libmpv

## Known limitations

- True HDR output is still blocked upstream (mpv render API + Qt Quick).
- Offline downloads: Phase 1 native single-file downloader with resume; queue/UI still in progress.
- macOS builds are ad-hoc signed unless signing secrets are configured. If
  Gatekeeper blocks first launch, right-click the app and choose Open.
- Intel Mac build uses conda-forge libmpv 0.41.0 (Homebrew has no Intel bottles).

## Verify your download

Every asset has a SHA256SUMS entry. Example (Linux/macOS):

```sh
sha256sum -c SHA256SUMS --ignore-missing
```

## Full changelog

See [UPGRADES.md](../UPGRADES.md) for the sourced, item-by-item list of what
changed and why.
