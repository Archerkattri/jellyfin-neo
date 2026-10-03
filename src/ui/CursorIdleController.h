#ifndef CURSORIDLECONTROLLER_H
#define CURSORIDLECONTROLLER_H

#include <QObject>
#include <QTimer>

class CursorIdleController : public QObject
{
  Q_OBJECT

public:
  explicit CursorIdleController(QObject* parent = nullptr, int idleTimeoutMs = 3000);

  void setActive(bool active);
  void handleActivity();

signals:
  void visibilityChanged(bool visible);

private slots:
  void onTimeout();

private:
  void setVisible(bool visible);

  QTimer m_timer;
  bool m_active;
  bool m_visible;
};

#endif // CURSORIDLECONTROLLER_H
