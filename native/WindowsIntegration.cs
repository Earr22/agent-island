using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media.Imaging;

namespace AgentIsland;

static class Win32
{
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll")] public static extern bool AddClipboardFormatListener(IntPtr window);
    [DllImport("user32.dll")] public static extern bool RemoveClipboardFormatListener(IntPtr window);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr window, int index, int value);
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
    public static bool Activate(Target target)
    {
        if (!string.IsNullOrWhiteSpace(target.Url)) { Process.Start(new ProcessStartInfo(target.Url) { UseShellExecute = true }); return true; }
        var processes=Process.GetProcesses();
        try
        {
            foreach (var p in processes.OrderByDescending(p => target.ProcessIds?.Contains(p.Id) ?? false))
            {
                try
                {
                    if (!(target.ProcessIds?.Contains(p.Id) ?? false) && !target.ProcessNames.Contains(p.ProcessName, StringComparer.OrdinalIgnoreCase)) continue;
                    p.Refresh(); var h = p.MainWindowHandle; if (h == IntPtr.Zero) continue;
                    ShowWindowAsync(h, 9);
                    var fg = GetWindowThreadProcessId(GetForegroundWindow(), out _); var self = GetCurrentThreadId();
                    if (fg != self && fg > 0) AttachThreadInput(self, fg, true);
                    try { SetForegroundWindow(h); } finally { if (fg != self && fg > 0) AttachThreadInput(self, fg, false); }
                    if (GetForegroundWindow() == h) return true;
                }
                catch { }
            }
        }
        finally { foreach(var process in processes) process.Dispose(); }
        if (!string.IsNullOrWhiteSpace(target.AppUserModelId)) { Process.Start(new ProcessStartInfo("explorer.exe") { Arguments = "shell:AppsFolder\\" + target.AppUserModelId, UseShellExecute = true }); return true; }
        return false;
    }
}

sealed class ClipboardEntry
{
    public required string Id { get; init; }
    public required string Text { get; init; }
    public BitmapSource? Image { get; init; }
    public DateTime CreatedAt { get; init; } = DateTime.Now;
}
sealed class ClipboardHistory
{
    readonly List<ClipboardEntry> entries = new();
    uint sequence;
    int generation;
    public event Action? Changed;
    public IReadOnlyList<ClipboardEntry> Items => entries;
    public void Capture()
    {
        var next = Win32.GetClipboardSequenceNumber(); if (next == sequence) return; sequence = next;
        try
        {
            ClipboardEntry? entry = null;
            if (System.Windows.Clipboard.ContainsImage())
            {
                var img = System.Windows.Clipboard.GetImage();
                if (img != null && (long)img.PixelWidth * img.PixelHeight <= 8_000_000)
                {
                    img.Freeze();
                    var version=generation;
                    var capturedAt=DateTime.Now;
                    _=System.Threading.Tasks.Task.Run(()=>
                    {
                        var bytes = new byte[img.PixelHeight * img.PixelWidth * ((img.Format.BitsPerPixel + 7) / 8)];
                        img.CopyPixels(bytes, img.PixelWidth * ((img.Format.BitsPerPixel + 7) / 8), 0);
                        var imageEntry=new ClipboardEntry { Id = Convert.ToHexString(SHA256.HashData(bytes)), Text = $"图片 · {img.PixelWidth} × {img.PixelHeight}", Image = img, CreatedAt=capturedAt };
                        Application.Current.Dispatcher.BeginInvoke(()=> { if(version==generation) Add(imageEntry); });
                    });
                    return;
                }
            }
            else if (System.Windows.Clipboard.ContainsText())
            {
                var text = System.Windows.Clipboard.GetText();
                if (text.Length > 0 && text.Length <= 100_000) entry = new() { Id = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text))), Text = text };
            }
            if (entry == null) return;
            Add(entry);
        }
        catch (COMException) { sequence=0; }
    }
    void Add(ClipboardEntry entry)
    {
            entries.RemoveAll(e => e.Id == entry.Id); entries.Insert(0, entry);
            entries.Sort((a,b)=>b.CreatedAt.CompareTo(a.CreatedAt));
            // Bound image memory as well as item count: a clipboard manager must not grow indefinitely.
            long budget = 0; int keep = 0;
            foreach (var e in entries) { budget += e.Image == null ? e.Text.Length * 2L : e.Image.PixelWidth * e.Image.PixelHeight * 4L; if (keep > 0 && budget > 32 * 1024 * 1024) break; keep++; if (keep >= 30) break; }
            if (entries.Count > keep) entries.RemoveRange(keep, entries.Count - keep);
            Changed?.Invoke();
    }
    public bool Restore(ClipboardEntry entry)
    {
        try { if (entry.Image != null) System.Windows.Clipboard.SetImage(entry.Image); else System.Windows.Clipboard.SetText(entry.Text); sequence = Win32.GetClipboardSequenceNumber(); return true; }
        catch (COMException) { return false; }
    }
    public void Delete(string id) { entries.RemoveAll(e => e.Id == id); Changed?.Invoke(); }
    public void Clear() { generation++; entries.Clear(); Changed?.Invoke(); }
}
