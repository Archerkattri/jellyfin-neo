#include <QCoreApplication>
#include <QtWebEngineQuick/QtWebEngineQuick>
#include <QtQuickTest/quicktest.h>

int main(int argc, char** argv)
{
  QCoreApplication::setAttribute(Qt::AA_ShareOpenGLContexts);
  QtWebEngineQuick::initialize();
  return quick_test_main(argc, argv, "InputPlugin", nullptr);
}
