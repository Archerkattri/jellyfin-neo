#!/usr/bin/env bash
# Run a local Linux build with the matching aqt Qt runtime.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
QT_VERSION="${QT_VERSION:-6.11.3}"
QTROOT="${SCRIPT_DIR}/deps/qt/${QT_VERSION}/gcc_64"
BINARY="${PROJECT_ROOT}/build/src/jellyfin-desktop"

if [[ ! -x "${BINARY}" ]]; then
	echo "error: executable not found at ${BINARY}. Run dev/linux/build.sh first." >&2
	exit 1
fi
if [[ ! -d "${QTROOT}/lib" || ! -d "${QTROOT}/plugins" || ! -d "${QTROOT}/qml" ]]; then
	echo "error: Qt ${QT_VERSION} runtime not found at ${QTROOT}. Run dev/linux/setup.sh first." >&2
	exit 1
fi

export LD_LIBRARY_PATH="${QTROOT}/lib${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
export QT_PLUGIN_PATH="${QTROOT}/plugins"
export QT_QPA_PLATFORM_PLUGIN_PATH="${QTROOT}/plugins/platforms"
export QML_IMPORT_PATH="${QTROOT}/qml"
export QML2_IMPORT_PATH="${QTROOT}/qml"
if [[ -x "${QTROOT}/libexec/QtWebEngineProcess" ]]; then
	export QTWEBENGINEPROCESS_PATH="${QTROOT}/libexec/QtWebEngineProcess"
fi

exec "${BINARY}" "$@"
