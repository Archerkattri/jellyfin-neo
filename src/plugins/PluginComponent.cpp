#include "PluginComponent.h"

#include <QDebug>
#include <QDir>
#include <QFile>

#include "core/ProfileManager.h"

/////////////////////////////////////////////////////////////////////////////////////////
QString PluginComponent::pluginsDir()
{
  if (!ProfileManager::Get().hasActiveProfile())
    return QString();
  return ProfileManager::activeProfile().dataDir("plugins");
}

/////////////////////////////////////////////////////////////////////////////////////////
bool PluginComponent::componentInitialize()
{
  m_plugins.clear();

  const QString dir = pluginsDir();
  if (dir.isEmpty())
    return true; // No active profile on early CLI paths; nothing to scan.

  const QDir pluginsDirectory(dir);
  if (!pluginsDirectory.exists())
    return true; // No plugins installed; not an error.

  const QStringList entries = pluginsDirectory.entryList(QDir::Dirs | QDir::NoDotAndDotDot, QDir::Name);
  for (const QString &entry : entries)
  {
    QFile manifestFile(pluginsDirectory.filePath(entry + "/plugin.json"));
    if (!manifestFile.exists())
      continue;
    if (!manifestFile.open(QIODevice::ReadOnly))
    {
      qWarning() << "Plugin" << entry << "has an unreadable plugin.json; skipping";
      continue;
    }
    QString error;
    const std::optional<PluginManifest> manifest =
      PluginManifest::parseBytes(manifestFile.readAll(), &error);
    if (!manifest.has_value())
    {
      qWarning() << "Skipping invalid plugin" << entry << ":" << error;
      continue;
    }
    qInfo() << "Found plugin:" << manifest->id << manifest->version;
    m_plugins.append(*manifest);
  }
  return true;
}
