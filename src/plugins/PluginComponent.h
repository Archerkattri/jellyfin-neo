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

private:
  explicit PluginComponent(QObject *parent = nullptr) : ComponentBase(parent) { }

  QList<PluginManifest> m_plugins;
};

#endif // PLUGIN_COMPONENT_H
