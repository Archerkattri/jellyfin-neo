#include "CursorIdleController.h"

CursorIdleController::CursorIdleController(QObject* parent, int idleTimeoutMs)
  : QObject(parent), m_timer(this), m_active(false), m_visible(true)
{
  m_timer.setSingleShot(true);
  m_timer.setInterval(idleTimeoutMs);
  connect(&m_timer, &QTimer::timeout, this, &CursorIdleController::onTimeout);
}

void CursorIdleController::setActive(bool active)
{
  if (m_active == active)
    return;

  m_active = active;
  if (m_active)
    m_timer.start();
  else
  {
    m_timer.stop();
    setVisible(true);
  }
}

void CursorIdleController::handleActivity()
{
  if (!m_active)
    return;

  setVisible(true);
  m_timer.start();
}

void CursorIdleController::onTimeout()
{
  if (m_active)
    setVisible(false);
}

void CursorIdleController::setVisible(bool visible)
{
  if (m_visible == visible)
    return;

  m_visible = visible;
  emit visibilityChanged(visible);
}
