using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

namespace AgentIsland;

// Marketing captures use the real WPF visual tree with synthetic fixtures only.
// No desktop capture, session scanning, clipboard access, notifications or HTTP listener.
sealed partial class IslandWindow
{
    readonly bool showcase;
    const int ShowcaseWidth=1200, ShowcaseHeight=720, ShowcaseFps=12;

    async Task RunShowcase()
    {
        try
        {
            if(!diagnostic || backend.Api.Port!=0 || backend.Settings.ClipboardHistory || backend.Settings.CaptureWindowsNotifications)
                throw new InvalidOperationException("Showcase must run with isolated, offline diagnostics.");
            var framesPath=Path.Combine(Diagnostics.OutputPath,"frames");
            Directory.CreateDirectory(framesPath);
            backend.Publish(new JsonObject{["source"]="codex",["type"]="working",["title"]="整理测试用例",["message"]="演示任务 · 检查组件与测试",["silent"]=true});
            backend.Publish(new JsonObject{["source"]="claude",["type"]="success",["title"]="更新说明已生成",["message"]="演示提醒 · 返回应用查看结果",["silent"]=true});
            backend.Todos.Create("检查组件测试");
            backend.Todos.Create("整理发布说明");
            UpdateData();SwitchPage(0,false);ChangeMode("compact",false);
            int frame=0;
            async Task Scene(string titleZh,string titleEn,string subtitleZh,string subtitleEn,double duration,Action action,string? screenshot=null)
            {
                action();UpdateData();
                var frameCount=(int)Math.Round(duration*ShowcaseFps);
                for(int index=0;index<frameCount;index++)
                {
                    await Task.Delay(1000/ShowcaseFps);
                    await Dispatcher.InvokeAsync(()=>{},DispatcherPriority.Render);
                    RenderShowcase(titleZh,titleEn,subtitleZh,subtitleEn,Path.Combine(framesPath,$"frame-{frame++:0000}.png"));
                    if(screenshot!=null && index==Math.Min(frameCount-1,ShowcaseFps))
                        RenderShowcase(titleZh,titleEn,subtitleZh,subtitleEn,Path.Combine(Diagnostics.OutputPath,screenshot+".png"));
                }
            }
            await Scene("让 AI 工作状态一直看得见", "Your AI work, always in sight.",
                "Windows 灵动岛，悬停即可展开。", "A compact Dynamic Island for Windows. Hover to see more.",2,()=>{},"compact");
            await Scene("额度还剩多少，一眼就知道", "Know your limits before you hit them.",
                "同时查看 Codex 的 5 小时与每周剩余额度。", "Codex 5-hour and weekly quota windows, together in one glance.",3,()=>ChangeMode("hover"),"quota");
            await Scene("看见正在运行的任务，也看见需要你处理的事", "See what is running. Know what needs you.",
                "工作状态与近期 Agent 事件，集中在一个原生面板。", "Work status and recent agent events in one native panel.",3,()=>ChangeMode("workspace"),"work");
            Decision? decision=null;bool decisionCardRendered=false;
            await Scene("在灵动岛上处理 Claude Code 授权", "Approve a Claude Code request from the island.",
                "需配置 Claude Code 权限 Hook；图中请求为模拟数据。", "Requires the Claude Code permission hook. This request is simulated.",3,()=>
            {
                decision=backend.Ask(new JsonObject{["source"]="claude",["title"]="运行组件测试需要授权",["message"]="演示请求 · npm test",["silent"]=true});
                ChangeMode("workspace");
            },"decision");
            await Scene("你的选择会返回 Agent", "Your choice goes back to the agent.",
                "演示通过界面的实际“允许”按钮回答模拟请求。", "The demo answers the simulated request through the real Allow button.",1,()=>
            {
                if(decision==null || !rows[0].TryGetValue(decision.Id,out var element) || element is not Border {Child:StackPanel card})
                    throw new InvalidOperationException("Demo decision card was not rendered.");
                var buttons=card.Children.OfType<StackPanel>().SelectMany(p=>p.Children.OfType<Button>()).ToArray();
                var allow=buttons.SingleOrDefault(b=>b.Content?.ToString()=="允许");
                decisionCardRendered=allow!=null && buttons.Any(b=>b.Content?.ToString()=="拒绝");
                if(!decisionCardRendered)throw new InvalidOperationException("Demo decision buttons were not rendered.");
                allow!.RaiseEvent(new RoutedEventArgs(ButtonBase.ClickEvent));
                if(decision.Status!="answered" || decision.Choice!="allow")throw new InvalidOperationException("Demo UI response did not reach the decision handler.");
            });
            await Scene("顺手的小任务，就放在手边", "Keep small tasks close.",
                "内置待办和单任务计时器，不用再开一个窗口。", "Built-in todos and a single-task timer. No extra window to manage.",2,()=>SwitchPage(1),"todos");
            await Scene("不需要时收起，需要时展开", "Small when you do not need it.",
                "保持小巧，等需要处理任务时再展开。", "Expand when it is time to act.",1,()=>ChangeMode("compact"));
            Json.AtomicWrite(Path.Combine(Diagnostics.OutputPath,"showcase-manifest.json"),new
            {
                syntheticData=true,desktopCaptured=false,sessionMonitoring=false,clipboardRead=false,
                windowsNotificationsRead=false,httpListenerStarted=backend.Api.Port!=0,
                decisionCardRendered,decisionAnswered=decision?.Status=="answered",frameCount=frame,fps=ShowcaseFps,
                width=ShowcaseWidth,height=ShowcaseHeight,durationSeconds=(double)frame/ShowcaseFps,
                bilingualCaptions=true,captionLanguages=new[]{"zh-CN","en"},uiLanguage="zh-CN"
            });
        }
        catch(Exception ex){Diagnostics.Log("showcase",ex.ToString());Environment.ExitCode=1;}
        finally{Close();}
    }

    void RenderShowcase(string titleZh,string titleEn,string subtitleZh,string subtitleEn,string output)
    {
        UpdateLayout();
        var drawing=new DrawingVisual();
        using(var context=drawing.RenderOpen())
        {
            context.DrawRectangle(IslandMotion.Gradient("#172338","#070B12",115),null,new Rect(0,0,ShowcaseWidth,ShowcaseHeight));
            context.DrawRoundedRectangle(Brush("#203147"),null,new Rect(52,36,5,23),2,2);
            Label("Agent Island · 灵动岛",24,"#F3F6FC",new(71,30),true);
            Label("WINDOWS · 本地优先 / LOCAL-FIRST",12,"#95A6BF",new(891,38));
            Label(titleZh,29,"#F3F6FC",new(52,86),true);
            Label(titleEn,24,"#CCD8ED",new(52,131),true);
            Label(subtitleZh,16,"#A6B6CE",new(52,176));
            Label(subtitleEn,15,"#A6B6CE",new(52,205));
            context.PushTransform(new TranslateTransform((ShowcaseWidth-CanvasWidth*1.13)/2,252));
            context.PushTransform(new ScaleTransform(1.13,1.13));
            var visual=new VisualBrush(canvas){ViewboxUnits=BrushMappingMode.Absolute,Viewbox=new Rect(0,0,CanvasWidth,CanvasHeight),Stretch=Stretch.Fill};
            context.DrawRectangle(visual,null,new Rect(0,0,CanvasWidth,CanvasHeight));
            context.Pop();context.Pop();
            Label("真实中文界面 · 模拟任务与额度 / Actual Chinese UI · Simulated tasks & quotas",12,"#95A6BF",new(52,624));
            context.DrawLine(new Pen(Brush("#24344A"),1),new(52,651),new(1148,651));
            Label("工作 Work · 待办 Todos · 剪贴板 Clipboard · 允许 Allow · 拒绝 Deny",12,"#95A6BF",new(52,676));
            Label("github.com/Earr22/agent-island",12,"#95A6BF",new(919,676));
            void Label(string text,double size,string color,Point point,bool bold=false)
            {
                var font=new Typeface(new FontFamily("Segoe UI, Microsoft YaHei UI"),FontStyles.Normal,bold?FontWeights.SemiBold:FontWeights.Normal,FontStretches.Normal);
                var formatted=new FormattedText(text,CultureInfo.InvariantCulture,FlowDirection.LeftToRight,font,size,Brush(color),1);
                if(formatted.WidthIncludingTrailingWhitespace>ShowcaseWidth-52-point.X)
                    throw new InvalidOperationException("Showcase caption exceeds its layout bounds.");
                context.DrawText(formatted,point);
            }
        }
        var bitmap=new RenderTargetBitmap(ShowcaseWidth,ShowcaseHeight,96,96,PixelFormats.Pbgra32);bitmap.Render(drawing);
        var encoder=new PngBitmapEncoder();encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var stream=File.Create(output);encoder.Save(stream);
    }
}
