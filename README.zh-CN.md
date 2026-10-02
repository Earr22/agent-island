# Agent Island（灵动岛）

**面向 Codex 与其他 AI 编程 Agent 的 Windows 指挥中心。**

[English](README.md) · [下载 v0.12.0](https://github.com/Earr22/agent-island/releases/latest) · [反馈问题](https://github.com/Earr22/agent-island/issues/new/choose) · [参与讨论](https://github.com/Earr22/agent-island/discussions)

![Agent Island 展示 Agent 工作状态、待办与剪贴板历史](docs/images/hero.png)

Agent Island 是一个本地优先的 Windows 动态岛：它把 Codex、Claude Code、OpenCode、Cursor 或自定义 Agent 的真实工作状态、完成提醒、错误和人工决策集中到一个置顶小窗口中。

v0.12.0 已重构为 WPF/.NET 8 原生应用，正式下载包不再内嵌 Electron 或 Chromium。旧 Electron 源码保留在 `src/`，便于参考与回退。Agent Island 是独立社区项目，与 OpenAI、Anthropic、Cursor、OpenCode 或 Microsoft 不存在官方隶属或背书关系。

## 主要能力

- Codex Desktop 依据本机会话生命周期显示真实工作/空闲状态。
- 悬停展开与二次展开分别显示 Codex 5 小时额度和每周额度的剩余比例与重置时间；不支持读取额度的 Agent 会明确标为暂无数据。
- 文件事件加速同步，已知 Codex 会话约每 2.5 秒兜底检查；提示中显示来源与更新时间，最新额度快照可从本地 `/v1/state` 获取。账户额度仍取决于 Codex 写入的新记录。
- 三个预建原生页面复用布局，后台读取会话，展开和切页使用变换动画；隐藏后停止伙伴与氛围动画。
- Claude Code 权限 Hook 可在岛上直接允许或拒绝，并将结果返回 Claude Code。
- 支持顶部、底部、左右侧和自由位置，靠边吸附并自动隐藏。
- 工作、待办、剪贴板三页集中展示；点击工作条目可返回对应应用。
- 内置待办、完成状态和单任务计时器。
- 通用本地 REST API 与 PowerShell 客户端，方便其他 Agent 接入。
- Windows 通知捕获默认关闭，捕获后删除也默认关闭。

## 下载与安全提示

从 [Releases](https://github.com/Earr22/agent-island/releases/latest) 选择 ZIP 与对应 `.sha256` 文件：

- 推荐：`Agent-Island-Native-0.12.0-win-x64-self-contained.zip`，包含所需 .NET 桌面运行时。
- 小体积版：`Agent-Island-Native-0.12.0-win-x64-framework-dependent.zip`，需要电脑已安装 .NET 8 Desktop Runtime（x64）。

完整解压后运行 `AgentIsland.Native.exe`，不要单独移动 EXE；同目录的 DLL、运行时、托盘图标和通知脚本也需要保留。支持 Windows 10/11 x64，无需安装器或管理员权限。

当前 Release 构建尚未进行代码签名，因此 Windows SmartScreen 可能提示“未知发布者”。请先核对 SHA-256，或按英文 README 的步骤从源码构建。

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

## 反馈与贡献

普通问题请使用 [Issues](https://github.com/Earr22/agent-island/issues/new/choose)，想法和使用案例请发到 [Discussions](https://github.com/Earr22/agent-island/discussions)。安全漏洞请通过 [GitHub Security Advisories](https://github.com/Earr22/agent-island/security/advisories/new) 私下报告。

许可证：[MIT](LICENSE)。
