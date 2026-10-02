using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace AgentIsland;

static class Json
{
    internal static readonly JsonSerializerOptions Options = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true, PropertyNameCaseInsensitive = true };
    public static string Write(object? value) => JsonSerializer.Serialize(value, Options);
    public static T? Read<T>(string value) => JsonSerializer.Deserialize<T>(value, Options);
    public static string Text(this JsonNode? node, string key, string fallback = "") => node?[key]?.ToString() ?? fallback;
    public static double Number(this JsonNode? node, string key, double fallback = 0) => double.TryParse(node.Text(key), out var n) ? n : fallback;
    public static bool Bool(this JsonNode? node, string key, bool fallback = false) => bool.TryParse(node.Text(key), out var b) ? b : fallback;
    public static string Now => DateTimeOffset.UtcNow.ToString("o");
    public static void AtomicWrite(string path, object value)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temp = path + ".native.tmp";
        File.WriteAllText(temp, Write(value));
        File.Move(temp, path, true);
    }
}

sealed class Placement
{
    public string Mode { get; set; } = "top";
    public double Ratio { get; set; } = .5;
    public double? X { get; set; }
    public double? Y { get; set; }
    public string? DisplayId { get; set; }
}

sealed class Settings
{
    public bool CaptureWindowsNotifications { get; set; }
    public bool DismissCapturedNotifications { get; set; }
    public bool ClipboardHistory { get; set; } = true;
    public bool PrivacyNoticeSeen { get; set; }
    public bool AutoHide { get; set; } = true;
    public bool StartWithWindows { get; set; }
    public int Port { get; set; } = 17321;
    public int EdgeOffset { get; set; } = 4;
    public Placement Placement { get; set; } = new();
    // Preserve legacy fields when saving settings shared with the rollback build.
    [System.Text.Json.Serialization.JsonExtensionData]
    public Dictionary<string, JsonElement>? Extra { get; set; }
}

sealed record QuotaWindow(string Id, double UsedPercent, double RemainingPercent, double? WindowMinutes, double? ResetsAt);
sealed record Usage(string AgentId, string Label, bool Available, QuotaWindow[] Windows, string UpdatedAt)
{
    public double? UsedPercent => Windows.FirstOrDefault()?.UsedPercent;
    public double? RemainingPercent => Windows.FirstOrDefault()?.RemainingPercent;
    public string Source => "codex-session-log";
}

sealed record TaskState(string Status, string Label, string Title, string Message, string TaskId = "", string SessionId = "", int ActiveCount = 0);
sealed record Agent(string Id, string Label, string Glyph, int[] ProcessIds, string[] FocusProcessNames, TaskState TaskState)
{
    public int ProcessCount => ProcessIds.Length;
}
sealed record Target(string[] ProcessNames, int[]? ProcessIds = null, string? AppUserModelId = null, string? Url = null);
sealed record WorkItem(string Id, string Title, string Subtitle, string Status, string Glyph, Target? Target, string? EventId = null);

sealed class IslandEvent
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Source { get; set; } = "generic";
    public string SourceLabel { get; set; } = "Agent";
    public string SourceGlyph { get; set; } = "AI";
    public string Type { get; set; } = "notification";
    public string Title { get; set; } = "Agent 通知";
    public string Message { get; set; } = "";
    public string Detail { get; set; } = "";
    public string TaskId { get; set; } = "";
    public bool Silent { get; set; }
    public string Timestamp { get; set; } = Json.Now;
    public List<Choice> Actions { get; set; } = new();
    public JsonObject Context { get; set; } = new();
}
sealed record Choice(string Id, string Label, string Style = "secondary");
sealed class Decision
{
    public string Id => Event.Id;
    public required IslandEvent Event { get; init; }
    public string Status { get; set; } = "pending";
    public string? Choice { get; set; }
    public string? Label { get; set; }
    public string CreatedAt => Event.Timestamp;
    public string? RespondedAt { get; set; }
    [System.Text.Json.Serialization.JsonIgnore]
    public System.Threading.Tasks.TaskCompletionSource<Decision> Completion { get; } = new(System.Threading.Tasks.TaskCreationOptions.RunContinuationsAsynchronously);
}

sealed class Todo
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Title { get; set; } = "";
    public bool Completed { get; set; }
    public string CreatedAt { get; set; } = Json.Now;
    public string UpdatedAt { get; set; } = Json.Now;
    public double ElapsedMs { get; set; }
    public string? TimerStartedAt { get; set; }
    [System.Text.Json.Serialization.JsonIgnore]
    public double CurrentElapsed => ElapsedMs + (DateTimeOffset.TryParse(TimerStartedAt, out var start) ? Math.Max(0, (DateTimeOffset.UtcNow - start).TotalMilliseconds) : 0);
    public void Pause() { ElapsedMs = CurrentElapsed; TimerStartedAt = null; }
    public static string Duration(double ms) { var t = TimeSpan.FromMilliseconds(Math.Max(0, ms)); return t.TotalHours >= 1 ? $"{(int)t.TotalHours:00}:{t.Minutes:00}:{t.Seconds:00}" : $"{t.Minutes:00}:{t.Seconds:00}"; }
}
sealed class TodoDocument { public int Version { get; set; } = 1; public List<Todo> Items { get; set; } = new(); }

sealed class TodoStore
{
    readonly string path;
    readonly object gate = new();
    readonly TodoDocument document;
    public event Action? Changed;
    public TodoStore(string path)
    {
        this.path = path;
        try { document = Json.Read<TodoDocument>(File.ReadAllText(path)) ?? new(); }
        catch { document = new(); }
    }
    public Todo[] Items { get { lock (gate) return document.Items.OrderBy(x => x.Completed).ThenByDescending(x => x.UpdatedAt).ToArray(); } }
    public void Create(string title)
    {
        title = Regex.Replace(title, @"\s+", " ").Trim();
        if (title.Length == 0) return;
        lock (gate) { if (document.Items.Count >= 200) return; document.Items.Add(new() { Title = title[..Math.Min(160, title.Length)] }); Save(); }
        Changed?.Invoke();
    }
    public void Edit(string id, string action)
    {
        lock (gate)
        {
            var item = document.Items.Find(t => t.Id == id);
            if (item == null) return;
            switch (action)
            {
                case "complete": item.Completed = !item.Completed; if (item.Completed) item.Pause(); break;
                case "timer":
                    if (item.Completed) return;
                    if (item.TimerStartedAt != null) item.Pause();
                    else { foreach (var t in document.Items.Where(t => t.TimerStartedAt != null)) { t.Pause(); t.UpdatedAt = Json.Now; } item.TimerStartedAt = Json.Now; }
                    break;
                case "delete": document.Items.Remove(item); break;
            }
            item.UpdatedAt = Json.Now; Save();
        }
        Changed?.Invoke();
    }
    public void ClearCompleted() { lock (gate) { document.Items.RemoveAll(t => t.Completed); Save(); } Changed?.Invoke(); }
    void Save() => Json.AtomicWrite(path, document);
}
