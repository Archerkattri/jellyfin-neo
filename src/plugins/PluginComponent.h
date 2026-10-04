#ifndef PLUGIN_COMPONENT_H
#define PLUGIN_COMPONENT_H

// Phase 0: manifest scanner/validator skeleton. Scans
// <profile>/plugins/*/plugin.json, keeps valid manifests, skips invalid ones
// with a warning (fail-closed). Deliberately no QPluginLoader / WebChannel /
// userScript behavior yet (Phase 1/2).

#include "ComponentManager.h"
#include "api/PluginManifest.h"
#include "utils/Utils.h"

#include <QList>

class PluginComponent : public ComponentBase
{
  Q_OBJECT
  DEFINE_SINGLETON(PluginComponent);

public:
  const char *componentName() override { return "plugins"; }
  bool componentExport() override { return false; }
  bool componentInitialize() override;

  const QList<PluginManifest> &plugins() const { return m_plugins; }
  static QString pluginsDir();

  // Tier-2: install a plugin from a local extracted folder (folder-only; no
  // zip reader exists in-tree). Validates <sourceDir>/plugin.json fail-closed
  // via PluginManifest, copies it into the profile plugins dir, rescans.
  // Refuses to overwrite an existing install. *error is set on failure.
  bool installPlugin(const QString &sourceDir, QString *error = nullptr);
  // Tier-2: remove the installed plugin dir for id, then rescan. Refuses any
  // id that does not resolve inside the plugins dir (fail-closed on path
  // escapes). *error is set on failure.
  bool uninstallPlugin(const QString &id, QString *error = nullptr);

private:
  explicit PluginComponent(QObject *parent = nullptr) : ComponentBase(parent) { }

  // Single safe path segment for install/uninstall dir names. The manifest
  // id pattern already excludes separators, but "." and ".." match that
  // pattern and must be rejected explicitly to stop plugins-dir escapes.
  static bool isSafeDirName(const QString &name);
  // True when candidate resolves strictly inside base (fail-closed).
  static bool isWithinDir(const QString &base, const QString &candidate);
  // Recursive copy that refuses symlinks (fail-closed, no escape smuggling).
  static bool copyDirRecursive(const QString &source, const QString &target, QString *error);

  QList<PluginManifest> m_plugins;
};

#endif // PLUGIN_COMPONENT_H
