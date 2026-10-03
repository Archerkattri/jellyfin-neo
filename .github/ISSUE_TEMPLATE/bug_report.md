---
name: Bug report
about: Create a report to help us improve
title: ''
labels: bug
assignees: ''

---

Four considerations:
 - Please do not open bug reports to ask questions. Use the Discussions feature instead.
 - Please make sure the issue only pertains to Jellyfin Desktop. If it also occurs in the web client, send the issue to jellyfin-web instead.
 - Please make sure that your issue is not being caused by errors in custom CSS or note that you are using custom CSS.
     - Notably, there have been instances of custom CSS breaking TV mode.
     - You can disable custom CSS under Display in the user settings.
 - Please provide logs. You can drag the log file into the issue to attach it.
     - Windows: `%LOCALAPPDATA%\Jellyfin Desktop\profiles\<profile-id>\logs\`
     - Linux: `~/.local/share/jellyfin-desktop/profiles/<profile-id>/logs/`
     - Linux (Flatpak): `~/.var/app/org.jellyfin.JellyfinDesktop/data/jellyfin-desktop/profiles/<profile-id>/logs/`
     - macOS: `~/Library/Logs/Jellyfin Desktop/profiles/<profile-id>/`

**Describe the bug**
A clear and concise description of what the bug is.

**To Reproduce**
Steps to reproduce the behavior:
1. Go to '...'
2. Click on '....'
3. Scroll down to '....'
4. See error

**Expected behavior**
A clear and concise description of what you expected to happen.

**Screenshots**
If applicable, add screenshots to help explain your problem.

**Desktop (please complete the following information):**
 - OS: [e.g. Windows 11]
 - Version [e.g. 2.1.0]
 - Installation Method [e.g. windows installer]

**Additional context**
Add any other context about the problem here.
