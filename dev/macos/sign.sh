#!/usr/bin/env sh
# Sign and verify a macOS app bundle. Uses ad-hoc signing when no identity exists.
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/common.sh"
APP_PATH="${1:-$BUILD_DIR/src/$APP_NAME}"
ENTITLEMENTS="$SCRIPT_DIR/jellyfin-desktop.entitlements"

if [ ! -d "$APP_PATH" ]; then
    echo "error: app bundle not found: $APP_PATH" >&2
    exit 1
fi

IDENTITY="${MACOS_SIGNING_IDENTITY:-}"
if [ -z "$IDENTITY" ]; then
    codesign --force --deep --sign - "$APP_PATH"
    codesign --verify --deep --strict "$APP_PATH"
    exit 0
fi

TIMESTAMP="--timestamp"
if [ "${MACOS_CODESIGN_TIMESTAMP:-}" = none ]; then
    TIMESTAMP="--timestamp=none"
fi

# Sign Mach-O executables and libraries before signing their containing bundles.
for SIGN_DIR in "$APP_PATH/Contents/Frameworks" "$APP_PATH/Contents/PlugIns"; do
    if [ -d "$SIGN_DIR" ]; then
        find "$SIGN_DIR" -type f -print | while IFS= read -r FILE; do
            if file "$FILE" | grep -q 'Mach-O'; then
                codesign --force "$TIMESTAMP" --options runtime --sign "$IDENTITY" "$FILE"
            fi
        done
    fi
done

find "$APP_PATH/Contents" -depth -type d \
    \( -name '*.framework' -o -name '*.app' \) -print | \
    while IFS= read -r BUNDLE; do
        case "$BUNDLE" in
            *.app)
                codesign --force "$TIMESTAMP" --options runtime \
                    --entitlements "$ENTITLEMENTS" --sign "$IDENTITY" "$BUNDLE"
                ;;
            *)
                codesign --force "$TIMESTAMP" --options runtime --sign "$IDENTITY" "$BUNDLE"
                ;;
        esac
    done

codesign --force "$TIMESTAMP" --options runtime \
    --entitlements "$ENTITLEMENTS" --sign "$IDENTITY" "$APP_PATH"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
