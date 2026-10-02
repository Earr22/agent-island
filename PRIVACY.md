# Privacy

Agent Island is designed as a local-first desktop utility. It has no account system, telemetry, analytics SDK, advertising SDK, or built-in cloud sync.

## Data processed locally

### Clipboard history

Clipboard history is offered as a first-run choice before capture starts. It keeps at most 30 recent text or image entries in process memory, with an approximately 32 MiB history budget and an 8-million-pixel per-image limit. It is not written to disk and is cleared when Agent Island exits. Turning it off from the tray menu also clears the in-memory list. Clearing history does not erase the current Windows clipboard value.

### Codex sessions

When a local Codex session directory is available, Agent Island reads lifecycle records needed to determine whether a task is working or idle. It also reads the current prompt text so the task can be identified in the visible UI. Prompt text is visible by default.

For the quota display, the native application parses local Codex `token_count` records containing the primary and secondary rate-limit windows, usage, remaining percentage, reset time, and record timestamp. These fields are displayed locally and held in process memory. Session files are scanned for relevant records; reasoning records are not parsed or displayed. Agent Island does not upload session or quota data. The previous Electron version also displayed optional Credits, plan, and context-window fields; the native version currently does not.

### Windows notifications

Windows notification capture is disabled by default. If explicitly enabled, Agent Island can read visible notification fields supplied by the Windows notification API. Removing a captured notification from Windows Notification Center is a separate setting and is also disabled by default.

### Todos and settings

Todos and elapsed timer state are stored in `%APPDATA%\agent-island\todos.json`. The native and previous Electron versions share `%APPDATA%\agent-island\settings.json`. Previously saved feature choices are preserved during migration. Notification capture and removal are off for a fresh installation.

### Local API

The HTTP API binds only to `127.0.0.1:17321` by default; it is not exposed to the LAN. Event and decision history is held in process memory. `/v1/state` includes agent task labels, the latest quota snapshot, pending decisions, and the latest event; `/v1/history` exposes recent event text and supplied metadata. Browser requests with an Origin header are rejected. There is no local authentication token: other programs on the computer may call a loopback service and read this data or submit events and decision responses.

### Diagnostics

Error logs are written locally under `%LOCALAPPDATA%\AgentIslandNative\diagnostics` unless an output path is supplied. Errors can include local paths, so sanitize logs before sharing. `--self-test` and `--diagnose` use isolated test data and random local ports; diagnostic screenshots use synthetic task/quota fixtures without scanning real Codex sessions, processes, clipboard, or notifications. Reports remain local until explicitly shared.

## User-triggered outbound actions

The native version removes Send to Notion. Clicking a task can focus its application, launch a Windows application, or open a URL supplied by a local integration. Opening a URL uses the default browser and may contact that destination. The project has no automatic remote content upload.

Agent Island does not otherwise send project, prompt, clipboard, notification, or todo content to a remote service.

## Reports

If you find behavior that does not match this policy, open a public bug report only if it contains no sensitive data. Report security or privacy vulnerabilities privately through [GitHub Security Advisories](https://github.com/Earr22/agent-island/security/advisories/new).
