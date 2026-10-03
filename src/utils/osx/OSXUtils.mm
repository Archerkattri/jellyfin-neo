#include "OSXUtils.h"
#include <QDebug>
#import <Cocoa/Cocoa.h>

/////////////////////////////////////////////////////////////////////////////////////////
QString OSXUtils::ComputerName()
{
  return QString::fromNSString([[NSHost currentHost] localizedName]);
}

/////////////////////////////////////////////////////////////////////////////////////////
OSStatus OSXUtils::SendAppleEventToSystemProcess(AEEventID eventToSendID)
{
  AEAddressDesc targetDesc;
  static const  ProcessSerialNumber kPSNOfSystemProcess = {0, kSystemProcess };
  AppleEvent    eventReply  = {typeNull, nullptr};
  AppleEvent    eventToSend = {typeNull, nullptr};

  OSStatus status = AECreateDesc(typeProcessSerialNumber,
    &kPSNOfSystemProcess, sizeof(kPSNOfSystemProcess), &targetDesc);

  if (status != noErr)
    return status;

  status = AECreateAppleEvent(kCoreEventClass, eventToSendID,
    &targetDesc, kAutoGenerateReturnID, kAnyTransactionID, &eventToSend);
  AEDisposeDesc(&targetDesc);

  if (status != noErr)
    return status;

  status = AESendMessage(&eventToSend, &eventReply, kAENormalPriority, kAEDefaultTimeout);
  AEDisposeDesc(&eventToSend);

  if (status != noErr)
    return status;

  AEDisposeDesc(&eventReply);

  return status;
}

/////////////////////////////////////////////////////////////////////////////////////////
void OSXUtils::SetCursorVisible(bool visible)
{
  if (visible)
    [NSCursor unhide];
  else
    [NSCursor hide];
}

/////////////////////////////////////////////////////////////////////////////////////////
void OSXUtils::SetupWindowMenu()
{
  NSMenu *mainMenu = [NSApp mainMenu];
  if (!mainMenu)
  {
    mainMenu = [[NSMenu alloc] init];
    [NSApp setMainMenu:mainMenu];
  }

  NSMenuItem *windowMenuItem = nil;
  for (NSMenuItem *item in [mainMenu itemArray])
  {
    if ([[item title] isEqualToString:@"Window"])
    {
      windowMenuItem = item;
      break;
    }
  }

  NSMenu *windowMenu = [windowMenuItem submenu];
  if (!windowMenu)
  {
    windowMenu = [[NSMenu alloc] initWithTitle:@"Window"];
    if (windowMenuItem)
      [windowMenuItem setSubmenu:windowMenu];
    else
    {
      windowMenuItem = [[NSMenuItem alloc] initWithTitle:@"Window" action:nil keyEquivalent:@""];
      [windowMenuItem setSubmenu:windowMenu];
      [mainMenu addItem:windowMenuItem];
    }
  }

  if ([windowMenu numberOfItems] == 0)
  {
    [windowMenu addItemWithTitle:@"Minimize" action:@selector(performMiniaturize:) keyEquivalent:@"m"];
    [windowMenu addItemWithTitle:@"Zoom" action:@selector(performZoom:) keyEquivalent:@""];
    [windowMenu addItem:[NSMenuItem separatorItem]];
    [windowMenu addItemWithTitle:@"Bring All to Front" action:@selector(arrangeInFront:) keyEquivalent:@""];
  }

  [NSApp setWindowsMenu:windowMenu];
}
