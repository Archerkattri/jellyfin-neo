#ifndef CLIENT_PLUGIN_INTERFACE_H
#define CLIENT_PLUGIN_INTERFACE_H

// Phase 0 (research_notes/plugin-api-design.md): frozen Tier-2 native plugin
// contract at apiVersion 1. Breaking this ABI requires a major apiVersion
// bump and a new IID (".../2") so old plugins fail cleanly at qobject_cast.

#include <QJsonObject>
#include <QObject>
#include <QString>
#include <QtPlugin>

class PluginHost; // Phase 2: capability-gated host services.

static const int ClientPluginApiVersion = 1;

class ClientPluginInterface
{
public:
  virtual ~ClientPluginInterface() = default;
  virtual bool initialize(PluginHost *host) = 0;
  virtual void shutdown() = 0;
  virtual QJsonObject metadata() const = 0;
  // Optional: published as plugins.<id> iff capability granted (Phase 2).
  virtual QObject *webChannelObject() { return nullptr; }
  virtual QString companionScript() const { return {}; } // Tier-2 JS, :/ or file
};

Q_DECLARE_INTERFACE(ClientPluginInterface, "org.jellyfin.ClientPlugin/1")

#endif // CLIENT_PLUGIN_INTERFACE_H
