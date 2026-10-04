# Jellyfin Neo v2.1.0 (DRAFT — do not publish as-is)

First stable release of the Neo fork. Cut only after: full CI matrix green,
Windows portable + installer smoke, macOS DMG launch on both archs, AppImage
launch, and a playback pass against a real server.

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
- Offline downloads: server-negotiation probes only; queue/UI still in progress.
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
