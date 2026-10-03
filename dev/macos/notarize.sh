#!/usr/bin/env sh
# Submit a signed DMG to Apple and staple its notarization ticket.
set -eu

DMG_PATH="${1:?usage: notarize.sh path-to-dmg}"
KEY_FILE="${NOTARY_API_KEY_FILE:-}"
KEY_ID="${NOTARY_API_KEY_ID:-}"
ISSUER_ID="${NOTARY_API_KEY_ISSUER:-}"
PROFILE="${NOTARY_PROFILE:-}"

if [ -z "$PROFILE" ] && [ -z "$KEY_FILE" ] && [ -z "$KEY_ID" ] && [ -z "$ISSUER_ID" ]; then
    echo "notarization skipped: credentials are not configured"
    exit 0
fi
if [ -z "$PROFILE" ] && { [ -z "$KEY_FILE" ] || [ -z "$KEY_ID" ] || [ -z "$ISSUER_ID" ]; }; then
    echo "error: notarization credentials are incomplete" >&2
    exit 1
fi
if [ -z "$PROFILE" ] && [ ! -f "$KEY_FILE" ]; then
    echo "error: notarization key not found: $KEY_FILE" >&2
    exit 1
fi
if [ ! -f "$DMG_PATH" ]; then
    echo "error: DMG not found: $DMG_PATH" >&2
    exit 1
fi

if [ -n "$PROFILE" ]; then
    xcrun notarytool submit "$DMG_PATH" --keychain-profile "$PROFILE" --wait
else
    xcrun notarytool submit "$DMG_PATH" --key "$KEY_FILE" --key-id "$KEY_ID" --issuer "$ISSUER_ID" --wait
fi
xcrun stapler staple "$DMG_PATH"
xcrun stapler validate "$DMG_PATH"
