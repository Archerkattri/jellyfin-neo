#include <QtTest/QtTest>
#include <QTcpServer>
#include <QTcpSocket>
#include <QSharedPointer>
#include <QSignalSpy>
#include "../src/system/SystemComponent.h"

class TestSystemComponent : public QObject
{
  Q_OBJECT

private slots:
  void init();
  void cleanup();
  void testExtractBaseUrl_data();
  void testExtractBaseUrl();
  void testResolveUrlTimeoutCompletesCallback();
  void testResolveUrlExplicitCancelDoesNotCompleteCallback();
  void testConnectivityRequestTimeoutRetries();
};

void TestSystemComponent::init()
{
  auto& system = SystemComponent::Get();
  system.m_networkRequestTimeoutMs = NETWORK_REQUEST_TIMEOUT_MS;
  system.m_connectivityRetryIntervalMs = CONNECTIVITY_RETRY_INTERVAL_MS;
}

void TestSystemComponent::cleanup()
{
  auto& system = SystemComponent::Get();
  system.cancelServerConnectivity();
  system.m_networkRequestTimeoutMs = NETWORK_REQUEST_TIMEOUT_MS;
  system.m_connectivityRetryIntervalMs = CONNECTIVITY_RETRY_INTERVAL_MS;
}

void TestSystemComponent::testExtractBaseUrl_data()
{
  QTest::addColumn<QString>("input");
  QTest::addColumn<QString>("expected");

  // Standard cases - URLs with /web
  QTest::newRow("https with /web at root")
    << "https://server.com/web/"
    << "https://server.com";

  QTest::newRow("https with /web and custom port")
    << "https://server.com:8096/web/"
    << "https://server.com:8096";

  QTest::newRow("http with /web and port 80")
    << "http://server.com:80/web/"
    << "http://server.com";

  QTest::newRow("https with /web and port 443")
    << "https://server.com:443/web/"
    << "https://server.com";

  QTest::newRow("https with /web at subpath")
    << "https://server.com/jellyfin/web/"
    << "https://server.com/jellyfin";

  QTest::newRow("https with /web, no trailing slash")
    << "https://server.com/jellyfin/web"
    << "https://server.com/jellyfin";

  QTest::newRow("https with nested path before /web")
    << "https://server.com/path/to/jellyfin/web/"
    << "https://server.com/path/to/jellyfin";

  // Case insensitivity
  QTest::newRow("https with /WEB uppercase")
    << "https://server.com/WEB/"
    << "https://server.com";

  QTest::newRow("https with /Web mixed case")
    << "https://server.com/jellyfin/Web/"
    << "https://server.com/jellyfin";

  // Fallback cases - URLs without /web
  QTest::newRow("https root without /web")
    << "https://server.com/"
    << "https://server.com";

  QTest::newRow("https with port, no /web")
    << "https://server.com:8096/"
    << "https://server.com:8096";

  QTest::newRow("http with port 80, no /web")
    << "http://server.com:80/"
    << "http://server.com";

  QTest::newRow("https with port 443, no /web")
    << "https://server.com:443/"
    << "https://server.com";

  QTest::newRow("https with path but no /web")
    << "https://server.com/some/path"
    << "https://server.com";

  QTest::newRow("http root without /web")
    << "http://server.com"
    << "http://server.com";

  // Edge cases - query strings and fragments
  QTest::newRow("https with /web and query string")
    << "https://server.com/web/?foo=bar"
    << "https://server.com";

  QTest::newRow("https with /web and fragment")
    << "https://server.com/web/#section"
    << "https://server.com";

  QTest::newRow("https with /web, query and fragment")
    << "https://server.com/jellyfin/web/?foo=bar#section"
    << "https://server.com/jellyfin";

  // Edge cases - partial matches
  QTest::newRow("https with /website (not /web)")
    << "https://server.com/website/"
    << "https://server.com";

  QTest::newRow("https with /webdav (not /web)")
    << "https://server.com/webdav/"
    << "https://server.com";

  // Edge cases - multiple /web occurrences (should use last)
  QTest::newRow("https with multiple /web - uses last")
    << "https://server.com/web/something/web/"
    << "https://server.com/web/something";

  // Edge cases - localhost and IP addresses
  QTest::newRow("localhost with port")
    << "http://localhost:8096/web/"
    << "http://localhost:8096";

  QTest::newRow("IPv4 address")
    << "http://192.168.1.100:8096/web/"
    << "http://192.168.1.100:8096";

  QTest::newRow("IPv6 address")
    << "http://[::1]:8096/web/"
    << "http://::1:8096";

  // Edge cases - malformed/empty
  QTest::newRow("empty string")
    << ""
    << "://";

  QTest::newRow("no scheme")
    << "server.com/web/"
    << "://server.com";

  QTest::newRow("only scheme")
    << "https://"
    << "https://";

  QTest::newRow("no host")
    << "https:///web/"
    << "https://";
}

void TestSystemComponent::testExtractBaseUrl()
{
  QFETCH(QString, input);
  QFETCH(QString, expected);

  QString result = SystemComponent::extractBaseUrl(input);

  QCOMPARE(result, expected);
}

void TestSystemComponent::testResolveUrlTimeoutCompletesCallback()
{
  QTcpServer server;
  QVERIFY(server.listen(QHostAddress::LocalHost));

  auto& system = SystemComponent::Get();
  system.m_networkRequestTimeoutMs = 30;
  const QString url = QStringLiteral("http://127.0.0.1:%1/web/").arg(server.serverPort());
  int callbackCount = 0;
  QString resolvedUrl;

  system.resolveUrl(url, [&callbackCount, &resolvedUrl](const QString& result) {
    ++callbackCount;
    resolvedUrl = result;
  });

  QTRY_VERIFY_WITH_TIMEOUT(server.hasPendingConnections(), 1000);
  QTRY_COMPARE_WITH_TIMEOUT(callbackCount, 1, 1000);
  QCOMPARE(resolvedUrl, url);
}

void TestSystemComponent::testResolveUrlExplicitCancelDoesNotCompleteCallback()
{
  QTcpServer server;
  QVERIFY(server.listen(QHostAddress::LocalHost));

  auto& system = SystemComponent::Get();
  system.m_networkRequestTimeoutMs = 1000;
  const QString url = QStringLiteral("http://127.0.0.1:%1/web/").arg(server.serverPort());
  int callbackCount = 0;

  system.resolveUrl(url, [&callbackCount](const QString&) { ++callbackCount; });
  QTRY_VERIFY_WITH_TIMEOUT(server.hasPendingConnections(), 1000);
  system.cancelServerConnectivity();
  QTest::qWait(50);

  QCOMPARE(callbackCount, 0);
}

void TestSystemComponent::testConnectivityRequestTimeoutRetries()
{
  QTcpServer server;
  QVERIFY(server.listen(QHostAddress::LocalHost));

  int headRequests = 0;
  int getRequests = 0;
  connect(&server, &QTcpServer::newConnection, &server, [&]() {
    while (server.hasPendingConnections()) {
      QTcpSocket* socket = server.nextPendingConnection();
      auto requestLine = QSharedPointer<QByteArray>::create();
      connect(socket, &QTcpSocket::readyRead, socket, [&, socket, requestLine]() {
        *requestLine += socket->readAll();
        const qsizetype lineEnd = requestLine->indexOf("\r\n");
        if (lineEnd < 0) {
          return;
        }
        const QByteArray request = requestLine->left(lineEnd);
        if (request.startsWith("HEAD ")) {
          ++headRequests;
          socket->write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
          socket->disconnectFromHost();
        } else if (request.startsWith("GET ")) {
          ++getRequests;
          // Leave the connectivity request unanswered so the client times it out.
        }
      });
    }
  });

  auto& system = SystemComponent::Get();
  system.m_networkRequestTimeoutMs = 30;
  system.m_connectivityRetryIntervalMs = 20;
  const QString url = QStringLiteral("http://127.0.0.1:%1/web/").arg(server.serverPort());
  QSignalSpy resultSpy(&system, &SystemComponent::serverConnectivityResult);

  system.checkServerConnectivity(url);

  QTRY_VERIFY_WITH_TIMEOUT(getRequests >= 2, 2000);
  QVERIFY(headRequests >= 2);
  QCOMPARE(resultSpy.count(), 0);
  system.cancelServerConnectivity();
}

QTEST_GUILESS_MAIN(TestSystemComponent)
#include "test_systemcomponent.moc"
