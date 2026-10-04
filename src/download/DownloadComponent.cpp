#include "DownloadComponent.h"

#include <QDebug>
#include <QDir>
#include <QFileInfo>
#include <QNetworkRequest>
#include <QRegularExpression>
#include <QUrl>

#include "core/ProfileManager.h"
#include "settings/SettingsComponent.h"

/////////////////////////////////////////////////////////////////////////////////////////
DownloadComponent::DownloadComponent(QObject* parent)
: ComponentBase(parent)
{
}

/////////////////////////////////////////////////////////////////////////////////////////
bool DownloadComponent::componentInitialize()
{
  m_networkManager = new QNetworkAccessManager(this);
  return true;
}

/////////////////////////////////////////////////////////////////////////////////////////
QString DownloadComponent::downloadsDir() const
{
  QString custom = SettingsComponent::Get().value(SETTINGS_SECTION_DOWNLOADS, "directory").toString();
  QString dir = custom.isEmpty() ? ProfileManager::activeProfile().dataDir("downloads") : custom;
  QDir().mkpath(dir);
  return dir;
}

/////////////////////////////////////////////////////////////////////////////////////////
QString DownloadComponent::sanitizeFileName(const QString& fileName) const
{
  QString safe = fileName;
  safe.replace(QRegularExpression("[\\\\/:*?\"<>|]"), "_");
  safe = safe.trimmed();
  if (safe.isEmpty() || safe == "." || safe == "..")
    return QString("download.bin");
  return safe;
}

/////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::start(const QString& id, const QString& url, const QString& fileName,
                              const QString& token, bool resume)
{
  if (m_reply)
  {
    qWarning() << "DownloadComponent: busy, rejecting" << id;
    emit downloadFailed(id, "busy");
    return;
  }
  if (id.isEmpty() || url.isEmpty())
  {
    qWarning() << "DownloadComponent: invalid start arguments";
    emit downloadFailed(id, "invalid");
    return;
  }
  if (!SettingsComponent::Get().value(SETTINGS_SECTION_DOWNLOADS, "enabled").toBool())
  {
    qWarning() << "DownloadComponent: downloads are disabled, rejecting" << id;
    emit downloadFailed(id, "disabled");
    return;
  }
  QUrl downloadUrl(url);
  QString scheme = downloadUrl.scheme().toLower();
  if (!downloadUrl.isValid() || (scheme != "http" && scheme != "https"))
  {
    qWarning() << "DownloadComponent: invalid url for" << id;
    emit downloadFailed(id, "invalid");
    return;
  }

  QString path = downloadsDir() + "/" + sanitizeFileName(fileName);
  QFileInfo existing(path);

  // Resume is direct-source only (transcodes pass resume=false per the spike
  // plan); a partial file plus a Range request continues where we left off.
  qlonglong offset = 0;
  QIODevice::OpenMode mode = QIODevice::WriteOnly | QIODevice::Truncate;
  if (resume && existing.exists() && existing.size() > 0)
  {
    offset = existing.size();
    mode = QIODevice::WriteOnly | QIODevice::Append;
  }

  m_file = new QFile(path, this);
  if (!m_file->open(mode))
  {
    qWarning() << "DownloadComponent: cannot open" << path;
    emit downloadFailed(id, "file");
    reset();
    return;
  }

  QNetworkRequest request(downloadUrl);
  if (!token.isEmpty())
    request.setRawHeader("Authorization", QString("MediaBrowser Token=\"%1\"").arg(token).toUtf8());
  if (offset > 0)
    request.setRawHeader("Range", QString("bytes=%1-").arg(offset).toUtf8());

  m_activeId = id;
  m_activePath = path;
  m_resumeOffset = offset;
  m_headersChecked = false;
  m_cancelled = false;
  m_fileError = false;

  qInfo() << "DownloadComponent: started" << id << (offset > 0 ? "(resuming)" : "(fresh)");

  m_reply = m_networkManager->get(request);
  connect(m_reply, &QNetworkReply::readyRead, this, &DownloadComponent::onReadyRead);
  connect(m_reply, &QNetworkReply::downloadProgress, this, &DownloadComponent::onProgress);
  connect(m_reply, &QNetworkReply::metaDataChanged, this, &DownloadComponent::onMetaDataChanged);
  connect(m_reply, &QNetworkReply::finished, this, &DownloadComponent::onFinished);
}

/////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::cancel(const QString& id)
{
  if (!m_reply || m_activeId != id)
    return;
  qInfo() << "DownloadComponent: cancelling" << id;
  m_cancelled = true;
  m_reply->abort();
}

/////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::onReadyRead()
{
  if (!m_reply || !m_file)
    return;
  if (m_file->write(m_reply->readAll()) < 0)
  {
    qWarning() << "DownloadComponent: write failed for" << m_activeId;
    m_fileError = true;
    m_reply->abort();
  }
}

/////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::onProgress(qlonglong bytesReceived, qlonglong bytesTotal)
{
  if (!m_reply)
    return;
  qlonglong received = m_resumeOffset + bytesReceived;
  qlonglong total = bytesTotal > 0 ? m_resumeOffset + bytesTotal : 0;
  emit bytesChanged(m_activeId, received, total);
}

/////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::onMetaDataChanged()
{
  if (m_headersChecked || !m_reply || !m_file)
    return;
  m_headersChecked = true;
  int status = m_reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
  if (m_resumeOffset > 0 && status != 0 && status != 206 && status != 416)
  {
    // Server ignored our Range request: restart from zero rather than
    // appending a full body onto a partial file.
    qInfo() << "DownloadComponent: server rejected resume (HTTP" << status << "), restarting" << m_activeId;
    m_file->close();
    if (!m_file->open(QIODevice::WriteOnly | QIODevice::Truncate))
    {
      finishWithFailure("file");
      return;
    }
    m_resumeOffset = 0;
  }
}

/////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::onFinished()
{
  if (!m_reply)
    return;

  // Drain any body bytes that arrived with the final signal.
  if (m_reply->error() == QNetworkReply::NoError && m_file)
  {
    if (m_file->write(m_reply->readAll()) < 0)
      m_fileError = true;
    m_file->flush();
  }

  int status = m_reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
  QString id = m_activeId;
  QString path = m_activePath;

  if (!m_cancelled && !m_fileError && m_reply->error() == QNetworkReply::NoError)
  {
    qInfo() << "DownloadComponent: completed" << id;
    m_reply->deleteLater();
    reset();
    emit downloadCompleted(id, path);
    return;
  }

  // 416 against a partial file means the bytes are already on disk.
  if (!m_cancelled && !m_fileError && status == 416 && m_resumeOffset > 0)
  {
    qInfo() << "DownloadComponent: already complete" << id;
    m_reply->deleteLater();
    reset();
    emit downloadCompleted(id, path);
    return;
  }

  QString reason = "network";
  if (m_cancelled)
    reason = "cancelled";
  else if (m_fileError)
    reason = "file";
  else if (status > 0)
    reason = QString("http-%1").arg(status);
  else
    reason = failureReason();

  qWarning() << "DownloadComponent: failed" << id << "reason:" << reason;
  m_reply->deleteLater();
  reset();
  emit downloadFailed(id, reason);
}

/////////////////////////////////////////////////////////////////////////////////////////
QString DownloadComponent::failureReason() const
{
  if (!m_reply)
    return QString("network");
  switch (m_reply->error())
  {
    case QNetworkReply::NoError:
      return QString("network");
    case QNetworkReply::OperationCanceledError:
      return QString("cancelled");
    default:
      return QString("network");
  }
}

/////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::finishWithFailure(const QString& reason)
{
  QString id = m_activeId;
  if (m_reply)
  {
    m_reply->disconnect(this);
    m_reply->abort();
    m_reply->deleteLater();
  }
  reset();
  emit downloadFailed(id, reason);
}

/////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::reset()
{
  if (m_file)
  {
    if (m_file->isOpen())
      m_file->close();
    m_file->deleteLater();
    m_file = nullptr;
  }
  m_reply = nullptr;
  m_activeId.clear();
  m_activePath.clear();
  m_resumeOffset = 0;
  m_headersChecked = false;
  m_cancelled = false;
  m_fileError = false;
}
