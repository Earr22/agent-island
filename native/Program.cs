using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Windows;

namespace AgentIsland;

static class Diagnostics
{
    public static string OutputPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"AgentIslandNative","diagnostics");
    static readonly object gate=new();
    public static void Log(string area,string message) { try { lock(gate){Directory.CreateDirectory(OutputPath);File.AppendAllText(Path.Combine(OutputPath,"native.log"),$"{Json.Now} [{area}] {message}\n");} } catch { } }
}
static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        bool diagnostic=args.Contains("--diagnose");
        var output=args.FirstOrDefault(a=>a.StartsWith("--output="));if(output!=null)Diagnostics.OutputPath=Path.GetFullPath(output[9..]);
        if(args.Contains("--self-test")) { try{SelfTest.Run().GetAwaiter().GetResult();return 0;}catch(Exception e){Diagnostics.Log("self-test",e.ToString());return 1;} }
        using var mutex=new Mutex(true,diagnostic?"AgentIsland.Native.Diagnostics":"AgentIsland.Native",out var owns);
        if(!owns)return 0;
        var data=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),"agent-island");
        Settings settings;
        if(diagnostic){data=Path.Combine(Diagnostics.OutputPath,"test-data");settings=new(){Port=0,AutoHide=false,CaptureWindowsNotifications=false,ClipboardHistory=false,Placement=new()};}
        else {try{settings=Json.Read<Settings>(File.ReadAllText(Path.Combine(data,"settings.json")))??new();}catch{settings=new();}}
        try
        {
            var app=new Application{ShutdownMode=ShutdownMode.OnMainWindowClose};
            if(!diagnostic && !settings.PrivacyNoticeSeen)
            {
                var choice=MessageBox.Show("灵动岛可在内存中保留最近 30 条剪贴板文字或图片，退出即清空。\n是否启用剪贴板历史？可随时从托盘关闭并清空。","Agent Island · 剪贴板隐私",MessageBoxButton.YesNo,MessageBoxImage.Information,MessageBoxResult.No);
                settings.ClipboardHistory=choice==MessageBoxResult.Yes;settings.PrivacyNoticeSeen=true;
                Json.AtomicWrite(Path.Combine(data,"settings.json"),settings);
            }
            app.DispatcherUnhandledException+=(_,e)=>{Diagnostics.Log("ui",e.Exception.ToString());};
            var backend=new Backend(data,settings);backend.Start(diagnostic);
            var window=new IslandWindow(backend,diagnostic);app.Run(window);return 0;
        }
        catch(Exception ex){Diagnostics.Log("startup",ex.ToString());if(!diagnostic)MessageBox.Show("原生版未能启动，旧版和数据未修改。\n"+ex.Message,"Agent Island");return 1;}
    }
}
