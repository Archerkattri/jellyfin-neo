#include "PluginComponent.h"

#include <QDebug>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QRegularExpression>

#include "core/ProfileManager.h"

namespace
{
  void setError(QString *error, const QString &message)
  {
    if (error)
      *error = message;
  }
}

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

/////////////////////////////////////////////////////////////////////////////////////////
bool PluginComponent::isSafeDirName(const QString &name)
{
  static const QRegularExpression pattern(QStringLiteral("^[A-Za-z0-9._-]+$"));
  return !name.isEmpty() && name != "." && name != ".." && pattern.match(name).hasMatch();
}

/////////////////////////////////////////////////////////////////////////////////////////
bool PluginComponent::isWithinDir(const QString &base, const QString &candidate)
{
  const QString cleanBase = QDir::cleanPath(QDir(base).absolutePath());
  const QString cleanCandidate = QDir::cleanPath(QDir(candidate).absolutePath());
  return cleanCandidate.startsWith(cleanBase + '/');
}

/////////////////////////////////////////////////////////////////////////////////////////
bool PluginComponent::copyDirRecursive(const QString &source, const QString &target, QString *error)
{
  QDir targetDir(target);
  if (!targetDir.mkpath("."))
  {
    setError(error, "cannot create directory " + target);
    return false;
  }
  const QFileInfoList entries = QDir(source).entryInfoList(
    QDir::Files | QDir::Dirs | QDir::NoDotAndDotDot | QDir::Hidden | QDir::System);
  for (const QFileInfo &info : entries)
  {
    if (info.isSymLink())
    {
      setError(error, "refusing to copy symlink " + info.fileName());
      return false;
    }
    const QString dest = targetDir.filePath(info.fileName());
    if (info.isDir())
    {
      if (!copyDirRecursive(info.absoluteFilePath(), dest, error))
        return false;
    }
    else if (!QFile::copy(info.absoluteFilePath(), dest))
    {
      setError(error, "cannot copy " + info.fileName());
      return false;
    }
  }
  return true;
}

/////////////////////////////////////////////////////////////////////////////////////////
bool PluginComponent::installPlugin(const QString &sourceDir, QString *error)
{
  const QString dir = pluginsDir();
  if (dir.isEmpty())
  {
    setError(error, "no active profile");
    return false;
  }
  const QDir source(sourceDir);
  if (!source.exists())
  {
    setError(error, "source directory does not exist");
    return false;
  }
  QFile manifestFile(source.filePath("plugin.json"));
  if (!manifestFile.open(QIODevice::ReadOnly))
  {
    setError(error, "source has no readable plugin.json");
    return false;
  }
  QString manifestError;
  const std::optional<PluginManifest> manifest =
    PluginManifest::parseBytes(manifestFile.readAll(), &manifestError);
  if (!manifest.has_value())
  {
    setError(error, "invalid manifest: " + manifestError);
    return false;
  }
  if (!isSafeDirName(manifest->id))
  {
    setError(error, "manifest id is not a safe directory name");
    return false;
  }
  QDir baseDir(dir);
  if (!baseDir.mkpath("."))
  {
    setError(error, "cannot create plugins directory");
    return false;
  }
  const QString base = QDir::cleanPath(baseDir.absolutePath());
  const QString target = base + '/' + manifest->id;
  if (!isWithinDir(base, target))
  {
    setError(error, "install target escapes the plugins directory");
    return false;
  }
  if (QFileInfo::exists(target))
  {
    setError(error, "plugin is already installed; uninstall it first");
    return false;
  }
  const QString canonicalSource = source.canonicalPath();
  if (canonicalSource.isEmpty())
  {
    setError(error, "source directory does not exist");
    return false;
  }
  if (!copyDirRecursive(canonicalSource, target, error))
  {
    QDir(target).removeRecursively(); // Roll back the partial copy.
    return false;
  }
  qInfo() << "Installed plugin:" << manifest->id << manifest->version;
  componentInitialize(); // Rescan.
  return true;
}

/////////////////////////////////////////////////////////////////////////////////////////
bool PluginComponent::uninstallPlugin(const QString &id, QString *error)
{
  const QString dir = pluginsDir();
  if (dir.isEmpty())
  {
    setError(error, "no active profile");
    return false;
  }
  if (!isSafeDirName(id))
  {
    setError(error, "refusing to uninstall unsafe plugin id");
    return false;
  }
  const QString base = QDir::cleanPath(QDir(dir).absolutePath());
  const QString target = base + '/' + id;
  if (!isWithinDir(base, target))
  {
    setError(error, "plugin path escapes the plugins directory");
    return false;
  }
  if (!QDir(target).exists())
  {
    setError(error, "plugin is not installed");
    return false;
  }
  if (QFileInfo(target).isSymLink())
  {
    setError(error, "refusing to remove symlinked plugin directory");
    return false;
  }
  // Resolve ".." and links: anything outside the plugins dir is refused.
  const QString canonical = QDir(target).canonicalPath();
  if (canonical.isEmpty() || (canonical != base && !canonical.startsWith(base + '/')))
  {
    setError(error, "plugin path escapes the plugins directory");
    return false;
  }
  if (!QDir(target).removeRecursively())
  {
    setError(error, "cannot remove plugin directory");
    return false;
  }
  qInfo() << "Uninstalled plugin:" << id;
  componentInitialize(); // Rescan.
  return true;
}
