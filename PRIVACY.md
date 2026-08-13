# Privacy

Agent Island is designed as a local-first desktop utility. It has no account system, telemetry, analytics SDK, advertising SDK, or built-in cloud sync.

## Data processed locally

### Clipboard history

Clipboard history is enabled by default with a first-run notice and an immediate opt-out. It keeps at most 30 recent text or image entries in process memory. It is not written to disk and is cleared when Agent Island exits. Turning it off from the tray menu also clears the in-memory list. Clearing history does not erase the current Windows clipboard value.

### Codex sessions

When a local Codex session directory is available, Agent Island reads lifecycle records needed to determine whether a task is working or idle. It also reads the current prompt text so the task can be identified in the visible UI. Prompt text is visible by default. Agent Island does not read reasoning content and does not upload session data.

### Windows notifications

Windows notification capture is disabled by default. If explicitly enabled, Agent Island can read visible notification fields supplied by the Windows notification API. Removing a captured notification from Windows Notification Center is a separate setting and is also disabled by default.

### Todos and settings

Todos and elapsed timer state are stored in `%APPDATA%\agent-island\todos.json`. Application settings are stored under Electron's standard `%APPDATA%\agent-island` data directory.

### Local API

The HTTP API binds only to `127.0.0.1:17321`; it is not exposed to the LAN. Event and decision history is held in process memory. Browser cross-origin access is disabled. Other programs running under your local Windows account may still be able to call a loopback service, so only run software you trust.

## User-triggered outbound actions

The “Send to Notion” action copies a Markdown checklist to the clipboard and opens Notion. It does not authenticate to or write into a Notion database. Native Windows notifications are created only when the relevant feature or event requests them.

Agent Island does not otherwise send project, prompt, clipboard, notification, or todo content to a remote service.

## Reports

If you find behavior that does not match this policy, open a public bug report only if it contains no sensitive data. Report security or privacy vulnerabilities privately through [GitHub Security Advisories](https://github.com/Earr22/agent-island/security/advisories/new).
