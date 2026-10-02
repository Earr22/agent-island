# Agent Island（灵动岛）

**把 AI 编程助手的工作状态，放进 Windows 灵动岛。**

[下载 Windows 版](https://github.com/Earr22/agent-island/releases/latest) · [English](README.md) · [反馈问题](https://github.com/Earr22/agent-island/issues/new/choose) · [参与讨论](https://github.com/Earr22/agent-island/discussions)

查看 Codex 工作状态与额度，接收 Agent 提醒，通过 Claude Code Hook 在岛上处理授权，不必来回寻找窗口。

![灵动岛从收起状态展开，展示 Codex 额度、工作事件、模拟的 Claude Code 授权请求和待办](docs/images/demo.gif)

*真实原生界面，任务、额度和授权请求均为模拟数据。[观看或下载 15 秒演示视频](https://github.com/Earr22/agent-island/raw/refs/heads/main/docs/images/demo.mp4)。没有录制私人桌面或账户数据。*

原生 WPF/.NET 8 · Windows 10/11 x64 · 免安装 · MIT 开源 · 无遥测

## 三步开始使用

1. **[下载 Windows 完整运行包](https://github.com/Earr22/agent-island/releases/download/v0.12.1/Agent-Island-Native-0.12.1-win-x64-self-contained.zip)**，同时下载 [SHA-256 校验文件](https://github.com/Earr22/agent-island/releases/download/v0.12.1/Agent-Island-Native-0.12.1-win-x64-self-contained.zip.sha256)。推荐这个版本，已包含所需 .NET 桌面运行时。
2. 核对校验值，将 ZIP **完整解压**到可写文件夹。不要只移动 EXE；同目录的 DLL、运行时、托盘图标和通知脚本都需要保留。
3. 运行 `AgentIsland.Native.exe`，选择是否启用剪贴板历史。悬停展开小岛，点击进入工作区。

无需安装器或管理员权限。Codex Desktop 状态来自本机会话记录；Claude Code 授权处理需要[配置 Hook](README.md#claude-code)。其他 Agent 需要接入插件或本地 API，不能仅凭检测到进程就获得完整任务状态。

**安全提示：**当前构建未进行代码签名，Windows SmartScreen 可能提示“未知发布者”。请先核对 SHA-256；也可以[从源码构建](#从源码运行)。

如果已经安装 .NET 8 Desktop Runtime（x64），可选[小体积运行包](https://github.com/Earr22/agent-island/releases/download/v0.12.1/Agent-Island-Native-0.12.1-win-x64-framework-dependent.zip)。所有运行包与校验文件见 [Releases](https://github.com/Earr22/agent-island/releases/latest)。

## 实际用起来是什么样

### 看见正在运行的任务，也看见需要你处理的事

Codex 生命周期记录用于区分“正在工作”和“进程开着但空闲”。工作页集中展示已接入 Agent 的完成提醒、错误和事件。点击条目可返回匹配的应用，但不保证定位到具体终端标签或 CLI 子任务。

![灵动岛工作页，展示模拟 Codex 任务](docs/images/work.png)

### 一眼查看 Codex 两个额度窗口

悬停即可看到 5 小时与每周额度的剩余比例。额度提示中可查看重置时间、数据来源和更新时间。数值来自 Codex 本地记录，不进行估算；不支持读取额度的 Agent 会明确标为暂无数据。

![灵动岛悬停页，展示模拟的 5 小时和每周剩余额度](docs/images/quota.png)

### 在岛上处理 Claude Code 授权

配置 Claude Code 权限 Hook 后，可以直接点击“允许”或“拒绝”，结果会返回 Claude Code。**Codex 的批准请求仍需回到 Codex 处理。**

![灵动岛中模拟的 Claude Code 授权卡片，提供允许与拒绝按钮](docs/images/decision.png)

### 顺手的小工具，不用再开一个窗口

- 工作、待办、剪贴板三页集中展示；待办支持完成状态和单任务计时器。
- 顶部、底部、左右侧和自由位置，支持靠边吸附与自动隐藏。
- 可选剪贴板历史，仅在内存保留最近 30 条文字或图片；Windows 通知捕获默认关闭。
- 像素伙伴区分工作、休息和待处理状态；隐藏后停止装饰动画。
- 提供 Codex 生命周期 Hook、Claude Code Hook、OpenCode 示例插件与通用本地 REST API。

## 接入方式与边界

| 工具 | 支持内容 | 接入方式 |
| --- | --- | --- |
| Codex Desktop | 工作/空闲状态、可见任务正文、5 小时与每周额度 | 本机会话监控；可选生命周期 Hook |
| Claude Code | Hook 工作事件和权限决策 | 配置 Claude Code Hook |
| OpenCode | 示例插件发送的事件 | 安装示例插件 |
| Cursor / 其他本地 Agent | REST 事件与匹配应用跳转 | 通过集成或脚本发送事件 |

具体步骤见[英文接入文档](README.md#agent-integrations)。Agent Island 是独立社区项目，与 OpenAI、Anthropic、Cursor、OpenCode 或 Microsoft 不存在官方隶属或背书关系。

## 隐私默认值

- 剪贴板历史在首次启动时由用户选择；只在进程内存保留最近 30 条并限制图片内存，退出即清除，托盘关闭后立即清空。
- Codex 提示正文默认显示，用于识别正在执行的任务；在本地解析 5 小时与每周额度和重置时间，忽略推理记录。
- 最新额度快照会包含在仅限回环地址的 `/v1/state` 响应中；同一 Windows 用户下的本地程序仍可能访问该接口。
- Windows 通知捕获默认关闭；捕获后从通知中心删除必须单独开启。
- 本地 API 只监听 `127.0.0.1:17321`，并关闭浏览器跨域访问。
- 待办写入 `%APPDATA%\agent-island\todos.json`。
- 没有遥测、分析 SDK、云端账号或后台上传。

完整说明见 [PRIVACY.md](PRIVACY.md)。

## 从 Electron 升级

v0.12.0 已重构为 WPF/.NET 8 原生应用，正式下载包不再内嵌 Electron 或 Chromium。旧 Electron 源码保留在 `src/`，便于参考与回退。

先退出旧版再启动原生版，两者使用同一个 17321 端口与 `%APPDATA%\agent-island` 设置/待办目录。原有快捷方式和开机启动项若仍指向旧版，需要改为新 EXE；原生版托盘可设置开机启动。需要回退时先退出原生版，再运行 [v0.11.3](https://github.com/Earr22/agent-island/releases/tag/v0.11.3)。

原生版移除了发送到 Notion；当前额度栏不再显示旧版 Credits/上下文用量。通知捕获不能阻止 Windows 原生横幅，若只想在岛内看到通知，需自行调整系统通知设置。

## 从源码运行

需要 Windows 10/11 和 .NET 8 SDK：

```powershell
git clone https://github.com/Earr22/agent-island.git
cd agent-island
.\native\build.ps1
.\dist\native\AgentIsland.Native.exe
```

验证和构建：

```powershell
.\dist\native\AgentIsland.Native.exe --self-test --output=artifacts/native-self-test
.\dist\native\AgentIsland.Native.exe --diagnose --output=artifacts/native-diagnostics
.\native\build.ps1 -SelfContained -OutputDirectory artifacts/native-self-contained
```

原生构建说明见 [native/README.zh-CN.md](native/README.zh-CN.md)。Node.js/Electron 仅用于可选的图标生成与旧版开发。Agent 接入示例与 HTTP API 说明见 [英文 README](README.md)。

### 重新生成公开演示

演示直接渲染真实 WPF 界面，使用隔离的虚构任务与额度，不录桌面。渲染器不启动真实会话监控、剪贴板捕获、系统通知捕获或 HTTP 监听，也不读取正式设置和待办。

安装 .NET 8 SDK，并在 Python 环境中准备 Pillow 后运行：

```powershell
.\scripts\render-showcase.ps1
```

可用 `-Dotnet`、`-Python` 指定已有运行环境。MP4 编码可选：在指定 Python 环境中准备 `imageio-ffmpeg`，或用 `-Ffmpeg` 指定已有编码器。临时帧和虚构数据保留在已忽略的 `artifacts/`；只公开审核后的 `docs/images/` 素材，不公开诊断日志或真实会话截图。

## 反馈与贡献

普通问题请使用 [Issues](https://github.com/Earr22/agent-island/issues/new/choose)，想法和使用案例请发到 [Discussions](https://github.com/Earr22/agent-island/discussions)。安全漏洞请通过 [GitHub Security Advisories](https://github.com/Earr22/agent-island/security/advisories/new) 私下报告。

许可证：[MIT](LICENSE)。
