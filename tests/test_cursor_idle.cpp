#include <QtTest/QtTest>
#include "player/PlayerComponent.h"
#include "settings/SettingsComponent.h"
#include "settings/SettingsSection.h"
#include "settings/SettingsValue.h"
#include "ui/CursorIdleController.h"

class TestCursorIdle : public QObject
{
  Q_OBJECT

private slots:
  void initTestCase();
  void videoPlaybackStateTransitions();
  void cursorHidesAfterIdleAndReturnsOnMouseActivity();
};

void TestCursorIdle::initTestCase()
{
  auto* section = new SettingsSection("albumart", PLATFORM_ANY, -1,
                                      &SettingsComponent::Get());
  section->registerSetting(new SettingsValue("cacheSize", 10485760,
                                              PLATFORM_ANY, section));
  SettingsComponent::Get().registerSection(section);
}

void TestCursorIdle::videoPlaybackStateTransitions()
{
  PlayerComponent& player = PlayerComponent::Get();
  QSignalSpy spy(&player, &PlayerComponent::videoPlayingChanged);
  QVERIFY(spy.isValid());

  player.notifyPlaybackStop(false);
  spy.clear();

  player.notifyMetadata({{"MediaType", "Video"}});
  player.notifyPlaybackState("Playing");
  QVERIFY(player.isVideoPlaying());
  QCOMPARE(spy.count(), 1);
  QCOMPARE(spy.takeFirst().at(0).toBool(), true);

  player.notifyPlaybackState("Paused");
  QVERIFY(!player.isVideoPlaying());
  QCOMPARE(spy.count(), 1);
  QCOMPARE(spy.takeFirst().at(0).toBool(), false);

  player.notifyPlaybackState("Playing");
  QVERIFY(player.isVideoPlaying());
  player.notifyPlaybackStop(false);
  QVERIFY(!player.isVideoPlaying());
}

void TestCursorIdle::cursorHidesAfterIdleAndReturnsOnMouseActivity()
{
  CursorIdleController controller(nullptr, 60);
  QSignalSpy spy(&controller, &CursorIdleController::visibilityChanged);
  QVERIFY(spy.isValid());

  controller.setActive(true);
  QTRY_COMPARE_WITH_TIMEOUT(spy.count(), 1, 1000);
  QCOMPARE(spy.takeFirst().at(0).toBool(), false);

  controller.handleActivity();
  QCOMPARE(spy.count(), 1);
  QCOMPARE(spy.takeFirst().at(0).toBool(), true);
  QTRY_COMPARE_WITH_TIMEOUT(spy.count(), 1, 1000);
  QCOMPARE(spy.takeFirst().at(0).toBool(), false);

  controller.setActive(false);
  QCOMPARE(spy.count(), 1);
  QCOMPARE(spy.takeFirst().at(0).toBool(), true);
}

QTEST_GUILESS_MAIN(TestCursorIdle)
#include "test_cursor_idle.moc"
