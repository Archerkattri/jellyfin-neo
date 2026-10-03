#!/usr/bin/env bash
set -euo pipefail

dist_dir="${1:?usage: test-deb-qt-runtime.sh DIST_DIR}"
shopt -s nullglob
packages=("${dist_dir}"/*.deb)
if [[ "${#packages[@]}" -ne 1 ]]; then
	echo "expected exactly one application .deb in ${dist_dir}; found ${#packages[@]}" >&2
	exit 1
fi
deb="${packages[0]}"
private_root=/usr/lib/jellyfin-desktop
tmpdir="$(mktemp -d)"
cleanup() {
	if [[ -n "${smoke_pid:-}" ]]; then
		kill "${smoke_pid}" 2>/dev/null || true
		wait "${smoke_pid}" 2>/dev/null || true
	fi
	rm -rf "${tmpdir}"
}
trap cleanup EXIT

depends="$(dpkg-deb -f "${deb}" Depends)"
if grep -Eqi '(^|[, |])(libqt6[^ ,|]*|qml6-module-qt[^ ,|]*)' <<<"${depends}"; then
	echo "package still depends on distro Qt runtime packages: ${depends}" >&2
	exit 1
fi

dpkg-deb -x "${deb}" "${tmpdir}/payload"
payload="${tmpdir}/payload${private_root}"
for file in \
	"${payload}/lib/libQt6Core.so.6.11.3" \
	"${payload}/lib/libQt6SerialPort.so.6.11.3" \
	"${payload}/lib/libQt6Qml.so.6.11.3" \
	"${payload}/lib/libQt6WebChannel.so.6.11.3" \
	"${payload}/lib/libQt6WebEngineCore.so.6.11.3" \
	"${payload}/lib/libQt6WebEngineQuick.so.6.11.3" \
	"${payload}/qml/JellyfinDesktop/qmldir" \
	"${payload}/qml/JellyfinDesktop/JellyfinDesktop.qmltypes" \
	"${payload}/libexec/QtWebEngineProcess" \
	"${payload}/resources/qtwebengine_resources.pak" \
	"${payload}/resources/qtwebengine_devtools_resources.pak" \
	"${payload}/resources/qtwebengine_resources_100p.pak" \
	"${payload}/resources/qtwebengine_resources_200p.pak" \
	"${payload}/resources/icudtl.dat" \
	"${payload}/resources/v8_context_snapshot.bin" \
	"${payload}/translations/qtwebengine_locales/en-US.pak" \
	"${tmpdir}/payload/usr/bin/jellyfin-desktop"; do
	if [[ ! -e "${file}" ]]; then
		echo "required bundled runtime file missing: ${file#${tmpdir}/payload}" >&2
		exit 1
	fi
done

for module in QtWebEngine QtWebChannel QtQuick.Controls QtQuick.Window Qt.labs.platform; do
	if ! grep -R -l -E "^[[:space:]]*module[[:space:]]+${module//./\\.}([[:space:]]|$)" \
		"${payload}/qml" >/dev/null; then
		echo "required bundled QML module missing: ${module}" >&2
		exit 1
	fi
done
if [[ ! -e "${payload}/plugins/platforms/libqxcb.so" && ! -e "${payload}/plugins/platforms/libqwayland-egl.so" ]]; then
	echo "no bundled Qt platform plugin found" >&2
	exit 1
fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install --yes --no-install-recommends \
	xvfb xauth procps util-linux "${deb}"

installed_qt="$(dpkg-query -W -f='${binary:Package}\n' \
	'libqt6core6*' 'libqt6webenginecore6*' 'qml6-module-qtwebengine' 2>/dev/null || true)"
if [[ -n "${installed_qt}" ]]; then
	echo "clean runtime image unexpectedly installed distro Qt packages:${installed_qt}" >&2
	exit 1
fi

binary="${private_root}/bin/jellyfin-desktop"
check_dependencies() {
	local file="$1"
	local dependencies
	dependencies="$(LD_LIBRARY_PATH="${private_root}/lib" ldd "${file}")"
	if grep -q 'not found' <<<"${dependencies}"; then
		echo "unresolved runtime dependency in ${file}" >&2
		printf '%s\n' "${dependencies}" >&2
		exit 1
	fi
	if [[ "${file}" == "${binary}" ]] && ! grep -E 'libQt6(Core|Qml|WebEngineCore).*=> /usr/lib/jellyfin-desktop/lib/' <<<"${dependencies}"; then
		echo "the installed executable did not resolve Qt from its private runtime" >&2
		printf '%s\n' "${dependencies}" >&2
		exit 1
	fi
}
check_dependencies "${binary}"
check_dependencies "${private_root}/libexec/QtWebEngineProcess"
while IFS= read -r -d '' shared_object; do
	check_dependencies "${shared_object}"
done < <(find "${private_root}/lib" "${private_root}/plugins" "${private_root}/qml" \
	-type f \( -name '*.so' -o -name '*.so.*' \) -print0)

mkdir -p "${tmpdir}/home" "${tmpdir}/config" "${tmpdir}/cache"
chown -R nobody:nogroup "${tmpdir}"
timeout --signal=TERM 30s runuser -u nobody -- env \
	HOME="${tmpdir}/home" \
	XDG_CONFIG_HOME="${tmpdir}/config" \
	XDG_CACHE_HOME="${tmpdir}/cache" \
	QTWEBENGINE_CHROMIUM_FLAGS=--disable-gpu \
	xvfb-run --auto-servernum /usr/bin/jellyfin-desktop \
		--config-dir "${tmpdir}/config/jellyfin" >"${tmpdir}/smoke.log" 2>&1 &
smoke_pid=$!

webengine_started=false
for _ in $(seq 1 30); do
	if ! kill -0 "${smoke_pid}" 2>/dev/null; then
		break
	fi
	if pgrep -f "${private_root}/libexec/QtWebEngineProcess" >/dev/null; then
		webengine_started=true
		break
	fi
	sleep 1
done
if [[ "${webengine_started}" != true ]]; then
	cat "${tmpdir}/smoke.log" >&2
	echo "packaged application did not start its private QtWebEngineProcess" >&2
	exit 1
fi
echo "Qt 6.11.3 private runtime and WebEngine startup smoke test passed for ${deb##*/}"
