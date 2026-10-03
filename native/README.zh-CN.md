# Agent Island 原生版 v0.12.2

Windows 原生 WPF/.NET 8 实现。正式发布包不包含 Electron 或 Chromium；旧版源码保留供参考与回退。

v0.12.2 改进胶囊、悬停态和展开面板的拖动，保持移动后的显示状态，并让四边吸附确认框始终位于屏幕内。保留 v0.12.1 的授权卡片修复与隔离双语演示工具。

## 下载与运行

推荐选择 self-contained ZIP：包含运行时，完整解压后运行 `AgentIsland.Native.exe`。framework-dependent ZIP 更小，需要先安装 .NET 8 Desktop Runtime（x64）。两者都支持 Windows 10/11 x64。请核对对应 SHA-256，不要只复制 EXE。

从 Electron 版升级前先退出旧版。原生版复用 `%APPDATA%\agent-island\settings.json` 和 `todos.json`，默认端口为 17321。快捷方式/开机启动项需要指向新的 EXE；托盘可设置启动项。旧版仍可从 v0.11.3 Release 下载。开发目录中的 `rollback.ps1` 仅在 `dist/win-unpacked` 仍有旧程序时适用，不会用旧快照覆盖当前待办。

## 构建

需要 .NET 8 SDK，不需要 Node.js：

```powershell
.\native\build.ps1
.\native\build.ps1 -SelfContained -OutputDirectory artifacts/native-self-contained
```

默认输出 `dist/native`，依赖共享桌面运行时。`-Dotnet` 可指定已有 SDK 的 dotnet.exe；`-ReadyToRun` 可启用预编译。可选图标生成工具使用 Electron，但不进入原生产品运行时。

## 功能和边界

- 工作、待办、剪贴板三个预建页面；tab 区滚轮切页，列表区滚动内容。发送到 Notion 已移除。
- 原生工具窗口、托盘、四边吸附、自动隐藏、拖拽及吸附确认。
- 胶囊和悬停展开态可在伙伴、文字或空白处按住左键拖动；二次展开后拖动顶部细横条。轻点仍打开工作页，tab、按钮和列表滚动不作为拖动入口。移动到边缘时可选择吸附或保持自由位置，确认框限制在屏幕内。
- 原有蓝紫/薄荷绿伙伴与独立托盘图标；隐藏后停止伙伴和氛围装饰动画。
- 点击工作条目会重新查找并激活应用窗口，不保证定位到每个 CLI 子任务。
- Codex 生命周期和额度在后台增量解析，2.5 秒兜底检查，30 秒发现新会话。5h/每周额度显示剩余值和更新时间，服务端即时变化只有写入新本地记录后才可见。
- 当前不显示旧 Electron 版的 Credits/上下文用量字段。
- 兼容本地 REST 事件、决策、Claude 权限 Hook、Codex Hook；仅监听回环地址，拒绝带 Origin 的浏览器请求，请求限 512 KiB、并发限 32。
- 首次启动提供剪贴板选择；历史仅内存，最多 30 条，并有图片内存限制。
- 新安装的 Windows 通知捕获与捕获后删除默认关闭。升级保留已保存的选择。捕获不能阻止 Windows 原生 toast，单岛显示需要系统通知设置配合。
- 复用现有设置/待办，源代码没有账号、遥测或远程日志系统。错误日志留在本机，分享前需移除路径等私人信息。

## 验证

```powershell
.\dist\native\AgentIsland.Native.exe --self-test --output=artifacts/native-self-test
.\dist\native\AgentIsland.Native.exe --diagnose --output=artifacts/native-diagnostics
```

自测使用临时会话与待办、随机端口。诊断使用模拟 Agent 和额度，不扫描真实会话/进程，不捕获剪贴板或系统通知，不修改正式设置。输出 UI 检查、四边布局检查、模拟截图以及短时调度/帧回调样本。

WPF 帧回调不等同屏幕呈现的完整 ETW 测量；短时样本不代表数小时闲置效果或所有硬件表现。小体积包依赖共享运行时，不能把它与包含全部运行时的包直接比较。

隐私完整边界见 [PRIVACY.md](../PRIVACY.md)，下载、集成与迁移见根目录 README。

### 拖拽修复（2026-10-03）

补全透明胶囊的命中区域与展开面板的独立拖动入口。使用 WPF 鼠标捕获、系统拖动阈值和 DPI 换算；按住期间暂停悬停/隐藏状态切换，丢失捕获时清理状态并保留已移动的位置。拖动完成不强制折叠面板。吸附确认改为短生命周期 Popup，独立于透明画布且做屏幕边界限制。

参考 [Microsoft WPF 窗口输入实现](https://github.com/dotnet/wpf/blob/main/src/Microsoft.DotNet.Wpf/src/PresentationFramework/System/Windows/Window.cs) 与 [EchoIsland 交互状态分离](https://github.com/FunplayAI/EchoIsland/blob/main/apps/desktop/src-tauri/src/native_panel_core/interaction.rs)。本实现沿用原生 WPF，不引入新的运行时依赖或拖动轮询。

隔离诊断新增空白命中、拖动阈值、拖动状态保护、DPI 位移、捕获丢失、四边确认和展开拖动入口检查。`--diagnose --manual-ui --output=...` 可启动隔离的手动测试窗口；只有此测试模式显示任务栏窗口，不影响正式版的托盘行为。
