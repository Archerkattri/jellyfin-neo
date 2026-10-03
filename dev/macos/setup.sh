#!/usr/bin/env sh
# Jellyfin Desktop - macOS dependency installer
# Run once to install all build dependencies
set -eu

SCRIPT_DIR="$(cd "$(dirname "${0}")" && pwd)"
. "${SCRIPT_DIR}/common.sh"

echo "[1/5] Checking Xcode Command Line Tools..."
if ! xcode-select -p > /dev/null 2>&1; then
    echo "Installing Xcode Command Line Tools..."
    xcode-select --install
    echo "Please re-run this script after installation completes"
    exit 0
fi

echo "[2/5] Checking Homebrew..."
if ! command -v brew > /dev/null; then
    echo "error: Homebrew not found. Install from https://brew.sh" >&2
    exit 1
fi

echo "[3/5] Installing build tools..."
brew install python@3.12 mpv ninja cmake create-dmg

AQT_ENV="${DEPS_DIR}/aqt-venv"
PYTHON312="$(brew --prefix python@3.12)/bin/python3.12"
if [ ! -x "${AQT_ENV}/bin/python" ]; then
    "${PYTHON312}" -m venv "${AQT_ENV}"
fi
"${AQT_ENV}/bin/python" -m pip install --disable-pip-version-check --upgrade \
    "git+https://github.com/miurahr/aqtinstall.git@8c3695d4a4e1ceabf6a74dc6c79681656dc6b74b"

echo "[4/5] Installing Qt ${QT_VERSION}..."
# Qt 6.12 ships WebEngine only as an online-repo extension that the pinned
# aqt cannot fetch, so 6.12 installs skip qtwebengine here and complete the
# SDK with dev/qt/fetch-qtwebengine-ext.sh below.
QT_MODULES="qtwebengine qtwebchannel qtpositioning qtserialport"
case "${QT_VERSION}" in
6.12*) QT_MODULES="qtwebchannel qtpositioning qtserialport" ;;
esac
if [ ! -d "${DEPS_DIR}/qt/${QT_VERSION}/macos" ]; then
    mkdir -p "${DEPS_DIR}/qt"
    (cd "${DEPS_DIR}" && "${AQT_ENV}/bin/python" -m aqt install-qt mac desktop "${QT_VERSION}" -m ${QT_MODULES} -O "qt")
else
    echo "Qt already installed, skipping"
fi
case "${QT_VERSION}" in
6.12*)
    echo "Installing Qt WebEngine 6.140 extension..."
    "${PROJECT_ROOT}/dev/qt/fetch-qtwebengine-ext.sh" --qt-root "${DEPS_DIR}/qt/${QT_VERSION}/macos" \
        --qt-version "${QT_VERSION}" --arch clang_64 --python "${AQT_ENV}/bin/python"
    ;;
esac

echo "[5/5] Generating CMakePresets.json..."
BREW_PREFIX="$(brew --prefix)"
sed -e "s|@QT_VERSION@|${QT_VERSION}|g" \
    -e "s|@BREW_PREFIX@|${BREW_PREFIX}|g" \
    "${SCRIPT_DIR}/../CMakePresets.json.in" > "${PROJECT_ROOT}/CMakePresets.json"

echo ""
echo "Setup complete. Run build.sh to build."
