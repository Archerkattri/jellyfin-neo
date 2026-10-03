#!/usr/bin/env bash
# Jellyfin Desktop - Linux dependency installer
# Run once (Ubuntu/Debian) before build.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DEPS_DIR="${SCRIPT_DIR}/deps"
QT_VERSION="${QT_VERSION:-6.11.3}"
QT_ARCH="gcc_64"
QT_AQT_ARCH="linux_gcc_64"
QTROOT="${DEPS_DIR}/qt/${QT_VERSION}/${QT_ARCH}"
AQT_REVISION="8c3695d4a4e1ceabf6a74dc6c79681656dc6b74b"
AQT_ENV="${DEPS_DIR}/aqt-venv"
# Qt 6.12 ships WebEngine only as an online-repo extension that the pinned
# aqt cannot fetch, so 6.12 installs skip qtwebengine here and complete the
# SDK with dev/qt/fetch-qtwebengine-ext.sh below.
QT_MODULES="qtwebengine qtwebchannel qtpositioning qtserialport"
case "${QT_VERSION}" in
6.12*) QT_MODULES="qtwebchannel qtpositioning qtserialport" ;;
esac

if ! command -v apt-get >/dev/null; then
	echo "error: apt-get not found. This script targets Debian/Ubuntu." >&2
	exit 1
fi

echo "Installing build tooling and Python venv support..."
sudo apt-get update
sudo apt-get install --yes devscripts equivs ninja-build python3-venv git

# Keep the native build dependencies from debian/control, but do not install
# distro Qt: its version varies by release and must not be selected over aqt.
filtered_control="$(mktemp "${TMPDIR:-/tmp}/jellyfin-desktop-control.XXXXXX")"
mk_build_deps_dir="$(mktemp -d "${TMPDIR:-/tmp}/jellyfin-mk-build-deps.XXXXXX")"
trap 'rm -f "${filtered_control}"; rm -rf "${mk_build_deps_dir}"' EXIT
awk '
  /^Build-Depends:/ { in_build_depends = 1; print; next }
  in_build_depends && /^[[:space:]]*qt6-[^,]+,?[[:space:]]*$/ {
    sub(/qt6-[^,]+/, "libc6")
    print
    next
  }
  in_build_depends && /^[^[:space:]]/ { in_build_depends = 0 }
  { print }
' "${PROJECT_ROOT}/debian/control" > "${filtered_control}"

echo "Installing native build dependencies from debian/control (excluding distro Qt)..."
# mk-build-deps builds its helper .deb in the working directory and dpkg-deb
# refuses directories with over-permissive modes (e.g. 777 DrvFs checkouts),
# so run it from a private temp dir instead of the repo.
( cd "${mk_build_deps_dir}" && sudo mk-build-deps -i -r -t "apt-get --yes" "${filtered_control}" )

if [[ ! -x "${AQT_ENV}/bin/python" ]]; then
	python3 -m venv "${AQT_ENV}"
fi
"${AQT_ENV}/bin/python" -m pip install --disable-pip-version-check --upgrade \
	"git+https://github.com/miurahr/aqtinstall.git@${AQT_REVISION}"

if [[ ! -f "${QTROOT}/lib/cmake/Qt6/Qt6Config.cmake" || \
	! -f "${QTROOT}/lib/libQt6SerialPort.so.${QT_VERSION}" ]]; then
	echo "Installing Qt ${QT_VERSION} (${QT_ARCH}) with ${QT_MODULES}..."
	mkdir -p "${DEPS_DIR}/qt"
	(cd "${DEPS_DIR}" && "${AQT_ENV}/bin/python" -m aqt install-qt linux desktop "${QT_VERSION}" "${QT_AQT_ARCH}" \
		-m ${QT_MODULES} -O qt)
else
	echo "Qt ${QT_VERSION} already installed at ${QTROOT}; skipping SDK download."
fi

case "${QT_VERSION}" in
6.12*)
	echo "Installing Qt WebEngine 6.140 extension..."
	"${PROJECT_ROOT}/dev/qt/fetch-qtwebengine-ext.sh" --qt-root "${QTROOT}" \
		--qt-version "${QT_VERSION}" --python "${AQT_ENV}/bin/python"
	;;
esac

if [[ ! -f "${QTROOT}/lib/cmake/Qt6/Qt6Config.cmake" ]]; then
	echo "error: Qt ${QT_VERSION} SDK was not found at ${QTROOT}" >&2
	exit 1
fi
if [[ ! -f "${QTROOT}/lib/libQt6SerialPort.so.${QT_VERSION}" ]]; then
	echo "error: Qt ${QT_VERSION} Serial Port runtime was not found in ${QTROOT}" >&2
	exit 1
fi

echo "Setup complete. Run dev/linux/build.sh to build and dev/linux/run.sh to launch."
