using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Forms = System.Windows.Forms;

namespace AgentIsland;

sealed partial class IslandWindow : Window
{
    const double CanvasWidth = 464, CanvasHeight = 360;
    readonly Backend backend;
    readonly ClipboardHistory clipboard = new();
    readonly Canvas canvas = new();
    readonly Border shell;
    readonly Border shine=new();
    readonly IslandAtmosphere atmosphere=new();
    readonly ScaleTransform shellScale = new(1, 1);
    readonly Grid compact = new(), hover = new(), workspace = new();
    readonly TextBlock compactLabel, hoverLabel, hoverUsage, workspaceUsage, timerLabel, compactTimer, statusText;
    readonly PixelCompanion pet=new(),hoverPet=new();
    readonly StackPanel compactAgents=new(){Orientation=Orientation.Horizontal};
    readonly TextBlock hoverClock=Text("",10,"#8992A4");
    readonly QuotaBadge hoverQuota,workspaceQuota;
    readonly Border tabIndicator=new();
    readonly TranslateTransform tabSlide=new();
    readonly TextBlock workCount=Text("0",8,"#818A9D");
    readonly Grid[] pages = new Grid[3];
    readonly ScrollViewer[] scrolls = new ScrollViewer[3];
    readonly StackPanel[] lists = new StackPanel[3];
    readonly Button[] tabs = new Button[3];
    readonly Dictionary<string, FrameworkElement>[] rows = { new(), new(), new() };
    readonly Dictionary<string, string> signatures = new();
    readonly DispatcherTimer proximity = new(), seconds = new();
    readonly Forms.NotifyIcon tray;
    readonly Stopwatch lastInside = Stopwatch.StartNew();
    readonly bool diagnostic;
    readonly Queue<double> frames = new();
    long previousFrame;
    bool collectingFrames;
    bool visualEffects=true;
    DateTime visualPulseUntil;
    Rect targetRect;
    string mode = "compact";
    int page;
    bool updateQueued, dragging, outsidePressed, preparing;
    Point? dragStart;
    Point dragWindowStart;
    UIElement? dragCapture;
    readonly Border dragGrip = new();
    string? snapEdge;
    IslandEvent? notice;
    DateTime noticeUntil;
    Border? snapPrompt;
    Popup? snapPopup;
    Rect snapPromptScreenRect;
    HwndSource? source;
    IntPtr hwnd;
    const double WorkspaceWidth=432,WorkspaceHeight=300,HoverWidth=386,HoverHeight=64;
    public string Mode => mode;
    public int Page => page;
    public Rect VisibleRect => targetRect;
    public IslandWindow(Backend backend, bool diagnostic, bool showcase = false)
    {
        this.backend = backend; this.diagnostic = diagnostic;
        this.showcase = showcase;
        if(showcase) Opacity=0; // Render our visual tree only, never the user's desktop.
        Width = CanvasWidth; Height = CanvasHeight; WindowStyle = WindowStyle.None;
        AllowsTransparency = true; Background = Brushes.Transparent; ResizeMode = ResizeMode.NoResize;
        ShowInTaskbar = Diagnostics.ManualUi; Topmost = true; ShowActivated = Diagnostics.ManualUi;
        Title = Diagnostics.ManualUi?"Agent Island · Drag UI Test":"Agent Island Native"; Content = canvas;
        FontFamily = new("Microsoft YaHei UI, Segoe UI"); FontSize = 12; Foreground = Brush("#F4F6FB");
        UseLayoutRounding=true;SnapsToDevicePixels=true;TextOptions.SetTextFormattingMode(this,TextFormattingMode.Display);
        TextOptions.SetTextRenderingMode(this,TextRenderingMode.Grayscale);
        Resources.Add("IslandScrollbar",SlimScrollbar());
        shell = new Border { Background = IslandMotion.Gradient("#101216","#07090D",155), BorderBrush = Brush("#292C34"), BorderThickness = new(1), CornerRadius = new(22), RenderTransform = shellScale };
        var sheen=new Grid{IsHitTestVisible=false};sheen.Children.Add(atmosphere);shine.Height=1;shine.VerticalAlignment=VerticalAlignment.Top;shine.Margin=new(48,0,48,0);shine.Background=new LinearGradientBrush(new GradientStopCollection{new(Colors.Transparent,0),new(Color.FromArgb(150,175,193,228),.5),new(Colors.Transparent,1)},new Point(0,0),new Point(1,0));shine.Opacity=.3;sheen.Children.Add(shine);shell.Child=sheen;
        canvas.Children.Add(shell);
        compactLabel = Text("连接中", 11, bold: true); compactTimer = Text("", 11, "#92E5C8");
        var compactLine = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center };
        compactLine.Children.Add(pet); compactLabel.Margin = new(7,0,0,0); compactLine.Children.Add(compactLabel);compactAgents.Margin=new(10,0,0,0);compactLine.Children.Add(compactAgents); compactTimer.Margin = new(7,0,0,0); compactLine.Children.Add(compactTimer); compact.Children.Add(compactLine);
        hoverLabel = Text("Agent Island", 12, bold: true); hoverUsage = Text("等待同步", 12, "#D2DBED"); timerLabel = Text("点击查看工作列表", 10, "#A5AFC2");
        hoverQuota=new(hoverUsage);workspaceUsage=Text("等待同步",8.5,"#D2DBED");workspaceQuota=new(workspaceUsage,true);
        var hv=new Grid{Margin=new(16,0,16,0)};
        hv.ColumnDefinitions.Add(new(){Width=new(28)});hv.ColumnDefinitions.Add(new(){Width=new(1,GridUnitType.Star)});hv.ColumnDefinitions.Add(new(){Width=new(142)});
        hoverPet.VerticalAlignment=VerticalAlignment.Center;hv.Children.Add(hoverPet);
        var copy=new StackPanel{VerticalAlignment=VerticalAlignment.Center,Margin=new(7,0,7,0)};copy.Children.Add(hoverLabel);timerLabel.Margin=new(0,3,0,0);copy.Children.Add(timerLabel);Grid.SetColumn(copy,1);hv.Children.Add(copy);
        hoverQuota.HorizontalAlignment=HorizontalAlignment.Right;hoverQuota.VerticalAlignment=VerticalAlignment.Center;Grid.SetColumn(hoverQuota,2);hv.Children.Add(hoverQuota);
        hover.Children.Add(hv);
        compact.Cursor = Cursors.Hand; hover.Cursor = Cursors.Hand;
        compact.Background=hover.Background=Brushes.Transparent;
        foreach(var surface in new UIElement[]{compact,hover,dragGrip})
        {
            surface.MouseLeftButtonDown+=BeginDrag;
            surface.MouseMove+=ContinueDrag;
            surface.MouseLeftButtonUp+=EndDrag;
            surface.LostMouseCapture+=(_,_)=>CancelDrag();
        }
        compact.MouseEnter += (_,_) => { if(!dragging) ChangeMode("hover"); };
        hover.MouseEnter += (_,_) => lastInside.Restart();
        BuildWorkspace();
        foreach (var view in new[] { compact, hover, workspace }) { view.Opacity = 0; view.IsHitTestVisible = false; canvas.Children.Add(view); }
        statusText = Text("", 10, "#949CAA"); statusText.TextAlignment = TextAlignment.Center; statusText.Margin = new(12,0,12,4); statusText.VerticalAlignment = VerticalAlignment.Bottom; Grid.SetRow(statusText,2); workspace.Children.Add(statusText);
        backend.Changed += QueueUpdate;
        backend.Published += e => Dispatcher.BeginInvoke(() =>
        {
            if(e.Silent || diagnostic) return;
            notice=e;noticeUntil=DateTime.UtcNow.AddSeconds(7);visualPulseUntil=DateTime.UtcNow.AddSeconds(2.4);Show();ChangeMode(e.Type=="decision"?"workspace":"hover");UpdatePet();hoverLabel.Text=e.SourceLabel+" · "+e.Title;timerLabel.Text=e.Message;lastInside.Restart();
        });
        clipboard.Changed += () => UpdateClipboard();
        SourceInitialized += (_,_) => InitializeNative();
        Deactivated += (_,_) => { if(mode=="workspace"&&!diagnostic&&dragStart==null&&snapPrompt==null)ChangeMode("compact"); };
        IsVisibleChanged+=(_,_)=>{if(!IsVisible&&snapPopup!=null)ResolveSnap(false);UpdatePet();};
        Loaded += (_,_) =>
        {
            PositionWindow(); UpdateData();
            // Prepare mode-dependent code and native layout before the first user input.
            preparing=true;ChangeMode("hover",false);ChangeMode("workspace",false);SwitchPage(1,false);SwitchPage(2,false);SwitchPage(0,false);ChangeMode("compact",false);preparing=false;UpdatePet();
            UpdateLayout();
            foreach(var scroller in scrolls){scroller.ApplyTemplate();if(scroller.Template.FindName("PART_VerticalScrollBar",scroller) is ScrollBar bar){bar.Style=(Style)Resources["IslandScrollbar"];bar.MinWidth=0;bar.Width=7;bar.Scroll+=(_,e)=>{if(e.ScrollEventType is ScrollEventType.ThumbTrack or ScrollEventType.ThumbPosition)scroller.ScrollToVerticalOffset(e.NewValue);};}}
            if(showcase) _=RunShowcase();
            else { StartTimers();if(diagnostic&&!Diagnostics.ManualUi)_=RunDiagnostics(); }
        };
        Closed += (_,_) => { if(snapPopup!=null)snapPopup.IsOpen=false; proximity.Stop(); seconds.Stop(); tray?.Dispose(); source?.RemoveHook(WindowMessage); Win32.RemoveClipboardFormatListener(hwnd); backend.Dispose(); CompositionTarget.Rendering -= Frame; };
        tray = new Forms.NotifyIcon { Icon = new System.Drawing.Icon(Path.Combine(AppContext.BaseDirectory, "tray-icon.ico")), Text = "Agent Island · 原生轻量版", Visible = !diagnostic };
        tray.MouseClick += (_,e) => { if(e.Button == Forms.MouseButtons.Left) Dispatcher.Invoke(() => { Show(); ChangeMode("compact"); lastInside.Restart(); }); };
        RebuildTray();
    }
    static SolidColorBrush Brush(string color) { var b = (SolidColorBrush)new BrushConverter().ConvertFromString(color)!; b.Freeze(); return b; }
    static TextBlock Text(string text, double size = 12, string color = "#F4F6FB", bool bold = false) => new() { Text = text, FontSize = Math.Round(size), Foreground = Brush(color), FontWeight = bold ? FontWeights.SemiBold : FontWeights.Normal, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center,SnapsToDevicePixels=true };
    static Style SlimScrollbar()
    {
        return (Style)System.Windows.Markup.XamlReader.Parse("""
        <Style xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" TargetType="{x:Type ScrollBar}">
          <Setter Property="MinWidth" Value="0"/><Setter Property="Width" Value="7"/><Setter Property="Background" Value="Transparent"/>
          <Setter Property="Template"><Setter.Value><ControlTemplate TargetType="{x:Type ScrollBar}">
            <Track x:Name="PART_Track" Orientation="Vertical" IsDirectionReversed="True" Minimum="{TemplateBinding Minimum}" Maximum="{TemplateBinding Maximum}" Value="{TemplateBinding Value}" ViewportSize="{TemplateBinding ViewportSize}">
              <Track.Thumb><Thumb><Thumb.Template><ControlTemplate TargetType="{x:Type Thumb}"><Border Background="#424B5A" CornerRadius="2" Margin="2,0,1,0"/></ControlTemplate></Thumb.Template></Thumb></Track.Thumb>
              <Track.DecreaseRepeatButton><RepeatButton Command="{x:Static ScrollBar.PageUpCommand}"><RepeatButton.Template><ControlTemplate TargetType="{x:Type RepeatButton}"><Border Background="Transparent"/></ControlTemplate></RepeatButton.Template></RepeatButton></Track.DecreaseRepeatButton>
              <Track.IncreaseRepeatButton><RepeatButton Command="{x:Static ScrollBar.PageDownCommand}"><RepeatButton.Template><ControlTemplate TargetType="{x:Type RepeatButton}"><Border Background="Transparent"/></ControlTemplate></RepeatButton.Template></RepeatButton></Track.IncreaseRepeatButton>
            </Track>
          </ControlTemplate></Setter.Value></Setter>
        </Style>
        """);
    }
    static Button Button(string label, Action action, double width = double.NaN,bool quiet=false)
    {
        var baseline=quiet?Brushes.Transparent:Brush("#0DFFFFFF");
        var scale=new ScaleTransform(1,1);
        var b = new Button { Content = label, Width = width, Foreground = Brush("#BBC5D6"), Background = baseline, BorderBrush = Brush("#20FFFFFF"), BorderThickness = new(quiet?0:1), Padding = new(width<=30?2:7,3,width<=30?2:7,3), FontSize = 11, Cursor = Cursors.Hand, Focusable = false,RenderTransform=scale,RenderTransformOrigin=new(.5,.5) };
        var template = new ControlTemplate(typeof(Button));
        var border = new FrameworkElementFactory(typeof(Border)); border.SetValue(Border.CornerRadiusProperty, new CornerRadius(8)); border.SetValue(Border.BackgroundProperty, new TemplateBindingExtension(Control.BackgroundProperty)); border.SetValue(Border.BorderBrushProperty, new TemplateBindingExtension(Control.BorderBrushProperty)); border.SetValue(Border.BorderThicknessProperty, new TemplateBindingExtension(Control.BorderThicknessProperty));
        var content = new FrameworkElementFactory(typeof(ContentPresenter)); content.SetValue(FrameworkElement.HorizontalAlignmentProperty, HorizontalAlignment.Center); content.SetValue(FrameworkElement.VerticalAlignmentProperty, VerticalAlignment.Center); content.SetValue(FrameworkElement.MarginProperty,new TemplateBindingExtension(Control.PaddingProperty)); border.AppendChild(content); template.VisualTree = border; b.Template = template;
        b.Click += (_,e) => { e.Handled = true; action(); }; b.MouseEnter += (_,_) => b.Background = Brush(quiet?"#08FFFFFF":"#17FFFFFF"); b.MouseLeave += (_,_) => {b.Background=baseline;scale.BeginAnimation(ScaleTransform.ScaleXProperty,IslandMotion.Settle(scale.ScaleX,1,220));scale.BeginAnimation(ScaleTransform.ScaleYProperty,IslandMotion.Settle(scale.ScaleY,1,220));};
        b.PreviewMouseLeftButtonDown+=(_,_)=>{scale.BeginAnimation(ScaleTransform.ScaleXProperty,IslandMotion.Fade(scale.ScaleX,.94,80));scale.BeginAnimation(ScaleTransform.ScaleYProperty,IslandMotion.Fade(scale.ScaleY,.94,80));};
        b.PreviewMouseLeftButtonUp+=(_,_)=>{scale.BeginAnimation(ScaleTransform.ScaleXProperty,IslandMotion.Settle(scale.ScaleX,1,260));scale.BeginAnimation(ScaleTransform.ScaleYProperty,IslandMotion.Settle(scale.ScaleY,1,260));};
        return b;
    }
    void BuildWorkspace()
    {
        NameScope.SetNameScope(workspace,new NameScope());
        workspace.Width = WorkspaceWidth; workspace.Height = WorkspaceHeight; workspace.Margin = new(0);
        workspace.RowDefinitions.Add(new() { Height = new(44) }); workspace.RowDefinitions.Add(new() { Height = new(1, GridUnitType.Star) }); workspace.RowDefinitions.Add(new() { Height = new(20) });
        var header = new Grid { Margin = new(12,10,12,6), Background = Brushes.Transparent };
        header.ColumnDefinitions.Add(new() { Width = new(29) }); header.ColumnDefinitions.Add(new() { Width = new(179) }); header.ColumnDefinitions.Add(new() { Width = new(1,GridUnitType.Star) });header.ColumnDefinitions.Add(new(){Width=new(20)});
        var back=Button("‹", () => ChangeMode("compact"), 26);back.FontSize=15;header.Children.Add(back);
        var tabGroup=new Border{CornerRadius=new(10),Background=Brush("#0D1016"),BorderBrush=Brush("#252932"),BorderThickness=new(1),Margin=new(7,0,4,0),Padding=new(3)};Grid.SetColumn(tabGroup,1);header.Children.Add(tabGroup);
        var tabCanvas=new Grid();tabIndicator.Width=50;tabIndicator.HorizontalAlignment=HorizontalAlignment.Left;tabIndicator.Background=IslandMotion.Gradient("#282C34","#1E2229",90);tabIndicator.BorderBrush=Brush("#353A44");tabIndicator.BorderThickness=new(1);tabIndicator.CornerRadius=new(7);tabIndicator.RenderTransform=tabSlide;tabCanvas.Children.Add(tabIndicator);
        var tabLine = new StackPanel { Orientation = Orientation.Horizontal };tabCanvas.Children.Add(tabLine);tabGroup.Child=tabCanvas;
        var labels = new[] { "工作", "待办", "剪贴板" };
        for(int i=0;i<3;i++) { int index=i; tabs[i] = Button(labels[i], () => SwitchPage(index),i==2?58:50,true);tabs[i].FontSize=11;tabs[i].Foreground=Brush(i==0?"#F0F3F9":"#AAB5C8");tabLine.Children.Add(tabs[i]); }
        workspaceQuota.HorizontalAlignment=HorizontalAlignment.Right;workspaceQuota.VerticalAlignment=VerticalAlignment.Center;workspaceQuota.Margin=new(0,0,7,0);Grid.SetColumn(workspaceQuota,2);header.Children.Add(workspaceQuota);
        var countChip=new Border{Width=17,Height=17,CornerRadius=new(8.5),Background=Brush("#0F1218"),BorderBrush=Brush("#292E37"),BorderThickness=new(1),Child=workCount};workCount.TextAlignment=TextAlignment.Center;Grid.SetColumn(countChip,3);header.Children.Add(countChip);
        header.PreviewMouseWheel += (_,e) => { SwitchPage((page + (e.Delta < 0 ? 1 : 2)) % 3); e.Handled = true; };
        workspace.Children.Add(header);
        dragGrip.Height=9;dragGrip.VerticalAlignment=VerticalAlignment.Top;dragGrip.Margin=new(16,0,16,0);
        dragGrip.Background=Brushes.Transparent;dragGrip.Cursor=Cursors.SizeAll;
        dragGrip.ToolTip="按住顶部拖动灵动岛";
        dragGrip.Child=new Border{Width=28,Height=2,CornerRadius=new(1),Background=Brush("#535C6C"),Opacity=.65,VerticalAlignment=VerticalAlignment.Center};
        workspace.Children.Add(dragGrip);
        var pageHost = new Grid { Margin = new(12,0,12,0), ClipToBounds = true }; Grid.SetRow(pageHost,1); workspace.Children.Add(pageHost);
        for(int i=0;i<3;i++)
        {
            pages[i] = new Grid { Opacity = i == 0 ? 1 : 0, IsHitTestVisible = i == 0, RenderTransform = new TranslateTransform(), Background = Brushes.Transparent };
            pages[i].RowDefinitions.Add(new() { Height = new(1,GridUnitType.Star) }); pages[i].RowDefinitions.Add(new() { Height = new(i == 0 ? 0 : 34) });
            lists[i] = new StackPanel();
            scrolls[i] = new ScrollViewer { Content = lists[i], VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, PanningMode = PanningMode.VerticalOnly };
            scrolls[i].Template=(ControlTemplate)System.Windows.Markup.XamlReader.Parse("""
            <ControlTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" TargetType="{x:Type ScrollViewer}">
              <Grid><Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
                <ScrollContentPresenter x:Name="PART_ScrollContentPresenter" Content="{TemplateBinding Content}" ContentTemplate="{TemplateBinding ContentTemplate}" CanContentScroll="{TemplateBinding CanContentScroll}"/>
                <ScrollBar x:Name="PART_VerticalScrollBar" Grid.Column="1" Orientation="Vertical" Style="{DynamicResource IslandScrollbar}" Minimum="0" Maximum="{TemplateBinding ScrollableHeight}" ViewportSize="{TemplateBinding ViewportHeight}" Value="{Binding VerticalOffset, RelativeSource={RelativeSource TemplatedParent}, Mode=OneWay}" Visibility="{TemplateBinding ComputedVerticalScrollBarVisibility}"/>
              </Grid>
            </ControlTemplate>
            """);
            pages[i].Children.Add(scrolls[i]); pageHost.Children.Add(pages[i]);
        }
        var todoComposer = new Grid { Margin = new(0,4,0,0) }; todoComposer.ColumnDefinitions.Add(new() { Width = new(1,GridUnitType.Star) }); todoComposer.ColumnDefinitions.Add(new() { Width = new(55) }); todoComposer.ColumnDefinitions.Add(new() { Width = new(66) });
        var input = new TextBox { Foreground = Brush("#E4E8F1"), Background = Brush("#15181D"), BorderBrush = Brush("#30353F"), Padding = new(7,4,7,4), FontSize = 11, MaxLength = 160 };
        input.CaretBrush=Brush("#D6E0F5");var inputTemplate=new ControlTemplate(typeof(TextBox));var inputFrame=new FrameworkElementFactory(typeof(Border));inputFrame.SetValue(Border.CornerRadiusProperty,new CornerRadius(8));inputFrame.SetValue(Border.BackgroundProperty,new TemplateBindingExtension(Control.BackgroundProperty));inputFrame.SetValue(Border.BorderBrushProperty,new TemplateBindingExtension(Control.BorderBrushProperty));inputFrame.SetValue(Border.BorderThicknessProperty,new Thickness(1));var inputHost=new FrameworkElementFactory(typeof(ScrollViewer),"PART_ContentHost");inputHost.SetValue(MarginProperty,new TemplateBindingExtension(Control.PaddingProperty));inputFrame.AppendChild(inputHost);inputTemplate.VisualTree=inputFrame;input.Template=inputTemplate;
        void Create() { backend.Todos.Create(input.Text); input.Clear(); }
        input.KeyDown += (_,e) => { if(e.Key == Key.Enter) Create(); };var inputBox=new Grid();inputBox.Children.Add(input);var hint=Text("添加一项待办…",9,"#687387");hint.Margin=new(8,0,0,0);hint.IsHitTestVisible=false;inputBox.Children.Add(hint);input.TextChanged+=(_,_)=>hint.Visibility=input.Text.Length==0?Visibility.Visible:Visibility.Collapsed;todoComposer.Children.Add(inputBox);
        var add = Button("添加", Create); Grid.SetColumn(add,1); add.Margin = new(5,0,0,0); todoComposer.Children.Add(add);
        var clear = Button("清已完成", () => backend.Todos.ClearCompleted()); Grid.SetColumn(clear,2); clear.Margin = new(5,0,0,0); todoComposer.Children.Add(clear); Grid.SetRow(todoComposer,1); pages[1].Children.Add(todoComposer);
        var clipboardFooter = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new(0,4,0,0) }; clipboardFooter.Children.Add(Text("历史仅保存在内存",10,"#737C8C")); var clearClip = Button("清空", () => clipboard.Clear()); clearClip.Margin = new(12,0,0,0); clipboardFooter.Children.Add(clearClip); Grid.SetRow(clipboardFooter,1); pages[2].Children.Add(clipboardFooter);
    }
    void InitializeNative()
    {
        hwnd = new WindowInteropHelper(this).Handle; source = HwndSource.FromHwnd(hwnd); source?.AddHook(WindowMessage);
        if(!Diagnostics.ManualUi){var flags = Win32.GetWindowLong(hwnd,-20); Win32.SetWindowLong(hwnd,-20,(flags | 0x80) & ~0x40000);} // tool window, not app window
        if (backend.Settings.ClipboardHistory && !diagnostic) Win32.AddClipboardFormatListener(hwnd);
    }
    IntPtr WindowMessage(IntPtr h, int message, IntPtr w, IntPtr l, ref bool handled)
    {
        if(message == 0x031D && backend.Settings.ClipboardHistory && !diagnostic)
        {
            Dispatcher.BeginInvoke(clipboard.Capture, DispatcherPriority.Background);
            _=Task.Run(async()=> { await Task.Delay(80); _=Dispatcher.BeginInvoke(clipboard.Capture,DispatcherPriority.Background); await Task.Delay(120); _=Dispatcher.BeginInvoke(clipboard.Capture,DispatcherPriority.Background); });
        }
        if(message == 0x02E0 && dragStart==null) Dispatcher.BeginInvoke(PositionWindow);
        return IntPtr.Zero;
    }
    void StartTimers()
    {
        proximity.Interval = TimeSpan.FromMilliseconds(45); proximity.Tick += (_,_) => CheckPointer(); proximity.Start();
        seconds.Interval = TimeSpan.FromSeconds(1); seconds.Tick += (_,_) => UpdateTimer(); seconds.Start();
    }
    Rect ScreenRect()
    {
        var screen = backend.Settings.Placement.Mode == "free" && backend.Settings.Placement.X != null ? Forms.Screen.FromPoint(new((int)backend.Settings.Placement.X.Value,(int)(backend.Settings.Placement.Y ?? 0))) : Forms.Screen.FromHandle(hwnd);
        var dpi = VisualTreeHelper.GetDpi(this); var b = screen.Bounds;
        return new(b.X/dpi.DpiScaleX,b.Y/dpi.DpiScaleY,b.Width/dpi.DpiScaleX,b.Height/dpi.DpiScaleY);
    }
    void PositionWindow()
    {
        var p=backend.Settings.Placement; var s=ScreenRect(); var ratio=Math.Clamp(p.Ratio,.04,.96);
        double x=s.Left+s.Width*ratio-CanvasWidth/2, y=s.Top;
        switch(p.Mode)
        {
            case "bottom": y=s.Bottom-CanvasHeight; break;
            case "left": x=s.Left; y=s.Top+s.Height*ratio-CanvasHeight/2; break;
            case "right": x=s.Right-CanvasWidth; y=s.Top+s.Height*ratio-CanvasHeight/2; break;
            case "free": x=p.X ?? x; y=p.Y ?? y; break;
        }
        Left=Math.Clamp(x,s.Left,Math.Max(s.Left,s.Right-CanvasWidth)); Top=Math.Clamp(y,s.Top,Math.Max(s.Top,s.Bottom-CanvasHeight));
    }
    Point LocalAnchor()
    {
        return backend.Settings.Placement.Mode switch { "bottom" => new(CanvasWidth/2,CanvasHeight-8), "left" => new(8,CanvasHeight/2), "right" => new(CanvasWidth-8,CanvasHeight/2), _ => new(CanvasWidth/2,8) };
    }
    Rect RectangleFor(double width,double height)
    {
        var anchor=LocalAnchor(); string edge=backend.Settings.Placement.Mode;
        return new(edge=="left" ? anchor.X : edge=="right" ? anchor.X-width : anchor.X-width/2, edge is "left" or "right" ? anchor.Y-height/2 : edge=="bottom" ? anchor.Y-height : anchor.Y,width,height);
    }
    public void ChangeMode(string next,bool animate=true)
    {
        if(dragStart!=null || dragging || (mode==next && shell.Width>0 && !double.IsNaN(shell.Width))) return;
        var oldMode=mode;
        var visualWidth=(double.IsNaN(shell.Width)?150:shell.Width)*shellScale.ScaleX;
        var visualHeight=(double.IsNaN(shell.Height)?40:shell.Height)*shellScale.ScaleY;
        mode=next;
        var side=backend.Settings.Placement.Mode is "left" or "right";
        var size=next switch { "workspace" => new Size(WorkspaceWidth,WorkspaceHeight), "hover" => new Size(HoverWidth,HoverHeight), "hidden" => side ? new Size(4,50) : new Size(50,4), _ => side ? new Size(44,92) : new Size(string.IsNullOrEmpty(compactTimer.Text)?174:230,40) };
        targetRect=RectangleFor(size.Width,size.Height);
        if(!diagnostic && backend.Settings.Placement.Mode=="free")
        {
            var bounds=ScreenRect();var p=backend.Settings.Placement;
            Left=Math.Clamp(p.X??Left,bounds.Left-targetRect.Left,bounds.Right-targetRect.Right); Top=Math.Clamp(p.Y??Top,bounds.Top-targetRect.Top,bounds.Bottom-targetRect.Bottom);
        }
        shell.Width=size.Width; shell.Height=size.Height; Canvas.SetLeft(shell,targetRect.X); Canvas.SetTop(shell,targetRect.Y);
        atmosphere.SetBounds(size.Width,size.Height);
        shell.CornerRadius=new(next=="hidden"?3:22); shell.RenderTransformOrigin=side ? new(backend.Settings.Placement.Mode=="left"?0:1,.5) : new(.5,backend.Settings.Placement.Mode=="bottom"?1:0);
        double startX=visualWidth/size.Width, startY=visualHeight/size.Height;
        if(animate)
        {
            var duration=next is "hover" or "workspace"?440:350;
            shellScale.BeginAnimation(ScaleTransform.ScaleXProperty,IslandMotion.Settle(startX,1,duration));
            shellScale.BeginAnimation(ScaleTransform.ScaleYProperty,IslandMotion.Settle(startY,1,duration));
            shine.BeginAnimation(OpacityProperty,IslandMotion.Fade(.8,.3,450));
        }
        else { shellScale.BeginAnimation(ScaleTransform.ScaleXProperty,null);shellScale.BeginAnimation(ScaleTransform.ScaleYProperty,null);shellScale.ScaleX=shellScale.ScaleY=1; }
        foreach(var view in new[]{compact,hover,workspace})
        {
            bool selected=next=="compact"&&view==compact || next=="hover"&&view==hover || next=="workspace"&&view==workspace;
            var viewSize=view==workspace?new Size(WorkspaceWidth,WorkspaceHeight):view==hover?new Size(HoverWidth,HoverHeight):size;
            var rect=RectangleFor(viewSize.Width,viewSize.Height); view.Width=viewSize.Width; view.Height=viewSize.Height; Canvas.SetLeft(view,rect.X); Canvas.SetTop(view,rect.Y);
            view.IsHitTestVisible=selected;
            var offset=view.RenderTransform as TranslateTransform;if(offset==null){offset=new();view.RenderTransform=offset;}
            if(animate)
            {
                view.BeginAnimation(OpacityProperty,IslandMotion.Fade(view.Opacity,selected?1:0,selected?200:85,selected?55:0));
                offset.BeginAnimation(TranslateTransform.YProperty,IslandMotion.Settle(selected?(backend.Settings.Placement.Mode=="bottom"?-5:5):offset.Y,0,360,selected?35:0));
            }
            else{offset.BeginAnimation(TranslateTransform.YProperty,null);offset.Y=0;view.BeginAnimation(OpacityProperty,null);view.Opacity=selected?1:0;}
        }
        var line=(StackPanel)compact.Children[0]; line.Orientation=side?Orientation.Vertical:Orientation.Horizontal;
        compactAgents.Visibility=side?Visibility.Collapsed:Visibility.Visible;
        compactLabel.Margin=side?new(0,8,0,0):new(7,0,0,0); compactLabel.TextAlignment=TextAlignment.Center;
        if(side) compactLabel.Text=backend.Agents.Count(a=>a.TaskState.Status=="working")+"\n任务"; else UpdateCompactLabel();
        if(next=="workspace" && !diagnostic && !preparing) { Activate(); Focus(); }
        if(next=="workspace"&&animate)
        {
            int index=0;foreach(var row in lists[page].Children.OfType<Border>().Take(6))
            {
                var offset=new TranslateTransform();row.RenderTransform=offset;
                offset.BeginAnimation(TranslateTransform.YProperty,IslandMotion.Settle(6,0,320,70+index*18));
                row.BeginAnimation(OpacityProperty,IslandMotion.Fade(.35,1,180,70+index*18));index++;
            }
        }
        UpdatePet();
        if(next=="hover"&&oldMode!="hover"&&visualEffects&&!preparing)hoverPet.Peek();
        lastInside.Restart();
    }
    void CheckPointer()
    {
        if((diagnostic&&!Diagnostics.ManualUi) || dragStart!=null || dragging || snapPrompt != null || !IsVisible || !Win32.GetCursorPos(out var p)) return;
        var dpi=VisualTreeHelper.GetDpi(this); var local=new Point(p.X/dpi.DpiScaleX-Left,p.Y/dpi.DpiScaleY-Top);
        EvaluatePointer(local,Win32.GetAsyncKeyState(1)<0);
    }
    void EvaluatePointer(Point local,bool pressed)
    {
        var inside=targetRect.Contains(local);
        if(inside) lastInside.Restart();
        if(mode=="workspace" && pressed && !outsidePressed && !inside) ChangeMode("compact");
        outsidePressed=pressed;
        if(mode=="hidden") { var near=targetRect; near.Inflate(24,20); if(near.Contains(local)) ChangeMode("hover"); }
        else if(mode=="hover" && !inside && DateTime.UtcNow>=noticeUntil && lastInside.ElapsedMilliseconds>430) ChangeMode("compact");
        else if(mode=="compact" && backend.Settings.AutoHide && !inside && lastInside.ElapsedMilliseconds>1800) ChangeMode("hidden");
        proximity.Interval=TimeSpan.FromMilliseconds(mode=="hidden"?70:45);
    }
    void BeginDrag(object sender,MouseButtonEventArgs e)
    {
        if(snapPrompt != null || dragStart!=null) return;
        var surface=(UIElement)sender;
        if(!surface.CaptureMouse())return;
        dragCapture=surface;
        ArmDrag(PointToScreen(e.GetPosition(this)));
        e.Handled=true;
    }
    void ArmDrag(Point screenPoint)
    {
        dragStart=screenPoint;dragWindowStart=new(Left,Top);dragging=false;
        // Finish in-flight morphing once, not on each mouse move.
        shellScale.BeginAnimation(ScaleTransform.ScaleXProperty,null);shellScale.BeginAnimation(ScaleTransform.ScaleYProperty,null);shellScale.ScaleX=shellScale.ScaleY=1;
        foreach(var view in new[]{compact,hover,workspace})if(view.IsHitTestVisible)
        {
            view.BeginAnimation(OpacityProperty,null);view.Opacity=1;
            if(view.RenderTransform is TranslateTransform offset){offset.BeginAnimation(TranslateTransform.YProperty,null);offset.Y=0;}
        }
    }
    void ContinueDrag(object sender,System.Windows.Input.MouseEventArgs e)
    {
        if(dragStart==null)return;
        if(e.LeftButton!=MouseButtonState.Pressed){CancelDrag();return;}
        MoveDrag(PointToScreen(e.GetPosition(this)));
        e.Handled=true;
    }
    void MoveDrag(Point screenPoint)
    {
        if(dragStart==null)return;
        var dpi=VisualTreeHelper.GetDpi(this);var physical=screenPoint-dragStart.Value;
        var delta=new Vector(physical.X/dpi.DpiScaleX,physical.Y/dpi.DpiScaleY);
        if(!dragging && Math.Abs(delta.X)<SystemParameters.MinimumHorizontalDragDistance && Math.Abs(delta.Y)<SystemParameters.MinimumVerticalDragDistance)return;
        dragging=true;
        var s=ScreenRect(); Left=Math.Clamp(dragWindowStart.X+delta.X,s.Left-targetRect.Left,s.Right-targetRect.Right); Top=Math.Clamp(dragWindowStart.Y+delta.Y,s.Top-targetRect.Top,s.Bottom-targetRect.Bottom);
    }
    void EndDrag(object sender,MouseButtonEventArgs e)
    {
        if(dragStart==null)return;
        var moved=dragging;
        // Clear state before releasing capture: LostMouseCapture is synchronous.
        dragStart=null;dragging=false;dragCapture=null;
        ((UIElement)sender).ReleaseMouseCapture();e.Handled=true;
        if(moved)FinishDrag();
        else if(sender!=dragGrip)ChangeMode("workspace");
        lastInside.Restart();
    }
    void CancelDrag()
    {
        if(dragStart==null)return;
        var moved=dragging;var capture=dragCapture;
        dragStart=null;dragging=false;dragCapture=null;capture?.ReleaseMouseCapture();
        if(moved)FinishDrag();
        lastInside.Restart();
    }
    void FinishDrag()
    {
        var s=ScreenRect(); var visible=new Rect(Left+targetRect.X,Top+targetRect.Y,targetRect.Width,targetRect.Height);
        var distances=new[]{("top",Math.Abs(visible.Top-s.Top)),("bottom",Math.Abs(s.Bottom-visible.Bottom)),("left",Math.Abs(visible.Left-s.Left)),("right",Math.Abs(s.Right-visible.Right))};
        snapEdge=distances.OrderBy(x=>x.Item2).First().Item2<=60?distances.OrderBy(x=>x.Item2).First().Item1:null;
        var p=backend.Settings.Placement;
        p.Mode="free"; p.X=Left; p.Y=Top;
        // Keep the current visual anchor stable before switching to a free placement.
        var center=visible.Left+visible.Width/2; Left=center-CanvasWidth/2; Top=visible.Top-8; p.X=Left; p.Y=Top;
        var displayMode=mode;mode=""; ChangeMode(displayMode,false); backend.SaveSettings();
        if(snapEdge!=null) ShowSnapPrompt();
    }
    void ShowSnapPrompt()
    {
        var line=new StackPanel { Orientation=Orientation.Horizontal, Margin=new(16,0,16,0), HorizontalAlignment=HorizontalAlignment.Center, VerticalAlignment=VerticalAlignment.Center }; line.Children.Add(Text("吸附到边缘？",11));
        var yes=Button("吸附",()=>ResolveSnap(true),44); yes.Height=28; yes.Margin=new(12,0,0,0); line.Children.Add(yes); var no=Button("自由",()=>ResolveSnap(false),44); no.Height=28; no.Margin=new(8,0,0,0); line.Children.Add(no);
        snapPrompt=new Border { Background=Brush("#15181E"), BorderBrush=Brush("#3A4250"), BorderThickness=new(1), CornerRadius=new(14), Child=line, Width=244,Height=52 };
        var bounds=ScreenRect();
        var x=Math.Clamp(Left+targetRect.X+targetRect.Width/2-122,bounds.Left+8,bounds.Right-252);
        var y=Top+targetRect.Bottom+8;
        if(y+52>bounds.Bottom-8)y=Top+targetRect.Top-60;
        y=Math.Clamp(y,bounds.Top+8,bounds.Bottom-60);
        snapPromptScreenRect=new(x,y,244,52);
        snapPopup=new Popup{Child=snapPrompt,AllowsTransparency=true,Placement=PlacementMode.AbsolutePoint,HorizontalOffset=x,VerticalOffset=y,StaysOpen=true,IsOpen=true};
    }
    void ResolveSnap(bool accept)
    {
        if(snapPopup!=null){snapPopup.IsOpen=false;snapPopup.Child=null;}snapPopup=null;snapPrompt=null;
        if(accept && snapEdge!=null)
        {
            var s=ScreenRect(); var center=new Point(Left+targetRect.X+targetRect.Width/2,Top+targetRect.Y+targetRect.Height/2);
            var p=backend.Settings.Placement; p.Mode=snapEdge; p.Ratio=Math.Clamp(snapEdge is "left" or "right"?(center.Y-s.Top)/s.Height:(center.X-s.Left)/s.Width,.04,.96); p.X=p.Y=null;
            PositionWindow(); mode=""; ChangeMode("compact",false); backend.SaveSettings();
        }
        snapEdge=null; lastInside.Restart();
    }
    public void SwitchPage(int next,bool animate=true)
    {
        if(next==page || next<0 || next>2) return;
        var previous=page; page=next;
        var indicatorX=next*50.0;
        if(animate)tabSlide.BeginAnimation(TranslateTransform.XProperty,IslandMotion.Settle(tabSlide.X,indicatorX,330));
        else{tabSlide.BeginAnimation(TranslateTransform.XProperty,null);tabSlide.X=indicatorX;}
        tabIndicator.Width=next==2?58:50;
        for(int i=0;i<3;i++)
        {
            pages[i].IsHitTestVisible=i==next;
            var transform=(TranslateTransform)pages[i].RenderTransform;
            var to=i==next?0:i==previous?(next>previous?-28:28):0;
            var from=i==next&&pages[i].Opacity<=.05?(next>previous?28:-28):transform.X;
            if(animate)
            {
                transform.BeginAnimation(TranslateTransform.XProperty,IslandMotion.Settle(from,to,330));
                pages[i].BeginAnimation(OpacityProperty,IslandMotion.Fade(pages[i].Opacity,i==next?1:0,i==next?190:90,i==next?20:0));
            }
            else { transform.BeginAnimation(TranslateTransform.XProperty,null);transform.X=to;pages[i].BeginAnimation(OpacityProperty,null);pages[i].Opacity=i==next?1:0; }
            tabs[i].Foreground=Brush(i==next?"#F0F3F9":"#AAB5C8");tabs[i].FontWeight=i==next?FontWeights.SemiBold:FontWeights.Normal;
        }
    }
    void QueueUpdate()
    {
        lock(signatures) { if(updateQueued) return; updateQueued=true; }
        Dispatcher.BeginInvoke(()=> { lock(signatures) updateQueued=false; UpdateData(); },DispatcherPriority.Background);
    }
    void UpdateData()
    {
        var agents=backend.Agents; var working=agents.Where(a=>a.TaskState.Status=="working").Sum(a=>Math.Max(1,a.TaskState.ActiveCount)); var waiting=Math.Max(backend.Pending.Length,agents.Count(a=>a.TaskState.Status=="waiting"));
        hoverLabel.Text=notice!=null&&DateTime.UtcNow<noticeUntil?notice.SourceLabel+" · "+notice.Title:waiting>0?$"{waiting} 项等待决定":working>0?$"{working} 个任务运行中":$"{agents.Length} Agents · 空闲";
        UpdateCompactLabel();
        var usage=backend.Usage.FirstOrDefault();
        var quota=usage==null?"额度等待同步":string.Join(" · ",usage.Windows.Select(w=>$"{(w.WindowMinutes<=360 || (w.WindowMinutes==null && w.Id=="primary")?"5h":"周")} {w.RemainingPercent:0.#}%"));
        hoverUsage.Text=quota; workspaceUsage.Text=quota;hoverQuota.Update(usage);workspaceQuota.Update(usage);
        var tooltip=usage==null?"尚无账户额度记录":$"来源：Codex 本地额度记录\n更新时间：{DateTimeOffset.Parse(usage.UpdatedAt).ToLocalTime():MM-dd HH:mm:ss}\n"+string.Join("\n",usage.Windows.Select(w=>$"{(w.Id=="primary"?"5h":"周")} 重置：{(w.ResetsAt==null?"未知":DateTimeOffset.FromUnixTimeSeconds((long)w.ResetsAt.Value).ToLocalTime().ToString("MM-dd HH:mm"))}"))+"\n没有新账户记录时保留最后值，不估算额度。";
        hoverQuota.ToolTip=tooltip; workspaceQuota.ToolTip=tooltip;
        var badgeKey=string.Join("|",agents.Select(a=>a.Id+":"+a.TaskState.Status));
        if(signatures.GetValueOrDefault("agent-badges")!=badgeKey)
        {
            signatures["agent-badges"]=badgeKey;compactAgents.Children.Clear();
            foreach(var agent in agents.Take(3))
            {
                var accent=agent.Id.Contains("claude")?"#DEA174":agent.Id.Contains("cursor")?"#B4D77D":"#89A9EF";
                var label=Text(agent.Glyph,6.5,"#111722",true);label.TextAlignment=TextAlignment.Center;
                compactAgents.Children.Add(new Border{Width=17,Height=17,CornerRadius=new(8.5),Background=Brush(accent),BorderBrush=Brush("#090C12"),BorderThickness=new(2),Margin=new(compactAgents.Children.Count==0?0:-4,0,0,0),Child=label,Opacity=agent.TaskState.Status=="idle"?.65:1});
            }
        }
        UpdatePet();UpdateWork(); UpdateTodos(); UpdateTimer();
    }
    void UpdatePet()
    {
        var working=backend.Agents.Any(a=>a.TaskState.Status=="working");var waiting=backend.Pending.Length>0 || backend.Agents.Any(a=>a.TaskState.Status=="waiting");
        var pulsing=DateTime.UtcNow<visualPulseUntil;
        var petStatus=waiting||pulsing?"waiting":working?"working":"idle";
        pet.SetState(petStatus,visualEffects&&mode=="compact"&&IsVisible);hoverPet.SetState(petStatus,visualEffects&&mode=="hover"&&IsVisible);
        atmosphere.Enabled=visualEffects;atmosphere.SetState(pulsing?"alert":working?"working":"idle",IsVisible&&mode!="hidden"&&!preparing);
    }
    void UpdateCompactLabel()
    {
        var agents=backend.Agents; int count=agents.Sum(a=>a.TaskState.ActiveCount>0?a.TaskState.ActiveCount:a.TaskState.Status=="working"?1:0);
        compactLabel.Text=backend.Settings.Placement.Mode is "left" or "right"?$"{count}\n任务":count>0?$"{count} 工作中":$"{agents.Length} Agents";
    }
    void Reconcile(int index,IEnumerable<(string id,string signature,Func<FrameworkElement> create)> data)
    {
        var items=data.ToArray(); var keep=items.Select(x=>x.id).ToHashSet();
        foreach(var id in rows[index].Keys.Where(id=>!keep.Contains(id)).ToArray()) { lists[index].Children.Remove(rows[index][id]); rows[index].Remove(id); signatures.Remove(index+":"+id); }
        int position=0;
        foreach(var (id,signature,create) in items)
        {
            var key=index+":"+id;
            if(!rows[index].TryGetValue(id,out var element)||signatures.GetValueOrDefault(key)!=signature)
            {
                if(element!=null) lists[index].Children.Remove(element);
                element=create(); rows[index][id]=element; signatures[key]=signature;
            }
            int current=lists[index].Children.IndexOf(element);
            if(current!=position) { if(current>=0) lists[index].Children.Remove(element); lists[index].Children.Insert(position,element); }
            position++;
        }
        if(items.Length==0 && lists[index].Children.Count==0) lists[index].Children.Add(Text(index==0?"暂无任务与通知":index==1?"添加你的第一项待办":"复制文字或图片后，会显示在这里",11,"#737C8C"));
        if(items.Length>0) foreach(var e in lists[index].Children.OfType<TextBlock>().ToArray()) lists[index].Children.Remove(e);
    }
    static Border Row(UIElement content)
    {
        var row=new Border{Background=Brush("#0E1116"),BorderBrush=Brush("#232830"),BorderThickness=new(1),CornerRadius=new(11),Margin=new(0,0,0,5),Padding=new(8,6,8,6),Child=content};
        row.MouseEnter+=(_,_)=>{row.Background=Brush("#151A22");row.BorderBrush=Brush("#35404F");};row.MouseLeave+=(_,_)=>{row.Background=Brush("#0E1116");row.BorderBrush=Brush("#232830");};return row;
    }
    void UpdateWork()
    {
        var work=backend.WorkItems();
        workCount.Text=work.Length.ToString();
        Reconcile(0,work.Select(item=>(item.Id,Json.Write(item),new Func<FrameworkElement>(()=>
        {
            var grid=new Grid(); grid.ColumnDefinitions.Add(new(){Width=new(32)}); grid.ColumnDefinitions.Add(new(){Width=new(1,GridUnitType.Star)}); grid.ColumnDefinitions.Add(new(){Width=new(50)});
            var glyph=Text(item.Glyph,8,"#A5B7FF",true);glyph.TextAlignment=TextAlignment.Center;
            grid.Children.Add(new Border{Width=26,Height=26,CornerRadius=new(8),Background=Brush("#191F2B"),BorderBrush=Brush("#303C54"),BorderThickness=new(1),Child=glyph,HorizontalAlignment=HorizontalAlignment.Left});
            var info=new StackPanel{VerticalAlignment=VerticalAlignment.Center,Margin=new(2,0,5,0)}; info.Children.Add(Text(item.Title,12,bold:true)); info.Children.Add(Text(string.IsNullOrWhiteSpace(item.Subtitle)?"点击返回应用查看任务":item.Subtitle,10,"#A2ADC0")); Grid.SetColumn(info,1); grid.Children.Add(info);
            var row=Row(grid); row.Cursor=Cursors.Hand;
            row.MouseLeftButtonUp+=(_,e)=> { if(item.Target==null)return; e.Handled=true; var target=item.Target; ChangeMode("compact"); _=Task.Run(()=> { var ok=Win32.Activate(target); if(!ok) Dispatcher.BeginInvoke(()=>Toast("未找到可跳转的应用窗口")); }); };
            if(item.EventId!=null) { var delete=Button("×",()=>backend.DeleteEvent(item.EventId),24,true);delete.IsEnabled=backend.Pending.All(d=>d.Id!=item.EventId); delete.HorizontalAlignment=HorizontalAlignment.Right; Grid.SetColumn(delete,2); grid.Children.Add(delete); }
            else { var status=Text(item.Status,10,"#B6C1D3");var chip=new Border{Child=status,Background=Brush("#1C222B"),CornerRadius=new(5),Padding=new(5,2,5,2),HorizontalAlignment=HorizontalAlignment.Right,VerticalAlignment=VerticalAlignment.Center}; Grid.SetColumn(chip,2); grid.Children.Add(chip); }
            var decision=backend.Pending.FirstOrDefault(d=>d.Id==item.EventId);
            if(decision!=null)
            {
                row.Child=null; // Detach before reparenting the row content into the decision stack.
                var panel=new StackPanel(); panel.Children.Add(grid); var actions=new StackPanel { Orientation=Orientation.Horizontal,Margin=new(32,7,0,0) };
                foreach(var choice in decision.Event.Actions) { var button=Button(choice.Label,()=>backend.Respond(decision.Id,choice.Id)); button.Margin=new(0,0,6,0); actions.Children.Add(button); }
                panel.Children.Add(actions); row.Child=panel;
            }
            return row;
        }))));
    }
    void UpdateTodos()
    {
        Reconcile(1,backend.Todos.Items.Select(item=>(item.Id,Json.Write(item),new Func<FrameworkElement>(()=>
        {
            var grid=new Grid(); grid.ColumnDefinitions.Add(new(){Width=new(28)}); grid.ColumnDefinitions.Add(new(){Width=new(1,GridUnitType.Star)}); grid.ColumnDefinitions.Add(new(){Width=new(64)}); grid.ColumnDefinitions.Add(new(){Width=new(24)});
            var complete=Button(item.Completed?"✓":"○",()=>backend.Todos.Edit(item.Id,"complete"),24,true);complete.FontSize=13; grid.Children.Add(complete);
            var info=new StackPanel(); var title=Text(item.Title,12,item.Completed?"#9AA5B8":"#E3E8F2",true); if(item.Completed)title.TextDecorations=TextDecorations.Strikethrough; info.Children.Add(title);
            info.Children.Add(Text($"创建 {DateTimeOffset.Parse(item.CreatedAt).ToLocalTime():MM-dd HH:mm} · 更新 {DateTimeOffset.Parse(item.UpdatedAt).ToLocalTime():MM-dd HH:mm}",10,"#A2ADC0")); Grid.SetColumn(info,1); grid.Children.Add(info);
            var timer=Button((item.TimerStartedAt!=null?"Ⅱ ":"▷ ")+Todo.Duration(item.CurrentElapsed),()=>backend.Todos.Edit(item.Id,"timer"),60); timer.IsEnabled=!item.Completed; timer.Tag=item; Grid.SetColumn(timer,2); grid.Children.Add(timer);
            var delete=Button("×",()=>backend.Todos.Edit(item.Id,"delete"),22,true); Grid.SetColumn(delete,3); grid.Children.Add(delete); return Row(grid);
        }))));
    }
    void UpdateClipboard()
    {
        Reconcile(2,clipboard.Items.Select(item=>(item.Id,item.Id,new Func<FrameworkElement>(()=>
        {
            var grid=new Grid(); grid.ColumnDefinitions.Add(new(){Width=new(1,GridUnitType.Star)}); grid.ColumnDefinitions.Add(new(){Width=new(30)});
            var info=new StackPanel();
            if(item.Image!=null) info.Children.Add(new System.Windows.Controls.Image { Source=item.Image,Height=60,Stretch=Stretch.Uniform,HorizontalAlignment=HorizontalAlignment.Left });
            info.Children.Add(Text(item.Text.Replace('\n',' '),12)); info.Children.Add(Text(item.CreatedAt.ToString("HH:mm:ss")+" · 点击复制",10,"#A2ADC0")); grid.Children.Add(info);
            var row=Row(grid); row.Cursor=Cursors.Hand; row.MouseLeftButtonUp+=(_,e)=> { e.Handled=true; Toast(clipboard.Restore(item)?"已复制":"剪贴板被占用，请重试"); };
            var delete=Button("×",()=>clipboard.Delete(item.Id),24); Grid.SetColumn(delete,1); grid.Children.Add(delete); return row;
        }))));
    }
    void UpdateTimer()
    {
        var active=backend.Todos.Items.FirstOrDefault(t=>t.TimerStartedAt!=null&&!t.Completed);
        var text=active==null?"":Todo.Duration(active.CurrentElapsed);var resized=string.IsNullOrEmpty(text)!=string.IsNullOrEmpty(compactTimer.Text);
        compactTimer.Text=text; timerLabel.Text=notice!=null&&DateTime.UtcNow<noticeUntil?notice.Message:active==null?"点击查看工作列表":$"▷ {active.Title} · {text}";UpdatePet();
        foreach(var row in rows[1].Values.OfType<Border>())
            if(row.Child is Grid g) foreach(var button in g.Children.OfType<Button>()) if(button.Tag is Todo t) button.Content=(t.TimerStartedAt!=null?"Ⅱ ":"▷ ")+Todo.Duration(t.CurrentElapsed);
        if(resized&&dragStart==null&&mode=="compact"&&backend.Settings.Placement.Mode is not ("left" or "right")){mode="";ChangeMode("compact");}
    }
    void Toast(string message) { statusText.Text=message; var timer=new DispatcherTimer{Interval=TimeSpan.FromSeconds(3)}; timer.Tick+=(_,_)=> { statusText.Text=""; timer.Stop(); }; timer.Start(); }
    void RebuildTray()
    {
        var menu=new Forms.ContextMenuStrip();
        void Item(string label,Action action,bool? check=null) { var item=new Forms.ToolStripMenuItem(label); if(check!=null)item.Checked=check.Value; item.Click+=(_,_)=>Dispatcher.Invoke(action); menu.Items.Add(item); }
        Item("显示灵动岛",()=>{Show();ChangeMode("compact");}); Item("隐藏灵动岛",Hide);
        Item("自动隐藏",()=>{backend.Settings.AutoHide=!backend.Settings.AutoHide;backend.SaveSettings();RebuildTray();},backend.Settings.AutoHide);
        Item("氛围与伙伴动效",()=>{visualEffects=!visualEffects;UpdatePet();RebuildTray();},visualEffects);
        Item("重置到屏幕顶部",()=>{backend.Settings.Placement=new();PositionWindow();mode="";ChangeMode("compact",false);backend.SaveSettings();});
        menu.Items.Add(new Forms.ToolStripSeparator());
        Item("剪贴板历史（仅内存）",()=>{backend.Settings.ClipboardHistory=!backend.Settings.ClipboardHistory;if(backend.Settings.ClipboardHistory)Win32.AddClipboardFormatListener(hwnd);else{Win32.RemoveClipboardFormatListener(hwnd);clipboard.Clear();}backend.SaveSettings();RebuildTray();},backend.Settings.ClipboardHistory);
        Item("集中 Windows 通知",()=>{backend.Settings.CaptureWindowsNotifications=!backend.Settings.CaptureWindowsNotifications;if(backend.Settings.CaptureWindowsNotifications)backend.StartNotifications();else backend.StopNotifications();backend.SaveSettings();RebuildTray();},backend.Settings.CaptureWindowsNotifications);
        Item("捕获后从通知中心移除",()=>{backend.Settings.DismissCapturedNotifications=!backend.Settings.DismissCapturedNotifications;backend.StopNotifications();if(backend.Settings.CaptureWindowsNotifications)backend.StartNotifications();backend.SaveSettings();RebuildTray();},backend.Settings.DismissCapturedNotifications);
        Item("打开专注助手设置",()=>Process.Start(new ProcessStartInfo("ms-settings:quiethours"){UseShellExecute=true}));
        Item("开机启动原生版",()=>{backend.Settings.StartWithWindows=!backend.Settings.StartWithWindows;using var key=Microsoft.Win32.Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run");if(backend.Settings.StartWithWindows)key.SetValue("Agent Island",'"'+Environment.ProcessPath+'"');else key.DeleteValue("Agent Island",false);backend.SaveSettings();RebuildTray();},backend.Settings.StartWithWindows);
        menu.Items.Add(new Forms.ToolStripSeparator()); Item("退出",Close); var old=tray.ContextMenuStrip;tray.ContextMenuStrip=menu;old?.Dispose();
    }
    void Frame(object? sender,EventArgs e)
    {
        if(!collectingFrames)return;
        var now=Stopwatch.GetTimestamp(); if(previousFrame!=0)frames.Enqueue((now-previousFrame)*1000.0/Stopwatch.Frequency);previousFrame=now;
    }
    async Task RunDiagnostics()
    {
        try
        {
            // Fixtures live only in the diagnostic backend and isolated test-data folder.
            for(int i=0;i<6;i++)backend.Publish(new System.Text.Json.Nodes.JsonObject{["source"]="system",["sourceLabel"]=i%2==0?"Windows":"Agent",["sourceGlyph"]=i%2==0?"WN":"AI",["title"]=i%2==0?"通知提醒":"任务已完成",["message"]="诊断示例 · 用于检查列表密度与滚动效果",["silent"]=true});
            if(backend.Todos.Items.Length==0){backend.Todos.Create("整理今日任务");backend.Todos.Create("检查灵动岛交互效果");}
            await Task.Delay(1000);
            var samples=new List<object>();
            async Task Measure(string label,Action action)
            {
                frames.Clear();previousFrame=0;collectingFrames=true;CompositionTarget.Rendering+=Frame;
                var time=Stopwatch.StartNew(); action();var actionMs=time.Elapsed.TotalMilliseconds;
                await Dispatcher.InvokeAsync(()=>{},DispatcherPriority.Render); var dispatchedMs=time.Elapsed.TotalMilliseconds;
                await Task.Delay(500);collectingFrames=false;CompositionTarget.Rendering-=Frame;
                samples.Add(new{label,actionMs,dispatchedMs,frameCount=frames.Count,medianFrameMs=frames.Count==0?0:frames.OrderBy(x=>x).ElementAt(frames.Count/2),maxFrameMs=frames.DefaultIfEmpty(0).Max()});
            }
            void Capture(string name)
            {
                UpdateLayout();var bitmap=new RenderTargetBitmap((int)targetRect.Width,(int)targetRect.Height,96,96,PixelFormats.Pbgra32);
                var drawing=new DrawingVisual();using(var context=drawing.RenderOpen()){var brush=new VisualBrush(canvas){ViewboxUnits=BrushMappingMode.Absolute,Viewbox=targetRect,Stretch=Stretch.Fill};context.DrawRectangle(brush,null,new Rect(0,0,targetRect.Width,targetRect.Height));}bitmap.Render(drawing);
                var png=new PngBitmapEncoder();png.Frames.Add(BitmapFrame.Create(bitmap));Directory.CreateDirectory(Diagnostics.OutputPath);using var file=File.Create(Path.Combine(Diagnostics.OutputPath,name+".png"));png.Save(file);
            }
            await Measure("cold-hover",()=>ChangeMode("hover"));Capture("native-hover");
            await Measure("cold-workspace",()=>ChangeMode("workspace"));Capture("native-workspace");
            await Measure("wheel-todo",()=>SwitchPage(1));Capture("native-todo"); await Measure("wheel-clipboard",()=>SwitchPage(2));Capture("native-clipboard");
            ChangeMode("hidden"); await Task.Delay(5000); await Measure("idle-hover",()=>ChangeMode("hover")); await Measure("idle-workspace",()=>ChangeMode("workspace"));
            for(int i=0;i<12;i++)SwitchPage((page+1)%3);
            await Task.Delay(200); SwitchPage(0,false); UpdateLayout();
            Capture("native-workspace");
            var placements=new List<object>();
            foreach(var edge in new[]{"top","bottom","left","right"})
            {
                backend.Settings.Placement.Mode=edge;PositionWindow();mode="";ChangeMode("workspace",false);UpdateLayout();
                var r=targetRect;var bounds=ScreenRect();
                placements.Add(new{edge,visibleInsideCanvas=r.Left>=0&&r.Top>=0&&r.Right<=CanvasWidth&&r.Bottom<=CanvasHeight,visibleInsideScreen=Left+r.Left>=bounds.Left&&Top+r.Top>=bounds.Top&&Left+r.Right<=bounds.Right&&Top+r.Bottom<=bounds.Bottom});
            }
            var uiChecks=new List<object>();
            foreach(var displayMode in new[]{"compact","hover"})
            {
                backend.Settings.Placement=new(){Mode="free",X=500,Y=200};mode="";ChangeMode(displayMode,false);PositionWindow();UpdateLayout();
                var surface=displayMode=="compact"?compact:hover;
                var hitPoint=new Point(targetRect.Left+5,targetRect.Top+targetRect.Height/2);
                uiChecks.Add(new{name=displayMode+"-blank-area-draggable",passed=InputHitTest(hitPoint)==surface});
            }
            var origin=new Point(Left,Top);var mouseOrigin=PointToScreen(new Point(targetRect.X+20,targetRect.Y+20));var dragDpi=VisualTreeHelper.GetDpi(this);
            ArmDrag(mouseOrigin);MoveDrag(mouseOrigin+new Vector(dragDpi.DpiScaleX,dragDpi.DpiScaleY));
            uiChecks.Add(new{name="drag-threshold-preserves-click",passed=!dragging&&Left==origin.X&&Top==origin.Y});
            ChangeMode("compact",false);uiChecks.Add(new{name="armed-drag-blocks-hover-transition",passed=mode=="hover"});
            MoveDrag(mouseOrigin+new Vector(80*dragDpi.DpiScaleX,100*dragDpi.DpiScaleY));
            uiChecks.Add(new{name="drag-moves-window-in-dips",passed=dragging&&Math.Abs(Left-origin.X-80)<1&&Math.Abs(Top-origin.Y-100)<1});
            CancelDrag();uiChecks.Add(new{name="capture-loss-persists-free-position",passed=dragStart==null&&!dragging&&backend.Settings.Placement.Mode=="free"&&mode=="hover"});
            foreach(var edge in new[]{"top","bottom","left","right"})
            {
                ResolveSnap(false);var bounds=ScreenRect();var r=targetRect;
                Left=edge=="left"?bounds.Left-r.Left:edge=="right"?bounds.Right-r.Right:bounds.Left+bounds.Width/2-r.X-r.Width/2;
                Top=edge=="top"?bounds.Top-r.Top:edge=="bottom"?bounds.Bottom-r.Bottom:bounds.Top+bounds.Height/2-r.Y-r.Height/2;
                FinishDrag();
                uiChecks.Add(new{name=edge+"-snap-prompt-inside-screen",passed=snapEdge==edge&&bounds.Contains(snapPromptScreenRect)&&snapPopup?.IsOpen==true});
                if(edge=="top"&&snapPrompt!=null)
                {
                    await Dispatcher.InvokeAsync(()=>{},DispatcherPriority.Render);snapPrompt.UpdateLayout();
                    var content=(StackPanel)snapPrompt.Child;var location=content.TranslatePoint(new Point(),snapPrompt);
                    var buttons=content.Children.OfType<Button>().ToArray();
                    uiChecks.Add(new{name="snap-prompt-balanced-layout",passed=Math.Abs(location.X+content.ActualWidth/2-snapPrompt.ActualWidth/2)<1&&Math.Abs(location.Y+content.ActualHeight/2-snapPrompt.ActualHeight/2)<1&&buttons.All(b=>b.ActualWidth==44&&b.ActualHeight==28)});
                    var bitmap=new RenderTargetBitmap(244,52,96,96,PixelFormats.Pbgra32);bitmap.Render(snapPrompt);
                    var png=new PngBitmapEncoder();png.Frames.Add(BitmapFrame.Create(bitmap));using var file=File.Create(Path.Combine(Diagnostics.OutputPath,"native-snap-prompt.png"));png.Save(file);
                }
                ResolveSnap(edge=="left");
                uiChecks.Add(new{name=edge+"-snap-choice",passed=backend.Settings.Placement.Mode==(edge=="left"?"left":"free")&&snapPopup==null});
                backend.Settings.Placement=new(){Mode="free",X=500,Y=200};mode="";ChangeMode("hover",false);PositionWindow();
            }
            ChangeMode("workspace",false);UpdateLayout();
            uiChecks.Add(new{name="workspace-top-grip-draggable",passed=dragGrip.ActualWidth>300&&dragGrip.ActualHeight==9&&dragGrip.Background==Brushes.Transparent});
            backend.Settings.Placement.Mode="top";PositionWindow();mode="";ChangeMode("workspace",false);SwitchPage(0,false);
            var header=(Grid)workspace.Children[0];
            for(int i=0;i<9;i++)header.RaiseEvent(new MouseWheelEventArgs(Mouse.PrimaryDevice,Environment.TickCount,-120){RoutedEvent=UIElement.PreviewMouseWheelEvent});
            uiChecks.Add(new{name="rapid-header-wheel",passed=page==0});
            var expected=page;scrolls[page].RaiseEvent(new MouseWheelEventArgs(Mouse.PrimaryDevice,Environment.TickCount,-120){RoutedEvent=UIElement.PreviewMouseWheelEvent});
            uiChecks.Add(new{name="list-wheel-does-not-switch-page",passed=page==expected});
            scrolls[0].ScrollToVerticalOffset(0);await Dispatcher.InvokeAsync(()=>{},DispatcherPriority.Render);
            scrolls[0].RaiseEvent(new MouseWheelEventArgs(Mouse.PrimaryDevice,Environment.TickCount,-120){RoutedEvent=UIElement.MouseWheelEvent});await Dispatcher.InvokeAsync(()=>{},DispatcherPriority.Render);
            uiChecks.Add(new{name="list-wheel-scrolls-content",passed=scrolls[0].VerticalOffset>0});
            if(scrolls[0].Template.FindName("PART_VerticalScrollBar",scrolls[0]) is ScrollBar bar)
            {
                uiChecks.Add(new{name="slim-scrollbar",passed=bar.ActualWidth<=7.1});
                bar.RaiseEvent(new ScrollEventArgs(ScrollEventType.ThumbTrack,bar.Maximum){RoutedEvent=ScrollBar.ScrollEvent});await Task.Delay(50);UpdateLayout();
                uiChecks.Add(new{name="scrollbar-thumb-scrolls-content",passed=Math.Abs(scrolls[0].VerticalOffset-scrolls[0].ScrollableHeight)<1});
            }
            EvaluatePointer(new Point(-50,-50),true);uiChecks.Add(new{name="outside-click-collapses",passed=mode=="compact"});
            ChangeMode("hidden",false);EvaluatePointer(new Point(targetRect.X+targetRect.Width/2,targetRect.Y+targetRect.Height/2),false);uiChecks.Add(new{name="near-hidden-reveals",passed=mode=="hover"});
            ChangeMode("workspace",false);UpdateLayout();
            var hit=VisualTreeHelper.HitTest(canvas,new Point(1,CanvasHeight-1));uiChecks.Add(new{name="transparent-canvas-has-no-hit-target",passed=hit==null});
            var exStyle=Win32.GetWindowLong(hwnd,-20);uiChecks.Add(new{name="tool-window-not-taskbar",passed=(exStyle&0x80)!=0&&(exStyle&0x40000)==0});
            uiChecks.Add(new{name="readable-system-font",passed=FontFamily.Source.Contains("Microsoft YaHei UI")&&tabs.All(t=>t.FontSize>=11)});
            uiChecks.Add(new{name="quota-without-box",passed=hoverQuota.BorderThickness==new Thickness(0)});
            var resources=new List<object>();
            async Task ResourceSample(string label,bool effects,string displayMode)
            {
                visualEffects=effects;ChangeMode(displayMode,false);UpdatePet();await Task.Delay(500);
                using var process=Process.GetCurrentProcess();var cpu=process.TotalProcessorTime.TotalMilliseconds;var watch=Stopwatch.StartNew();await Task.Delay(8000);process.Refresh();
                resources.Add(new{label,elapsedMs=watch.Elapsed.TotalMilliseconds,wholeMachineCpuPercent=(process.TotalProcessorTime.TotalMilliseconds-cpu)/watch.Elapsed.TotalMilliseconds/Environment.ProcessorCount*100,workingSetMiB=process.WorkingSet64/1048576.0,privateMiB=process.PrivateMemorySize64/1048576.0,atmosphereAnimations=atmosphere.ActiveAnimations,partnerAnimations=pet.HasActiveClocks||hoverPet.HasActiveClocks});
            }
            await ResourceSample("visible-effects-off",false,"hover");await ResourceSample("visible-effects-on",true,"hover");
            Capture("native-hover");
            visualPulseUntil=DateTime.UtcNow.AddSeconds(2.4);UpdatePet();await Task.Delay(300);Capture("native-alert");
            visualPulseUntil=DateTime.MinValue;await ResourceSample("hidden-effects-on",true,"hidden");
            uiChecks.Add(new{name="hidden-stops-all-decoration-clocks",passed=atmosphere.ActiveAnimations==0&&!pet.HasActiveClocks&&!hoverPet.HasActiveClocks});
            var diagnostic=new{version="0.12.2-native",renderTier=RenderCapability.Tier>>16,samples,resources,page,placements,uiChecks,state=backend.State};
            Json.AtomicWrite(Path.Combine(Diagnostics.OutputPath,"native-performance.json"),diagnostic);
            Close();
        }
        catch(Exception ex){Diagnostics.Log("diagnostic",ex.ToString());Close();}
    }
}
