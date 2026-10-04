include_directories(
  ${CMAKE_SOURCE_DIR}/external/HIDRemote
  ${CMAKE_SOURCE_DIR}/external/letsmove
  ${CMAKE_SOURCE_DIR}/src/player
  core
  shared
)

set(CMAKE_AUTOMOC ON)
get_target_property(Qt6Core_RCC_EXECUTABLE Qt6::rcc IMPORTED_LOCATION)
add_definitions(-DPREFIX="${CMAKE_INSTALL_PREFIX}")

add_subdirectory(shared)
add_subdirectory(core)
add_subdirectory(display)
add_subdirectory(player)
add_subdirectory(utils)
add_subdirectory(ui)
add_subdirectory(input)
add_subdirectory(system)
add_subdirectory(settings)
add_subdirectory(power)
add_subdirectory(taskbar)
add_subdirectory(plugins)
add_subdirectory(download)

if(LINUX_DBUS)
  add_subdirectory(mpris)
endif()

get_property(ALL_SRCS GLOBAL PROPERTY SRCS_LIST)
set(MAIN_SRCS main.cpp)

source_group("Source Files" FILES ${MAIN_SRCS})

# Set some Objective-C flags.
# We need to force the Language to C instead of C++
# and also make sure that we use ARC
#
foreach(S ${ALL_SRCS})
  string(REGEX MATCH ".*\\.m$" MATCH_OBJC ${S})
  if(MATCH_OBJC)
    set_property(SOURCE ${S} PROPERTY COMPILE_FLAGS "-fobjc-arc")
    set_property(SOURCE ${S} PROPERTY LANGUAGE C)
  endif()
endforeach(S SOURCE)

foreach(sfile in ${ALL_SRCS})
  get_filename_component(REALNAME ${sfile} REALPATH)
  get_filename_component(DIRNAME ${REALNAME} DIRECTORY)
  string(REPLACE "${CMAKE_SOURCE_DIR}/src/" "" SUBDIR ${DIRNAME})
  string(TOLOWER ${SUBDIR} SUBDIR)
  string(REPLACE "/" "\\\\" GNAME ${SUBDIR})
  source_group("Source Files\\\\${GNAME}" FILES ${sfile})
endforeach(sfile in ${ALL_SRCS})

# Build core sources as static library for reuse by tests
add_library(jmp_core STATIC ${ALL_SRCS})

file(GLOB_RECURSE RESOURCE_FILES CONFIGURE_DEPENDS ${CMAKE_SOURCE_DIR}/resources/*)
file(GLOB_RECURSE NATIVE_FILES CONFIGURE_DEPENDS ${CMAKE_SOURCE_DIR}/native/*)

# Generate resources - runs rcc, only writes output if changed
# Note: webview.qml is handled separately via qt_add_qml_module for AOT compilation
add_custom_target(generate_resources ALL
  COMMAND ${CMAKE_COMMAND}
          -DOUTPUT=${CMAKE_CURRENT_BINARY_DIR}/qrc_resources.cpp
          -DRCC=${Qt6Core_RCC_EXECUTABLE}
          -DRESOURCES_DIR=${CMAKE_SOURCE_DIR}/resources
          -DNATIVE_DIR=${CMAKE_SOURCE_DIR}/native
          -P ${CMAKE_SOURCE_DIR}/CMakeModules/GenerateQtResources.cmake
  BYPRODUCTS ${CMAKE_CURRENT_BINARY_DIR}/qrc_resources.cpp
  VERBATIM
  COMMENT "Generating resources"
)
set_source_files_properties(${CMAKE_CURRENT_BINARY_DIR}/qrc_resources.cpp PROPERTIES GENERATED TRUE)

list(APPEND RESOURCE_FILES ${CMAKE_CURRENT_BINARY_DIR}/qrc_resources.cpp)

set(MACOSX_BUNDLE_ICON_FILE jellyfin.icns)
set(MACOSX_BUNDLE_SHORT_VERSION_STRING ${VERSION_STRING})
set(MACOSX_BUNDLE_BUNDLE_NAME "Jellyfin")
set(MACOSX_BUNDLE_BUNDLE_VERSION ${VERSION_STRING})
set(MACOSX_BUNDLE_GUI_IDENTIFIER org.jellyfin.JellyfinDesktop)

if(APPLE)
  if(HAVE_UPDATER)
    add_resources(TARGET ${MAIN_TARGET} SOURCES ${UPDATER_PATH} DEST ${INSTALL_RESOURCE_DIR})
  endif(HAVE_UPDATER)

  set_source_files_properties(
    input/apple/HIDRemote/HIDRemote.m
    PROPERTIES COMPILE_FLAGS -fno-objc-arc
  )

  set(ICON_FILE ${CMAKE_SOURCE_DIR}/bundle/osx/${MACOSX_BUNDLE_ICON_FILE})
  list(APPEND RESOURCE_FILES ${ICON_FILE})
  set_source_files_properties(${ICON_FILE} PROPERTIES MACOSX_PACKAGE_LOCATION "Resources")
endif()

if(WIN32)
  list(APPEND RESOURCE_FILES ${CMAKE_SOURCE_DIR}/bundle/win/iconres.rc)
endif()

# Generate qt.conf so that dev builds find Qt plugins and QML files
# without needing DYLD_FRAMEWORK_PATH / QT_PLUGIN_PATH / PATH env vars.
if(NOT "${QTROOT}" STREQUAL "" AND NOT BUNDLE_QT_RUNTIME)
  file(WRITE ${CMAKE_CURRENT_BINARY_DIR}/qt.conf "[Paths]\nPrefix=${QTROOT}\n")
  add_resources(TARGET ${MAIN_TARGET} SOURCES ${CMAKE_CURRENT_BINARY_DIR}/qt.conf DEST ${INSTALL_RESOURCE_DIR})
endif()

set(RESOURCE_ROOT .)
if(NOT APPLE AND NOT BUNDLE_QT_RUNTIME)
  set(rsrc_locations
    ${QTROOT}/resources
    /usr/share/qt/resources
  )
  foreach(loc ${rsrc_locations})
    if(EXISTS ${loc}/qtwebengine_devtools_resources.pak)
      install(FILES ${loc}/qtwebengine_devtools_resources.pak DESTINATION resources)
    endif()
  endforeach()
endif()

if(XCODE)
  get_resources_source_list(${MAIN_TARGET} XCODE_RESOURCES)
endif()

get_property(BUNDLED_FILES GLOBAL PROPERTY CONFIG_BUNDLED_FILES)
qt_add_executable(${MAIN_TARGET} WIN32 MACOSX_BUNDLE ${MAIN_SRCS} ${BUNDLED_FILES} ${RESOURCE_FILES} ${XCODE_RESOURCES})
add_dependencies(${MAIN_TARGET} generate_resources)
std_target_properties(${MAIN_TARGET})
if(APPLE)
  set(_install_rpath "@executable_path/../Frameworks;${QTROOT}/lib")
elseif(BUNDLE_QT_RUNTIME)
  # The packaged executable is in /usr/lib/jellyfin-desktop/bin and Qt's
  # private libraries are in /usr/lib/jellyfin-desktop/lib.
  set(_install_rpath "$ORIGIN/../lib")
else()
  set(_install_rpath "${QTROOT}/lib")
endif()
set_target_properties(${MAIN_TARGET} PROPERTIES
  MACOSX_BUNDLE_INFO_PLIST ${CMAKE_SOURCE_DIR}/bundle/osx/Info.plist.in
  INSTALL_RPATH "${_install_rpath}"
  OUTPUT_NAME ${MAIN_NAME}
)
copy_resources(${MAIN_TARGET})
clang_tidy(${MAIN_TARGET})

# Workaround for Qt Creator locating incorrect Qt version via DYLD_FRAMEWORK_PATH.
# This forces the build to load qt.conf's paths instead, which should be correct.
if(APPLE AND MACOS_LAUNCH_WRAPPER)
  add_custom_command(TARGET ${MAIN_TARGET} POST_BUILD
    COMMAND ${CMAKE_COMMAND}
      -DBINARY=$<TARGET_FILE:${MAIN_TARGET}>
      -P ${CMAKE_SOURCE_DIR}/CMakeModules/MacOSLaunchWrapper.cmake
    COMMENT "Creating macOS launch wrapper"
  )
endif()

# QML module for AOT compilation (eliminates runtime qmlcache)
set_source_files_properties(${CMAKE_CURRENT_SOURCE_DIR}/ui/webview.qml
  PROPERTIES
    QT_RESOURCE_ALIAS Webview.qml
    QT_QML_SOURCE_TYPENAME Webview
)
set_source_files_properties(${CMAKE_CURRENT_SOURCE_DIR}/ui/ExternalNavigation.js
  PROPERTIES QT_RESOURCE_ALIAS ExternalNavigation.js
)
qt_add_qml_module(${MAIN_TARGET}
  URI JellyfinDesktop
  VERSION 1.0
  QML_FILES
    ${CMAKE_CURRENT_SOURCE_DIR}/ui/webview.qml
    ${CMAKE_CURRENT_SOURCE_DIR}/ui/ExternalNavigation.js
  NO_RESOURCE_TARGET_PATH
)

find_library(MINIZIP_LIBRARY minizip)
if(WIN32)
  # FindZLIB doesn't find this. (It might be possible to fix the minizip build
  # to not require this.)
  find_library(ZLIB_LIBRARIES zlibwapi)
  if(ZLIB_LIBRARIES)
    set(ZLIB_FOUND on)
  endif()
else()
  include(FindZLIB)
endif()

if(ZLIB_FOUND AND MINIZIP_LIBRARY)
  message(STATUS "Using minizip")
  set(MINIZIP_LIBS ${MINIZIP_LIBRARY} ${ZLIB_LIBRARIES})
  add_definitions(-DHAVE_MINIZIP)
else()
  if(ENABLE_CODECS)
    if (ZLIB_FOUND)
      message(FATAL_ERROR "minizip required in this configuration")
    else()
      message(FATAL_ERROR "zlib required in this configuration")
    endif()
  endif()
endif()

if(USE_STATIC_MPVQT)
  set(MPVQT_TARGET MpvQt)
else()
  set(MPVQT_TARGET MpvQt::MpvQt)
endif()

# Link core library with all dependencies
target_link_libraries(jmp_core
  shared
  ${MPV_LIBRARY}
  ${OPENGL_LIBS}
  ${QT6_LIBRARIES}
  ${OS_LIBS}
  ${EXTRA_LIBS}
  ${X11_LIBRARIES}
  ${X11_Xrandr_LIB}
  ${CMAKE_THREAD_LIBS_INIT}
  ${RPI_LIBS}
  ${MINIZIP_LIBS}
  Qt6::Core
  Qt6::Quick
  Qt6::Widgets
  Qt6::WebEngineQuick
  Qt6::WebEngineCore
  Qt6::OpenGL
  Qt6::Xml
  Qt6::Gui
  ${MPVQT_TARGET}
)

if(LINUX_DBUS)
  target_link_libraries(jmp_core Qt6::DBus)
endif()

if(KDEWAYLAND_FOUND)
  qt6_generate_wayland_protocol_client_sources(jmp_core
    PRIVATE_CODE
    FILES
      ${PLASMA_WAYLAND_PROTOCOLS_DIR}/kde-output-device-v2.xml
      ${PLASMA_WAYLAND_PROTOCOLS_DIR}/kde-output-management-v2.xml
  )
  set_source_files_properties(
    ${CMAKE_CURRENT_BINARY_DIR}/qwayland-kde-output-device-v2.cpp
    ${CMAKE_CURRENT_BINARY_DIR}/qwayland-kde-output-management-v2.cpp
    PROPERTIES COMPILE_OPTIONS -Wno-old-style-cast)
  target_link_libraries(jmp_core Qt6::WaylandClient)
endif()

# Delay-load libmpv on Windows for runtime AVX2 fallback
if(WIN32)
  target_link_libraries(jmp_core delayimp.lib)
  target_link_options(jmp_core PRIVATE /DELAYLOAD:libmpv-2.dll)
endif()

target_link_libraries(${MAIN_TARGET} PRIVATE jmp_core)
install(TARGETS ${MAIN_TARGET} DESTINATION ${INSTALL_BIN_DIR})

if(BUNDLE_QT_RUNTIME)
  if(NOT UNIX OR APPLE)
    message(FATAL_ERROR "BUNDLE_QT_RUNTIME is supported only for Linux packages")
  endif()
  if(NOT Qt6Core_VERSION VERSION_EQUAL "6.11.3")
    message(FATAL_ERROR "Linux package bundling requires Qt 6.11.3; found ${Qt6Core_VERSION}")
  endif()

  set(_qt_webengine_process "${QTROOT}/libexec/QtWebEngineProcess")
  if(NOT EXISTS "${_qt_webengine_process}")
    message(FATAL_ERROR "QtWebEngineProcess missing from Qt SDK: ${_qt_webengine_process}")
  endif()
  install(PROGRAMS "${_qt_webengine_process}"
    DESTINATION "${QT_PRIVATE_RUNTIME_DIR}/libexec")

  # Qt's deployment API discovers ELF-linked libraries, plugins, and scanned
  # QML imports. WebEngine's helper executable and data files are not all
  # linked from the GUI executable, so package these explicitly as well.
  set(_qt_webengine_required_assets
    qtwebengine_resources.pak
    qtwebengine_devtools_resources.pak
    qtwebengine_resources_100p.pak
    qtwebengine_resources_200p.pak
    icudtl.dat
    v8_context_snapshot.bin)
  foreach(_asset IN LISTS _qt_webengine_required_assets)
    if(NOT EXISTS "${QTROOT}/resources/${_asset}")
      message(FATAL_ERROR "Required Qt WebEngine asset missing: ${QTROOT}/resources/${_asset}")
    endif()
    install(FILES "${QTROOT}/resources/${_asset}"
      DESTINATION "${QT_PRIVATE_RUNTIME_DIR}/resources")
  endforeach()
  if(NOT IS_DIRECTORY "${QTROOT}/translations/qtwebengine_locales")
    message(FATAL_ERROR "Qt WebEngine locales missing from Qt SDK: ${QTROOT}/translations/qtwebengine_locales")
  endif()
  install(DIRECTORY "${QTROOT}/translations/qtwebengine_locales"
    DESTINATION "${QT_PRIVATE_RUNTIME_DIR}/translations")

  install(PROGRAMS "${CMAKE_SOURCE_DIR}/debian/jellyfin-desktop-launcher"
    DESTINATION "${CMAKE_INSTALL_BINDIR}" RENAME jellyfin-desktop)

  qt_generate_deploy_qml_app_script(
    TARGET ${MAIN_TARGET}
    OUTPUT_SCRIPT _qt_private_deploy_script)
  qt_query_qml_module(${MAIN_TARGET}
    TARGET_PATH _jellyfin_qml_target_path
    QMLDIR _jellyfin_qml_qmldir
    TYPEINFO _jellyfin_qml_typeinfo)
  install(FILES "${_jellyfin_qml_qmldir}"
    DESTINATION "${QT_PRIVATE_RUNTIME_DIR}/qml/${_jellyfin_qml_target_path}")
  if(_jellyfin_qml_typeinfo)
    install(FILES "${_jellyfin_qml_typeinfo}"
      DESTINATION "${QT_PRIVATE_RUNTIME_DIR}/qml/${_jellyfin_qml_target_path}")
  endif()
  install(CODE "
    set(QT_DEPLOY_BIN_DIR \"${QT_PRIVATE_RUNTIME_DIR}/bin\")
    set(QT_DEPLOY_LIB_DIR \"${QT_PRIVATE_RUNTIME_DIR}/lib\")
    set(QT_DEPLOY_LIBEXEC_DIR \"${QT_PRIVATE_RUNTIME_DIR}/libexec\")
    set(QT_DEPLOY_PLUGINS_DIR \"${QT_PRIVATE_RUNTIME_DIR}/plugins\")
    set(QT_DEPLOY_QML_DIR \"${QT_PRIVATE_RUNTIME_DIR}/qml\")
    set(QT_DEPLOY_TRANSLATIONS_DIR \"${QT_PRIVATE_RUNTIME_DIR}/translations\")
    include(\"${_qt_private_deploy_script}\")
  ")

  if(EXISTS "${QTROOT}/Licenses")
    install(DIRECTORY "${QTROOT}/Licenses/"
      DESTINATION "${CMAKE_INSTALL_DATAROOTDIR}/licenses/jellyfin-desktop/Qt")
  endif()
endif()

set(EXE "${MAIN_NAME}.app")
set(LIBPATH ${CMAKE_FIND_ROOT_PATH})
set(SOURCE_ROOT ${CMAKE_SOURCE_DIR})

include(CompleteBundle)
