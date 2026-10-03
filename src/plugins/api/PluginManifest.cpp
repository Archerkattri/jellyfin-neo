#include "PluginManifest.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonValue>
#include <QRegularExpression>

#include <cmath>

namespace
{
  const QStringList kKnownCapabilities = {
    "webchannel-export",
    "host-commands",
    "settings-ui",
    "local-sockets",
    "network",
    "process-spawn",
  };

  constexpr int kSupportedApiVersion = 1;

  // Reverse-DNS style ids ("org.jellyfin.discord-presence").
  const QRegularExpression kIdPattern(QStringLiteral("^[A-Za-z0-9._-]+$"));
  const QRegularExpression kSemverPattern(
    QStringLiteral("^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?(\\+[0-9A-Za-z.-]+)?$"));
  // Single safe path segment: no separators, no parent traversal.
  const QRegularExpression kEntryPattern(QStringLiteral("^[A-Za-z0-9._-]+$"));

  void setError(QString *error, const QString &message)
  {
    if (error)
      *error = message;
  }
}

/////////////////////////////////////////////////////////////////////////////////////////
const QStringList &PluginManifest::knownCapabilities()
{
  return kKnownCapabilities;
}

/////////////////////////////////////////////////////////////////////////////////////////
int PluginManifest::supportedApiVersion()
{
  return kSupportedApiVersion;
}

/////////////////////////////////////////////////////////////////////////////////////////
std::optional<PluginManifest> PluginManifest::parse(const QJsonObject &obj, QString *error)
{
  PluginManifest manifest;

  const QJsonValue idValue = obj.value("id");
  if (!idValue.isString() || idValue.toString().isEmpty()
      || !kIdPattern.match(idValue.toString()).hasMatch())
  {
    setError(error, "invalid or missing \"id\"");
    return std::nullopt;
  }
  manifest.id = idValue.toString();

  const QJsonValue versionValue = obj.value("version");
  if (!versionValue.isString() || !kSemverPattern.match(versionValue.toString()).hasMatch())
  {
    setError(error, "invalid or missing \"version\"");
    return std::nullopt;
  }
  manifest.version = versionValue.toString();

  const QJsonValue apiValue = obj.value("apiVersion");
  if (!apiValue.isDouble())
  {
    setError(error, "invalid or missing \"apiVersion\"");
    return std::nullopt;
  }
  const double apiDouble = apiValue.toDouble();
  if (apiDouble < 1 || std::floor(apiDouble) != apiDouble)
  {
    setError(error, "invalid or missing \"apiVersion\"");
    return std::nullopt;
  }
  // Compare before narrowing: apiVersion arrives as a JSON double and values
  // beyond int range would make the cast below undefined behavior.
  if (apiDouble > kSupportedApiVersion)
  {
    setError(error, QString("unsupported \"apiVersion\" %1").arg(apiDouble, 0, 'f', 0));
    return std::nullopt;
  }
  manifest.apiVersion = static_cast<int>(apiDouble);

  const QJsonValue tierValue = obj.value("tier");
  if (!tierValue.isString() || (tierValue.toString() != "web" && tierValue.toString() != "native"))
  {
    setError(error, "invalid or missing \"tier\"");
    return std::nullopt;
  }
  manifest.tier = tierValue.toString();

  const QJsonValue entryValue = obj.value("entry");
  const QString entry = entryValue.toString();
  if (!entryValue.isString() || entry.isEmpty() || entry == "." || entry == ".."
      || entry.contains('/') || entry.contains('\\') || entry.contains("..")
      || !kEntryPattern.match(entry).hasMatch())
  {
    setError(error, "invalid or missing \"entry\"");
    return std::nullopt;
  }
  manifest.entry = entry;

  const QJsonValue capsValue = obj.value("capabilities");
  if (capsValue.isNull() || capsValue.isUndefined())
  {
    manifest.capabilities = QStringList();
  }
  else if (!capsValue.isArray())
  {
    setError(error, "\"capabilities\" must be an array");
    return std::nullopt;
  }
  else
  {
    for (const QJsonValue &cap : capsValue.toArray())
    {
      if (!cap.isString() || !kKnownCapabilities.contains(cap.toString()))
      {
        setError(error, QString("unknown capability \"%1\"").arg(cap.toString()));
        return std::nullopt;
      }
      manifest.capabilities.append(cap.toString());
    }
  }

  const QJsonValue rationaleValue = obj.value("capabilityRationale");
  if (!rationaleValue.isNull() && !rationaleValue.isUndefined())
  {
    if (!rationaleValue.isObject())
    {
      setError(error, "\"capabilityRationale\" must be an object");
      return std::nullopt;
    }
    const QJsonObject rationale = rationaleValue.toObject();
    for (auto it = rationale.constBegin(); it != rationale.constEnd(); ++it)
    {
      if (!manifest.capabilities.contains(it.key()))
      {
        setError(error, QString("rationale for undeclared capability \"%1\"").arg(it.key()));
        return std::nullopt;
      }
    }
  }

  return manifest;
}

/////////////////////////////////////////////////////////////////////////////////////////
std::optional<PluginManifest> PluginManifest::parseBytes(const QByteArray &json, QString *error)
{
  QJsonParseError parseError;
  const QJsonDocument doc = QJsonDocument::fromJson(json, &parseError);
  if (parseError.error != QJsonParseError::NoError || !doc.isObject())
  {
    setError(error, "manifest must be a JSON object");
    return std::nullopt;
  }
  return parse(doc.object(), error);
}
