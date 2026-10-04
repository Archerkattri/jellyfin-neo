#ifndef __DOWNLOAD_COMPONENT_H__
#define __DOWNLOAD_COMPONENT_H__

#include "ComponentManager.h"
#include "utils/Utils.h"

#include <QFile>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QPointer>

#define SETTINGS_SECTION_DOWNLOADS "downloads"

class DownloadComponent : public ComponentBase
{
  Q_OBJECT
  DEFINE_SINGLETON(DownloadComponent);

public:
  bool componentExport() override { return true; }
  const char* componentName() override { return "download"; }
  bool componentInitialize() override;

  Q_INVOKABLE QString downloadsDir() const;
  Q_INVOKABLE void start(const QString& id, const QString& url, const QString& fileName,
                         const QString& token, bool resume);
  Q_INVOKABLE void cancel(const QString& id);

  Q_SIGNAL void bytesChanged(const QString& id, qlonglong receivedBytes, qlonglong totalBytes);
  Q_SIGNAL void downloadCompleted(const QString& id, const QString& filePath);
  Q_SIGNAL void downloadFailed(const QString& id, const QString& reason);

private Q_SLOTS:
  void onReadyRead();
  void onProgress(qlonglong bytesReceived, qlonglong bytesTotal);
  void onMetaDataChanged();
  void onFinished();

private:
  explicit DownloadComponent(QObject* parent = nullptr);
  QString sanitizeFileName(const QString& fileName) const;
  QString failureReason() const;
  void finishWithFailure(const QString& reason);
  void reset();

  QNetworkAccessManager* m_networkManager = nullptr;
  QPointer<QNetworkReply> m_reply;
  QFile* m_file = nullptr;
  QString m_activeId;
  QString m_activePath;
  qlonglong m_resumeOffset = 0;
  bool m_headersChecked = false;
  bool m_cancelled = false;
  bool m_fileError = false;
};

#endif
