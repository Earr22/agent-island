# Agent Island

**A Windows command center for Codex and other AI coding agents.**

[中文说明](README.zh-CN.md) · [Download v0.12.0](https://github.com/Earr22/agent-island/releases/latest) · [Report a bug](https://github.com/Earr22/agent-island/issues/new/choose) · [Join the discussion](https://github.com/Earr22/agent-island/discussions)

![Agent Island showing the built-in todo workspace](docs/images/hero.png)

Agent Island turns AI-agent activity into a small, always-available Dynamic Island for Windows. It shows real work state, completion, errors, notifications, and decisions without making you hunt through terminal or editor windows.

Version 0.12.0 rebuilds the application with native WPF and .NET 8. The released application no longer embeds Electron or Chromium. The previous Electron implementation remains in `src/` for reference and rollback. Agent Island is an independent community project and is not affiliated with or endorsed by OpenAI, Anthropic, Cursor, OpenCode, or Microsoft.

## Why Agent Island?

- **See what is actually happening.** Codex Desktop lifecycle events drive working and idle states instead of treating a running process as active work.
- **Watch both real quota windows.** Hover and workspace views show Codex's 5-hour and weekly remaining percentages with their reset times; unsupported agents are marked unavailable instead of showing estimated data.
- **Keep quota data fresh and scriptable.** Known Codex sessions are rechecked about every 2.5 seconds, filesystem events accelerate updates, and the current snapshot is available from the loopback `/v1/state` endpoint. Account data only changes when Codex writes new local records.
- **Open a prepared workspace.** Three reusable native pages and transform-based animations keep file parsing and discovery off the UI thread; hidden decorative animations stop.
- **Return to the right window.** The workspace lists connected agents and recent events, then focuses the matching application.
- **Handle decisions quickly.** Claude Code permission hooks can wait for an Allow or Deny response in the island.
- **Keep small tasks nearby.** Built-in todos include completion state and a single-task timer.
- **Stay local by default.** The API listens only on `127.0.0.1`; clipboard history stays in memory; notification capture is off until enabled.

## Highlights

- Top, bottom, left, right, or free placement with edge snapping and auto-hide.
- Pixel companion states for working, resting, and attention.
- Work, Todos, and Clipboard pages in one compact surface.
- Codex Desktop session monitoring plus Codex lifecycle hooks.
- Claude Code hooks, including permission decisions.
- OpenCode example plugin and a generic local REST API.
- Optional Windows notification capture, disabled by default.
- Memory-only clipboard history for the latest 30 text or image items.
- Portable Windows build; no installer or administrator access required.

## Download

Choose a ZIP and its `.sha256` file from the [latest release](https://github.com/Earr22/agent-island/releases/latest):

- `Agent-Island-Native-0.12.0-win-x64-self-contained.zip`: recommended; includes the .NET desktop runtime.
- `Agent-Island-Native-0.12.0-win-x64-framework-dependent.zip`: smaller; requires the .NET 8 Desktop Runtime (x64) to be installed separately.

Extract the entire ZIP into a writable folder, then run `AgentIsland.Native.exe`. Keep the DLLs, runtime files, tray icon, and notification helper alongside the executable. No installer or administrator access is required.

Release builds are currently **not code-signed**, so Windows SmartScreen may show an “Unknown publisher” warning. Verify the SHA-256 file before running it. You can also build from source using the instructions below.

Requirements: Windows 10 or 11, x64.

## Privacy at a glance

| Capability | Default | Storage / network behavior |
| --- | --- | --- |
| Clipboard history | First-run choice | Last 30 items in process memory only, with an image-memory bound; cleared on exit |
| Windows notification capture | Off | When enabled, reads visible toast text locally |
| Remove captured notifications | Off | Must be enabled separately |
| Todos | On demand | Stored at `%APPDATA%\agent-island\todos.json` |
| Codex session monitoring | On when Codex is present | Reads lifecycle events, prompt text, 5-hour and weekly quota/rate-limit fields locally; reasoning records are not parsed or displayed |
| Local event API | On | Binds to `127.0.0.1:17321`; browser cross-origin access is disabled |
| Telemetry / analytics | None | No usage analytics, tracking SDK, or cloud account |

The Codex prompt body is visible by default because it identifies the active task. Disable clipboard history at any time from the tray menu, which also clears its in-memory history. Existing settings and todos remain at `%APPDATA%\agent-island`. Read [PRIVACY.md](PRIVACY.md) for the complete data boundary.

## Upgrade from Electron

Exit the Electron application before starting the native version; both use port 17321 and the same settings/todo directory. If an old shortcut or startup entry still launches Electron, update it to the native executable. The native tray menu can configure startup. The previous [v0.11.3 release](https://github.com/Earr22/agent-island/releases/tag/v0.11.3) remains available for rollback; exit the native app first.

The native version removes Send to Notion and currently shows quota windows without the previous Credits/context tooltip fields. Notification capture does not suppress Windows toast banners; configure Windows notification settings if you want island-only reminders.

## Run from source

Install the .NET 8 SDK on Windows, then:

```powershell
git clone https://github.com/Earr22/agent-island.git
cd agent-island
.\native\build.ps1
.\dist\native\AgentIsland.Native.exe
```

Development and validation:

```powershell
.\dist\native\AgentIsland.Native.exe --self-test --output=artifacts/native-self-test
.\dist\native\AgentIsland.Native.exe --diagnose --output=artifacts/native-diagnostics
.\native\build.ps1 -SelfContained -OutputDirectory artifacts/native-self-contained
```

The default build is framework-dependent and writes to `dist/native/`. See [native/README.zh-CN.md](native/README.zh-CN.md) for details. Node.js and Electron are needed only for optional icon regeneration and the legacy implementation.

## Send an event in 30 seconds

With Agent Island running:

```powershell
.\scripts\agent-island.ps1 -Source codex -Type progress -Title "Checking the project" -Message "7 of 10 checks complete" -Progress 70
```

Or send JSON to the loopback API:

```http
POST http://127.0.0.1:17321/v1/events
Content-Type: application/json

{
  "source": "cursor",
  "type": "progress",
  "title": "Refactoring authentication",
  "message": "Running tests",
  "progress": 68,
  "taskId": "auth-refactor",
  "systemNotify": false
}
```

Supported event types are `working`, `progress`, `success`, `error`, `warning`, `notification`, and `decision`. The service keeps at most 120 recent events in memory and accepts request bodies up to 512 KB.

## Agent integrations

### Codex

Agent Island incrementally scans local Codex Desktop session files for lifecycle and quota records. `task_started` starts the work state and `task_complete` returns it to idle. Prompt text is used as the visible task label. `token_count` records provide the 5-hour and weekly quota windows and reset times. Reasoning records are ignored. The latest quota snapshot is also included in the loopback-only `/v1/state` response.

For lifecycle hooks, copy [`integrations/codex.hooks.example.json`](integrations/codex.hooks.example.json) to `~/.codex/hooks.json`, replace `PROJECT_PATH`, and trust it from Codex. Codex approval requests currently direct you back to Codex; Agent Island does not claim an approval it cannot send back.

### Claude Code

Merge the hooks from [`integrations/claude.settings.example.json`](integrations/claude.settings.example.json) into `~/.claude/settings.json` or a project `.claude/settings.json`. A `PermissionRequest` can wait for a decision in Agent Island and return the result to Claude Code.

### OpenCode and other agents

Copy [`integrations/opencode-plugin.example.js`](integrations/opencode-plugin.example.js) to your OpenCode plugin directory. Any local tool that can make an HTTP request can use the same API; see [`scripts/agent-island.ps1`](scripts/agent-island.ps1) for a minimal client.

## Roadmap

- Easier one-click integration setup.
- More explicit per-source privacy controls.
- Signed Windows releases when sustainable.
- Richer multi-agent timelines and decision routing.

Ideas and real-world integration reports are welcome in [Discussions](https://github.com/Earr22/agent-island/discussions).

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Please report vulnerabilities privately through [GitHub Security Advisories](https://github.com/Earr22/agent-island/security/advisories/new), not through a public issue.

## License

[MIT](LICENSE). Third-party runtime notices are described in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
