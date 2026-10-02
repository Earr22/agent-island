using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;

namespace AgentIsland;

sealed class Backend : IDisposable
{
    readonly object gate = new();
    readonly SessionMonitor sessions;
    readonly CancellationTokenSource stop = new();
    readonly Dictionary<string, TaskState> hookStates = new();
    readonly Dictionary<string, bool> parentTasks = new();
    readonly Dictionary<string, int> childTasks = new();
    readonly Dictionary<string, Decision> decisions = new();
    readonly List<IslandEvent> history = new();
    Agent[] agents = Array.Empty<Agent>();
    TaskState codexState = new("idle", "空闲", "Codex 当前空闲", "当前没有活动任务");
    Usage? usage;
    Process? notificationHelper;
    public string NotificationAccess { get; private set; } = "未启动";
    public readonly Settings Settings;
    public readonly string DataPath;
    public TodoStore Todos { get; }
    public LocalApi Api { get; }
    public event Action? Changed;
    public event Action<IslandEvent>? Published;
    public Backend(string dataPath, Settings settings)
    {
        DataPath = dataPath; Settings = settings;
        Todos = new(Path.Combine(dataPath, "todos.json"));
        Todos.Changed += () => Changed?.Invoke();
        var home = Environment.GetEnvironmentVariable("CODEX_HOME") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex");
        sessions = new(Path.Combine(home, "sessions"));
        sessions.Changed += (state, u) => { lock (gate) { if(codexState.TaskId!=state.TaskId || codexState.Status!=state.Status)hookStates.Remove("codex"); codexState = state; if (u != null) usage = u; } Changed?.Invoke(); };
        Api = new(this);
    }
    public void Start(bool diagnostic)
    {
        Api.Start(Settings.Port);
        if (diagnostic)
        {
            agents = new[] { new Agent("codex", "Codex", "CX", Array.Empty<int>(), Array.Empty<string>(), new("working", "工作中", "验证发布包", "运行模拟检查")) };
            codexState = new("working", "工作中", "验证发布包", "运行模拟检查", "demo-turn", "demo-session", 1);
            usage = new("codex", "Codex", true, new[] {
                new QuotaWindow("primary", 23, 77, 300, DateTimeOffset.UtcNow.AddHours(3).ToUnixTimeSeconds()),
                new QuotaWindow("secondary", 37, 63, 10080, DateTimeOffset.UtcNow.AddDays(2).ToUnixTimeSeconds())
            }, Json.Now);
            return;
        }
        sessions.Start();
        _ = Task.Run(async () =>
        {
            while (!stop.IsCancellationRequested)
            {
                RefreshProcesses();
                try { await Task.Delay(30000, stop.Token).ConfigureAwait(false); } catch (OperationCanceledException) { break; }
            }
        });
        if (!diagnostic && Settings.CaptureWindowsNotifications) StartNotifications();
    }
    static readonly (string id, string label, string glyph, string[] processes, string[] focus)[] Definitions = {
        ("codex", "Codex", "CX", new[]{"codex", "ChatGPT"}, new[]{"ChatGPT", "codex"}),
        ("claude", "Claude", "CL", new[]{"claude"}, new[]{"WindowsTerminal", "powershell", "cmd"}),
        ("cursor", "Cursor", "CU", new[]{"Cursor"}, new[]{"Cursor"}),
        ("opencode", "OpenCode", "OC", new[]{"opencode"}, new[]{"OpenCode", "WindowsTerminal"}),
        ("windsurf", "Windsurf", "WS", new[]{"Windsurf"}, new[]{"Windsurf"}),
        ("gemini", "Gemini", "GM", new[]{"gemini"}, new[]{"WindowsTerminal", "powershell"})
    };
    void RefreshProcesses()
    {
        try
        {
            var ps = Process.GetProcesses();
            try
            {
                var next = Definitions.Select(d => new Agent(d.id, d.label, d.glyph,
                    ps.Where(p => d.processes.Contains(p.ProcessName, StringComparer.OrdinalIgnoreCase)).Select(p => p.Id).ToArray(), d.focus,
                    new("idle", "空闲", "", ""))).Where(a => a.ProcessIds.Length > 0).ToArray();
                lock (gate) { if (Json.Write(next) == Json.Write(agents)) return; agents = next; }
                Changed?.Invoke();
            }
            finally { foreach (var p in ps) p.Dispose(); }
        }
        catch (Exception ex) { Diagnostics.Log("process-monitor", ex.Message); }
    }
    public Agent[] Agents
    {
        get
        {
            lock (gate)
            {
                var connected=agents.Select(a => a with { TaskState = a.Id == "codex" ? hookStates.GetValueOrDefault(a.Id)?.Status=="waiting"?hookStates[a.Id]:codexState : hookStates.GetValueOrDefault(a.Id) ?? a.TaskState }).ToList();
                foreach(var state in hookStates.Where(x => x.Value.Status != "idle" && !connected.Any(a=>a.Id==x.Key)))
                {
                    var d=Definitions.FirstOrDefault(d=>d.id==state.Key);
                    connected.Add(new(state.Key,d.label??state.Key,d.glyph??"AI",Array.Empty<int>(),d.focus??Array.Empty<string>(),state.Value));
                }
                return connected.ToArray();
            }
        }
    }
    public Usage[] Usage { get { lock (gate) return usage == null ? Array.Empty<Usage>() : new[] { usage }; } }
    public IslandEvent[] History { get { lock (gate) return history.ToArray(); } }
    public Decision[] Pending { get { lock (gate) return decisions.Values.Where(d => d.Status == "pending").ToArray(); } }
    public object State => new { name = "Agent Island", version = "0.12.0-native", listening = true, address = $"http://127.0.0.1:{Api.Port}", activeAgents = Agents, agentUsage = Usage, windowsNotifications = new { access = NotificationAccess }, pendingDecisions = Pending, latestEvent = History.FirstOrDefault() };
    public void SaveSettings() => Json.AtomicWrite(Path.Combine(DataPath, "settings.json"), Settings);
    public static string[] ProcessHints(string source) => Definitions.FirstOrDefault(d => d.id == source).focus ?? Array.Empty<string>();
    static string[] AppHints(string app) => app switch
    {
        "ChatGPT"=>new[]{"ChatGPT"}, "Microsoft Outlook" or "Outlook"=>new[]{"OUTLOOK","olk"},
        "Teams" or "Microsoft Teams"=>new[]{"ms-teams","Teams"}, "微信"=>new[]{"WeChat"},
        "QQ"=>new[]{"QQ"}, "Notion"=>new[]{"Notion"},_=>new[]{app,app.Replace(" ","")}
    };
    public WorkItem[] WorkItems()
    {
        var items = new List<WorkItem>();
        foreach (var a in Agents)
            items.Add(new("agent:" + a.Id, $"{a.Label} · {a.TaskState.Label}", a.TaskState.Status == "idle" ? "当前无任务 · 点击返回应用" : a.TaskState.Message, a.TaskState.Label, a.Glyph, new(a.FocusProcessNames, a.ProcessIds)));
        foreach (var e in History.Where(e => !e.Context.Bool("presenceOnly")).DistinctBy(e => e.TaskId.Length > 0 ? e.TaskId : e.Id).Take(40))
        {
            var target = new Target(e.Context.Bool("capturedFromWindows")?AppHints(e.SourceLabel):ProcessHints(e.Source), AppUserModelId: e.Context.Text("appUserModelId"), Url: e.Context.Text("url") is { Length: > 0 } u ? u : null);
            items.Add(new(e.Id, $"{e.SourceLabel} · {e.Title}", e.Message, e.Type == "decision" ? GetDecision(e.Id)?.Status=="pending"?"待决策":"已处理" : e.Type == "success" ? "已完成" : "通知", e.SourceGlyph, target, e.Id));
        }
        return items.ToArray();
    }
    public IslandEvent Publish(JsonNode payload, string? source = null)
    {
        var e = Normalize(payload, source);
        lock (gate)
        {
            history.Insert(0, e); if (history.Count > 120) history.RemoveRange(120, history.Count - 120);
            if (e.Source != "system")
            {
                var hook=e.Context.Text("hookEventName");
                var status = e.Type is "working" or "progress" ? "working" : e.Type is "warning" or "decision" ? "waiting" : e.Type is "success" or "error" ? "idle" : "";
                if(hook=="SubagentStart")childTasks[e.Source]=childTasks.GetValueOrDefault(e.Source)+1;
                else if(hook=="SubagentStop")
                {
                    childTasks[e.Source]=Math.Max(0,childTasks.GetValueOrDefault(e.Source)-1);
                    status=parentTasks.GetValueOrDefault(e.Source)||childTasks.GetValueOrDefault(e.Source)>0?"working":"idle";
                }
                else if(status=="working")parentTasks[e.Source]=true;
                else if(status=="idle") { parentTasks[e.Source]=false; childTasks[e.Source]=0; }
                if (status.Length > 0) hookStates[e.Source] = new(status, status == "working" ? "工作中" : status == "waiting" ? "等待处理" : "空闲", e.Title, e.Message, e.TaskId);
            }
        }
        Changed?.Invoke(); Published?.Invoke(e); return e;
    }
    static IslandEvent Normalize(JsonNode p, string? source)
    {
        var s = source ?? p.Text("source", "generic");
        var d = Definitions.FirstOrDefault(d => d.id == s);
        var type = p.Text("type", "notification");
        type = type switch { "running" or "started" or "thinking" => "working", "complete" or "completed" or "done" => "success", "failed" => "error", "approval" or "permission" => "decision", _ => type };
        var e = new IslandEvent { Id = p.Text("id", Guid.NewGuid().ToString()), Source = s, SourceLabel = p.Text("sourceLabel", d.label ?? (s == "system" ? "Windows" : "Agent")), SourceGlyph = p.Text("sourceGlyph", d.glyph ?? "AI"), Type = type, Title = p.Text("title", "通知"), Message = p.Text("message", p.Text("body")), Detail = p.Text("detail"), TaskId = p.Text("taskId", p.Text("task_id")), Silent = p.Bool("silent"), Context = p["context"]?.DeepClone() as JsonObject ?? new() };
        if (p["actions"] is JsonArray actions)
            foreach (var a in actions.Take(5)) e.Actions.Add(a is JsonValue ? new(a!.ToString(), a.ToString()) : new(a.Text("id", "choice"), a.Text("label", "选项"), a.Text("style", "secondary")));
        return e;
    }
    public void DeleteEvent(string id) { lock (gate) history.RemoveAll(e => e.Id == id); Changed?.Invoke(); }
    public Decision Ask(JsonNode payload)
    {
        var p = payload.DeepClone(); p["type"] = "decision";
        if (p["actions"] is not JsonArray { Count: > 0 }) p["actions"] = new JsonArray(new JsonObject { ["id"] = "allow", ["label"] = "允许" }, new JsonObject { ["id"] = "deny", ["label"] = "拒绝" });
        var e = Publish(p);
        var d = new Decision { Event = e };
        lock (gate) decisions[e.Id] = d;
        Changed?.Invoke();
        _ = Task.Run(async () => { try { await Task.Delay((int)Math.Clamp(payload.Number("timeoutMs", payload.Number("timeout_ms", 600000)), 5000, 900000), stop.Token); lock (gate) { if (d.Status != "pending") return; d.Status = "expired"; d.RespondedAt = Json.Now; d.Completion.TrySetResult(d); } Changed?.Invoke(); } catch (OperationCanceledException) { } });
        return d;
    }
    public Decision? GetDecision(string id) { lock (gate) return decisions.GetValueOrDefault(id); }
    public bool Respond(string id, string choice)
    {
        lock (gate)
        {
            var d = decisions.GetValueOrDefault(id); var action = d?.Event.Actions.Find(a => a.Id == choice);
            if (d == null || d.Status != "pending" || action == null) return false;
            d.Choice = action.Id; d.Label = action.Label; d.Status = "answered"; d.RespondedAt = Json.Now; d.Completion.TrySetResult(d);
            parentTasks[d.Event.Source]=choice=="allow";
            hookStates[d.Event.Source] = new(choice == "allow" ? "working" : "idle", choice == "allow" ? "工作中" : "空闲", d.Event.Title, d.Event.Message);
        }
        Changed?.Invoke(); return true;
    }
    public JsonNode Hook(JsonNode p, string source)
    {
        var name = p.Text("hook_event_name", p.Text("type", "Notification"));
        var presence = name == "SessionStart";
        var type = name switch { "PermissionRequest" or "approval-requested" => source == "claude" ? "decision" : "warning", "UserPromptSubmit" or "SubagentStart" or "TaskCreated" => "working", "Stop" or "SubagentStop" or "TaskCompleted" or "agent-turn-complete" or "SessionStart" => "success", "StopFailure" or "PostToolUseFailure" => "error", _ => "notification" };
        if(name=="Notification")type=p.Text("notification_type") switch { "permission_prompt" or "agent_needs_input" or "elicitation_dialog"=>"warning","agent_completed"=>"success",_=>type};
        return new JsonObject { ["source"] = source, ["type"] = type, ["taskId"] = p.Text("session_id", p.Text("thread-id", p.Text("thread_id"))), ["title"] = type == "decision" ? p.Text("tool_name", "工具") + " 需要授权" : $"{source} · {name}", ["message"] = p.Text("prompt", p.Text("last_assistant_message", p.Text("last-assistant-message", p.Text("message", p["tool_input"]?.ToJsonString() ?? "")))), ["silent"] = presence, ["context"] = new JsonObject { ["hookEventName"] = name, ["presenceOnly"] = presence, ["cwd"] = p.Text("cwd") } };
    }
    public void StartNotifications()
    {
        if (notificationHelper != null) return;
        var info = new ProcessStartInfo("powershell.exe") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = System.Text.Encoding.UTF8 };
        foreach (var a in new[] { "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", Path.Combine(AppContext.BaseDirectory, "windows-notification-listener.ps1"), "-PollMilliseconds", "1200" }) info.ArgumentList.Add(a);
        if (Settings.DismissCapturedNotifications) info.ArgumentList.Add("-RemoveAfterRead");
        notificationHelper = new() { StartInfo = info, EnableRaisingEvents = true };
        notificationHelper.OutputDataReceived += (_, ev) =>
        {
            if (string.IsNullOrWhiteSpace(ev.Data)) return;
            try
            {
                var p = JsonNode.Parse(ev.Data)!;
                if (p.Text("kind") == "status") { NotificationAccess = p.Text("access"); Changed?.Invoke(); }
                if (p.Text("kind") == "notification") Publish(new JsonObject { ["source"] = "system", ["sourceLabel"] = p.Text("appName", "Windows"), ["title"] = p.Text("title"), ["message"] = p.Text("message"), ["context"] = new JsonObject { ["capturedFromWindows"] = true, ["appUserModelId"] = p.Text("appUserModelId") } });
                if (p.Text("kind") == "error") Diagnostics.Log("windows-notifications", p.Text("message"));
            }
            catch (Exception ex) { Diagnostics.Log("windows-notifications", ex.Message); }
        };
        notificationHelper.ErrorDataReceived += (_, e) => { if (!string.IsNullOrWhiteSpace(e.Data)) Diagnostics.Log("windows-notifications", e.Data); };
        notificationHelper.Start(); notificationHelper.BeginOutputReadLine(); notificationHelper.BeginErrorReadLine();
    }
    public void StopNotifications() { if (notificationHelper == null) return; try { if (!notificationHelper.HasExited) notificationHelper.Kill(true); } catch { } notificationHelper.Dispose(); notificationHelper = null; NotificationAccess = "未启动"; }
    public void Dispose() { stop.Cancel(); Api.Dispose(); sessions.Dispose(); StopNotifications(); stop.Dispose(); }
}
