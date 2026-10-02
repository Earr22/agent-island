using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace AgentIsland;

// All discovery and JSON parsing runs on a worker, never the WPF dispatcher.
sealed class SessionMonitor : IDisposable
{
    sealed class FileState
    {
        public required string Path;
        public required string SessionId;
        public long Offset;
        public string Partial = "";
        public string TurnId = "";
        public string Prompt = "";
        public bool SawLifecycle;
        public DateTime WriteTime;
        public Usage? Usage;
    }
    readonly Dictionary<string, FileState> files = new(StringComparer.OrdinalIgnoreCase);
    readonly string root;
    readonly CancellationTokenSource stop = new();
    FileSystemWatcher? watcher;
    volatile bool discover = true;
    int wake;
    public event Action<TaskState, Usage?>? Changed;
    string signature = "";
    public SessionMonitor(string root) => this.root = root;
    public void Start()
    {
        if (Directory.Exists(root))
        {
            watcher = new(root, "rollout-*.jsonl") { IncludeSubdirectories = true, NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.Size, EnableRaisingEvents = true };
            watcher.Changed += (_, _) => Interlocked.Exchange(ref wake, 1);
            watcher.Created += (_, _) => { discover = true; Interlocked.Exchange(ref wake, 1); };
            watcher.Error += (_, _) => discover = true;
        }
        _ = Task.Run(Loop);
    }
    async Task Loop()
    {
        var nextDiscovery = DateTime.MinValue;
        var nextCheck = DateTime.MinValue;
        while (!stop.IsCancellationRequested)
        {
            try
            {
                var now = DateTime.UtcNow;
                if (discover || now >= nextDiscovery) { Discover(); discover = false; nextDiscovery = now.AddSeconds(30); }
                if (Interlocked.Exchange(ref wake, 0) != 0 || now >= nextCheck)
                {
                    foreach (var file in files.Values) Read(file);
                    nextCheck = now.AddSeconds(2.5);
                    Emit();
                }
            }
            catch (Exception ex) { Diagnostics.Log("session-monitor", ex.Message); }
            try { await Task.Delay(200, stop.Token).ConfigureAwait(false); } catch (OperationCanceledException) { break; }
        }
    }
    void Discover()
    {
        if (!Directory.Exists(root)) return;
        var recent = Directory.EnumerateFiles(root, "rollout-*.jsonl", SearchOption.AllDirectories)
            .Select(p => new FileInfo(p)).OrderByDescending(f => f.LastWriteTimeUtc).Take(24).ToArray();
        var keep = recent.Select(f => f.FullName).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var p in files.Keys.Where(p => !keep.Contains(p) && files[p].TurnId.Length == 0).ToArray()) files.Remove(p);
        foreach (var file in recent)
        {
            if (files.ContainsKey(file.FullName)) continue;
            var match = Regex.Match(file.Name, @"([0-9a-f-]{36})\.jsonl$", RegexOptions.IgnoreCase);
            files[file.FullName] = new() { Path = file.FullName, SessionId = match.Success ? match.Groups[1].Value : file.Name };
        }
        Interlocked.Exchange(ref wake, 1);
    }
    void Read(FileState state)
    {
        try
        {
            var info = new FileInfo(state.Path);
            state.WriteTime = info.LastWriteTimeUtc;
            if (info.Length == state.Offset) return;
            if (info.Length < state.Offset) { state.Offset = 0; state.TurnId = ""; state.Partial = ""; }
            bool tail = state.Offset == 0 && info.Length > 2 * 1024 * 1024;
            if (tail) state.Offset = info.Length - 2 * 1024 * 1024;
            using var stream = new FileStream(state.Path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            stream.Position = state.Offset;
            using var reader = new StreamReader(stream, new UTF8Encoding(false), false, 65536);
            var text = state.Partial + reader.ReadToEnd();
            state.Offset = stream.Position;
            if (tail) { var n = text.IndexOf('\n'); text = n >= 0 ? text[(n + 1)..] : ""; }
            var lines = text.Split('\n');
            state.Partial = lines[^1];
            foreach (var line in lines.Take(lines.Length - 1)) ApplyLine(state, line);
            if(tail && !state.SawLifecycle)
            {
                // A long agent turn may write far more than 2 MB. Recover its latest
                // lifecycle marker instead of silently treating a truncated tail as idle.
                var prompt=state.Prompt; RecoverLifecycle(state,stream); if(prompt.Length>0)state.Prompt=prompt;
            }
        }
        catch (IOException) { }
    }
    static void ApplyLine(FileState state, string line)
    {
        if (!line.Contains("\"event_msg\"", StringComparison.Ordinal)) return;
        try
        {
            var record = JsonNode.Parse(line);
            if (record.Text("type") != "event_msg") return;
            var p = record?["payload"];
            switch (p.Text("type"))
            {
                case "task_started": state.SawLifecycle=true; state.TurnId = p.Text("turn_id", state.SessionId); state.Prompt = ""; break;
                case "user_message": state.Prompt = p.Text("message"); if (state.Prompt.Length > 520) state.Prompt = state.Prompt[..520]; break;
                case "task_complete": case "turn_aborted": case "turn_cancelled": case "turn_canceled": case "task_cancelled": case "task_canceled":
                    state.SawLifecycle=true;
                    if (p.Text("turn_id") is "" || p.Text("turn_id") == state.TurnId) state.TurnId = "";
                    break;
                case "token_count":
                    var limits = p?["rate_limits"];
                    var windows = new List<QuotaWindow>();
                    foreach (var id in new[] { "primary", "secondary" })
                    {
                        var w = limits?[id];
                        if (w?["used_percent"] == null) continue;
                        var used = Math.Clamp(w.Number("used_percent"), 0, 100);
                        windows.Add(new(id, used, 100 - used, w?["window_minutes"] == null ? null : w.Number("window_minutes"), w?["resets_at"] == null ? null : w.Number("resets_at")));
                    }
                    if (windows.Count > 0) state.Usage = new("codex", "Codex", true, windows.ToArray(), record.Text("timestamp", Json.Now));
                    break;
            }
        }
        catch (System.Text.Json.JsonException) { }
    }
    static void RecoverLifecycle(FileState state,FileStream stream)
    {
        long end=Math.Max(0,state.Offset-2*1024*1024); long budget=64*1024*1024;
        while(end>0 && budget>0)
        {
            long begin=Math.Max(0,end-2*1024*1024);stream.Position=begin;
            var bytes=new byte[end-begin];stream.ReadExactly(bytes);var text=Encoding.UTF8.GetString(bytes);var lines=text.Split('\n');
            for(int i=lines.Length-2;i>0;i--)
            {
                var line=lines[i];
                if(!line.Contains("\"event_msg\"",StringComparison.Ordinal))continue;
                if(state.Prompt.Length==0 && line.Contains("\"user_message\"",StringComparison.Ordinal))ApplyLine(state,line);
                if(!line.Contains("\"task_started\"",StringComparison.Ordinal)&&!line.Contains("\"task_complete\"",StringComparison.Ordinal)&&!line.Contains("\"turn_aborted\"",StringComparison.Ordinal)&&!line.Contains("\"turn_cancel",StringComparison.Ordinal))continue;
                var prompt=state.Prompt;ApplyLine(state,line);if(prompt.Length>0)state.Prompt=prompt;if(state.SawLifecycle)return;
            }
            end=begin+1024;budget-=2*1024*1024;
            if(begin==0)break;
        }
    }
    void Emit()
    {
        var active = files.Values.Where(f => f.TurnId.Length > 0 && f.WriteTime > DateTime.UtcNow.AddHours(-2)).OrderByDescending(f => f.WriteTime).ToArray();
        var current = active.FirstOrDefault();
        var state = current == null ? new TaskState("idle", "空闲", "Codex 当前空闲", "当前没有活动任务") : new TaskState("working", "工作中", $"Codex 正在处理 {active.Length} 个任务", current.Prompt, current.TurnId, current.SessionId, active.Length);
        var usage = files.Values.Select(f => f.Usage).Where(u => u != null).OrderByDescending(u => u!.UpdatedAt).FirstOrDefault();
        var next = Json.Write(new { state, usage });
        if (signature == next) return;
        signature = next;
        Changed?.Invoke(state, usage);
    }
    public void Dispose() { stop.Cancel(); watcher?.Dispose(); stop.Dispose(); }
}
