#ifndef PLUGIN_MANIFEST_H
#define PLUGIN_MANIFEST_H

// Phase 0: fail-closed plugin.json manifest parser/validator.
// Rule set mirrors native/pluginManifest.js (the Tier-1 client-side gate);
// keep the two in sync. Unknown/extra keys are ignored for forward
// compatibility; unknown capabilities reject the manifest.

#include <QByteArray>
#include <QJsonObject>
#include <QString>
#include <QStringList>

#include <optional>

struct PluginManifest
{
  QString id;
  QString version;
  int apiVersion = 0;
  QString tier; // "web" or "native"
  QString entry;
  QStringList capabilities;

  // v1 capability vocabulary (research_notes/plugin-api-design.md).
  static const QStringList &knownCapabilities();
  static int supportedApiVersion();

  // Parse + validate one plugin.json object. Returns nullopt (with *error
  // set when non-null) on any failure: missing field, bad version,
  // unsupported apiVersion, bad tier, path-traversal entry, unknown
  // capability, or rationale for an undeclared capability.
  static std::optional<PluginManifest> parse(const QJsonObject &obj, QString *error = nullptr);
  static std::optional<PluginManifest> parseBytes(const QByteArray &json, QString *error = nullptr);
};

#endif // PLUGIN_MANIFEST_H
