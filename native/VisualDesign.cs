using System;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;

namespace AgentIsland;

// Transient, compositor-friendly motion. No per-frame layout or rendering timer.
sealed class IslandSpring : EasingFunctionBase
{
    protected override double EaseInCore(double t)
    {
        if(t>=1)return 1;
        return 1-Math.Exp(-9*t)*(Math.Cos(7.2*t)+1.25*Math.Sin(7.2*t));
    }
    protected override Freezable CreateInstanceCore()=>new IslandSpring();
}
static class IslandMotion
{
    public static readonly IEasingFunction Spring=CreateSpring();
    static IEasingFunction CreateSpring(){var e=new IslandSpring{EasingMode=EasingMode.EaseIn};e.Freeze();return e;}
    public static DoubleAnimation Settle(double from,double to,int milliseconds=380,int delay=0)=>new(from,to,TimeSpan.FromMilliseconds(milliseconds)){BeginTime=TimeSpan.FromMilliseconds(delay),EasingFunction=Spring};
    public static DoubleAnimation Fade(double from,double to,int milliseconds=180,int delay=0)=>new(from,to,TimeSpan.FromMilliseconds(milliseconds)){BeginTime=TimeSpan.FromMilliseconds(delay),EasingFunction=new CubicEase{EasingMode=EasingMode.EaseOut}};
    public static SolidColorBrush Color(string color){var b=(SolidColorBrush)new BrushConverter().ConvertFromString(color)!;b.Freeze();return b;}
    public static LinearGradientBrush Gradient(string start,string end,double angle=90){var b=new LinearGradientBrush((Color)ColorConverter.ConvertFromString(start),(Color)ColorConverter.ConvertFromString(end),angle);b.Freeze();return b;}
}

sealed class QuotaBadge : Border
{
    readonly TextBlock[] values=new TextBlock[2];
    public QuotaBadge(TextBlock value,bool compact=false)
    {
        Width=compact?146:142;Height=compact?28:40;Background=Brushes.Transparent;BorderThickness=new(0);
        var grid=new Grid();grid.ColumnDefinitions.Add(new(){Width=new(1,GridUnitType.Star)});grid.ColumnDefinitions.Add(new(){Width=new(1,GridUnitType.Star)});
        for(int i=0;i<2;i++)
        {
            var column=new StackPanel{Orientation=compact?Orientation.Horizontal:Orientation.Vertical,VerticalAlignment=VerticalAlignment.Center,Margin=new(i==0?0:12,0,0,0)};
            var label=new TextBlock{Text=i==0?(compact?"5h":"5h 剩余"):(compact?"周":"本周剩余"),FontSize=10,Foreground=IslandMotion.Color("#A6B2C5"),VerticalAlignment=VerticalAlignment.Center};
            values[i]=new TextBlock{Text="—",FontSize=compact?12:14,FontWeight=FontWeights.SemiBold,Foreground=IslandMotion.Color(i==0?"#DCE6FF":"#C7EBDD"),Margin=compact?new(5,0,0,0):new(0,2,0,0),VerticalAlignment=VerticalAlignment.Center};
            column.Children.Add(label);column.Children.Add(values[i]);Grid.SetColumn(column,i);grid.Children.Add(column);
        }
        Child=grid;
    }
    public void Update(Usage? usage)
    {
        var primary=usage?.Windows.FirstOrDefault(w=>w.Id=="primary")??usage?.Windows.FirstOrDefault();
        var secondary=usage?.Windows.FirstOrDefault(w=>w!=primary);
        values[0].Text=primary==null?"—":$"{primary.RemainingPercent:0.#}%";values[1].Text=secondary==null?"—":$"{secondary.RemainingPercent:0.#}%";
    }
}

// Four reusable dots and cached gradient brushes; no blur shader or frame callback.
sealed class IslandAtmosphere : Canvas
{
    readonly Ellipse blue=new(),mint=new();
    readonly Ellipse[] dots=new Ellipse[4];
    string state="";bool enabled=true;
    public bool Enabled {get=>enabled;set{if(enabled==value)return;enabled=value;state="";}}
    public int ActiveAnimations=>dots.Count(p=>p.HasAnimatedProperties)+dots.Count(p=>p.RenderTransform.HasAnimatedProperties)+(blue.HasAnimatedProperties?1:0);
    public IslandAtmosphere()
    {
        IsHitTestVisible=false;
        RadialGradientBrush Glow(Color color){var b=new RadialGradientBrush(color,Colors.Transparent);b.Freeze();return b;}
        blue.Fill=Glow(Color.FromArgb(60,103,139,255));mint.Fill=Glow(Color.FromArgb(38,89,218,180));
        blue.Width=170;blue.Height=80;mint.Width=150;mint.Height=65;Children.Add(blue);Children.Add(mint);
        for(int i=0;i<dots.Length;i++){dots[i]=new Ellipse{Width=i%2==0?2:3,Height=i%2==0?2:3,Fill=IslandMotion.Color(i%2==0?"#9DBAFF":"#8DE2CE"),Opacity=0,RenderTransform=new TranslateTransform()};Children.Add(dots[i]);}
    }
    public void SetBounds(double width,double height)
    {
        if(Width==width&&Height==height)return;Width=width;Height=height;Clip=new RectangleGeometry(new Rect(0,0,width,height),22,22);
        SetLeft(blue,-35);SetTop(blue,height-50);SetLeft(mint,width-130);SetTop(mint,height-35);
        for(int i=0;i<dots.Length;i++){SetLeft(dots[i],width*(.12+i*.2));SetTop(dots[i],height-9-i%2*6);}state="";
    }
    static T Slow<T>(T animation) where T:Timeline{Timeline.SetDesiredFrameRate(animation,30);return animation;}
    public void SetState(string next,bool visible)
    {
        var key=next+":"+visible+":"+enabled;if(state==key)return;state=key;
        blue.BeginAnimation(OpacityProperty,null);
        foreach(var dot in dots){dot.BeginAnimation(OpacityProperty,null);var t=(TranslateTransform)dot.RenderTransform;t.BeginAnimation(TranslateTransform.XProperty,null);t.BeginAnimation(TranslateTransform.YProperty,null);dot.Opacity=0;}
        Visibility=visible&&enabled?Visibility.Visible:Visibility.Hidden;blue.Opacity=next=="alert"?.8:.42;mint.Opacity=.45;
        if(!visible||!enabled)return;
        if(next=="alert")blue.BeginAnimation(OpacityProperty,Slow(new DoubleAnimation(.35,.9,TimeSpan.FromMilliseconds(500)){AutoReverse=true,RepeatBehavior=new RepeatBehavior(2),FillBehavior=FillBehavior.Stop}));
        if(next is not ("working" or "alert"))return;
        for(int i=0;i<dots.Length;i++)
        {
            var t=(TranslateTransform)dots[i].RenderTransform;
            t.BeginAnimation(TranslateTransform.XProperty,Slow(new DoubleAnimation(0,20+i*4,TimeSpan.FromSeconds(3.2+i*.4)){AutoReverse=true,RepeatBehavior=RepeatBehavior.Forever}));
            t.BeginAnimation(TranslateTransform.YProperty,Slow(new DoubleAnimation(1,-4,TimeSpan.FromSeconds(2.8+i*.3)){AutoReverse=true,RepeatBehavior=RepeatBehavior.Forever,EasingFunction=new SineEase()}));
            dots[i].BeginAnimation(OpacityProperty,Slow(new DoubleAnimation(.08,next=="alert"?.75:.38,TimeSpan.FromSeconds(1.3+i*.3)){AutoReverse=true,RepeatBehavior=RepeatBehavior.Forever}));
        }
    }
}

sealed class PixelCompanion : Grid
{
    readonly DrawingGroup body=new();
    readonly DrawingGroup openEyes=new(),closedEyes=new(),leftPaw=new(),rightPaw=new(),tail=new();
    readonly ScaleTransform blink=new(1,1,8,8);
    readonly TranslateTransform glance=new(),leftStep=new(),rightStep=new();
    readonly RotateTransform tailWag=new(0,14,8),rightSlap=new(0,14,12);
    readonly ScaleTransform squash=new();
    readonly RotateTransform lean=new();
    readonly TranslateTransform bounce=new();
    readonly Image creature;
    readonly TextBlock sleep;
    readonly Rectangle impact;
    string state="";
    public bool IsAnimating {get;private set;}
    public bool HasActiveClocks=>bounce.HasAnimatedProperties||squash.HasAnimatedProperties||lean.HasAnimatedProperties||blink.HasAnimatedProperties||glance.HasAnimatedProperties||leftStep.HasAnimatedProperties||rightStep.HasAnimatedProperties||tailWag.HasAnimatedProperties||rightSlap.HasAnimatedProperties||impact.HasAnimatedProperties||sleep.HasAnimatedProperties||openEyes.HasAnimatedProperties||closedEyes.HasAnimatedProperties;
    public PixelCompanion()
    {
        Width=28;Height=26;IsHitTestVisible=false;
        var ground=new Border{Width=18,Height=2,CornerRadius=new(1),Background=IslandMotion.Color("#343B4C"),Opacity=.65,VerticalAlignment=VerticalAlignment.Bottom,Margin=new(0,0,0,1)};Children.Add(ground);
        void Rect(DrawingGroup g,double x,double y,double w,double h,string color,double radius=0)=>g.Children.Add(new GeometryDrawing(IslandMotion.Color(color),null,new RectangleGeometry(new Rect(x,y,w,h),radius,radius)));
        Rect(body,4,4,12,11,"#79DCC7",5);Rect(body,1,5,12,10,"#A18FFF",5);Rect(body,2,2,12,12,"#91AAFF",5);
        Rect(leftPaw,0,12,4,3,"#879FF2",1.5);Rect(rightPaw,12,12,4,3,"#75D2BD",1.5);Rect(tail,14,6,3,3,"#7ADBC3",1.5);
        leftPaw.Transform=leftStep;var pawTransforms=new TransformGroup();pawTransforms.Children.Add(rightStep);pawTransforms.Children.Add(rightSlap);rightPaw.Transform=pawTransforms;tail.Transform=tailWag;body.Children.Add(leftPaw);body.Children.Add(rightPaw);body.Children.Add(tail);
        Rect(openEyes,5,7,2,2,"#0A1220",.8);Rect(openEyes,10,7,2,2,"#0A1220",.8);Rect(openEyes,8,10,2,1,"#A6091018",.5);
        Rect(closedEyes,4.5,8,3,1,"#111A2C",.5);Rect(closedEyes,10,8,3,1,"#111A2C",.5);
        var eyeTransforms=new TransformGroup();eyeTransforms.Children.Add(blink);eyeTransforms.Children.Add(glance);openEyes.Transform=eyeTransforms;body.Children.Add(openEyes);body.Children.Add(closedEyes);
        var transforms=new TransformGroup();transforms.Children.Add(squash);transforms.Children.Add(lean);transforms.Children.Add(bounce);
        creature=new Image{Source=new DrawingImage(body),Width=21,Height=20,HorizontalAlignment=HorizontalAlignment.Center,VerticalAlignment=VerticalAlignment.Top,Margin=new(0,1,0,0),RenderTransform=transforms,RenderTransformOrigin=new(.5,.85)};
        RenderOptions.SetBitmapScalingMode(creature,BitmapScalingMode.NearestNeighbor);Children.Add(creature);
        sleep=new TextBlock{Text="z",FontFamily=new("Cascadia Code"),FontSize=6,Foreground=IslandMotion.Color("#8691AB"),HorizontalAlignment=HorizontalAlignment.Right,Margin=new(0,-1,0,0),Opacity=0};Children.Add(sleep);
        impact=new Rectangle{Width=2,Height=2,Fill=IslandMotion.Color("#FFC76D"),HorizontalAlignment=HorizontalAlignment.Right,VerticalAlignment=VerticalAlignment.Bottom,Margin=new(0,0,1,3),Opacity=0};Children.Add(impact);
        SetState("idle",false);
    }
    public void SetState(string next,bool moving)
    {
        var key=next+":"+moving;if(state==key)return;state=key;IsAnimating=moving;
        foreach(var property in new[]{TranslateTransform.YProperty,TranslateTransform.XProperty})bounce.BeginAnimation(property,null);
        lean.BeginAnimation(RotateTransform.AngleProperty,null);squash.BeginAnimation(ScaleTransform.ScaleYProperty,null);squash.BeginAnimation(ScaleTransform.ScaleXProperty,null);impact.BeginAnimation(OpacityProperty,null);
        blink.BeginAnimation(ScaleTransform.ScaleYProperty,null);glance.BeginAnimation(TranslateTransform.XProperty,null);leftStep.BeginAnimation(TranslateTransform.YProperty,null);rightStep.BeginAnimation(TranslateTransform.YProperty,null);tailWag.BeginAnimation(RotateTransform.AngleProperty,null);rightSlap.BeginAnimation(RotateTransform.AngleProperty,null);sleep.BeginAnimation(OpacityProperty,null);
        openEyes.BeginAnimation(DrawingGroup.OpacityProperty,null);closedEyes.BeginAnimation(DrawingGroup.OpacityProperty,null);
        blink.ScaleY=1;glance.X=0;leftStep.Y=rightStep.Y=0;tailWag.Angle=rightSlap.Angle=0;
        bounce.X=0;bounce.Y=next=="idle"?5:0;lean.Angle=0;squash.ScaleX=next=="idle"?1.08:1;squash.ScaleY=next=="idle"?.58:1;
        openEyes.Opacity=next=="idle"?0:1;closedEyes.Opacity=next=="idle"?1:0;sleep.Opacity=next=="idle"?.65:0;impact.Opacity=next=="waiting"?.7:0;
        if(!moving)return;
        if(next=="idle")
        {
            squash.BeginAnimation(ScaleTransform.ScaleYProperty,Loop(.58,.64,2800));sleep.BeginAnimation(OpacityProperty,Loop(.25,.7,2400));return;
        }
        var cycle=next=="waiting"?1000:1600;
        bounce.BeginAnimation(TranslateTransform.YProperty,Sequence(cycle,(0,0),(.14,-3),(.27,1),(.43,-1.5),(.58,1),(.82,0),(1,0)));
        squash.BeginAnimation(ScaleTransform.ScaleYProperty,Sequence(cycle,(0,1),(.12,1.08),(.27,.87),(.42,1.04),(.58,.93),(1,1)));
        lean.BeginAnimation(RotateTransform.AngleProperty,Sequence(cycle,(0,0),(.18,-6),(.35,5),(.6,-3),(1,0)));
        tailWag.BeginAnimation(RotateTransform.AngleProperty,Loop(-8,22,600));
        blink.BeginAnimation(ScaleTransform.ScaleYProperty,Sequence(5200,(0,1),(.74,1),(.76,.05),(.79,1),(1,1)));
        glance.BeginAnimation(TranslateTransform.XProperty,Sequence(6400,(0,0),(.23,.6),(.48,-.6),(.7,0),(1,0)));
        if(next=="waiting")
        {
            rightSlap.BeginAnimation(RotateTransform.AngleProperty,Sequence(1000,(0,-10),(.12,-38),(.22,22),(.35,-30),(.45,15),(.6,0),(1,-10)));
            impact.BeginAnimation(OpacityProperty,Sequence(1000,(0,0),(.2,.1),(.23,.9),(.3,0),(.45,.8),(.55,0),(1,0)));
        }
        else {leftStep.BeginAnimation(TranslateTransform.YProperty,Loop(-1,1,260));rightStep.BeginAnimation(TranslateTransform.YProperty,Loop(1,-1,260));}
    }
    public void Peek()
    {
        if(state!="idle:True")return;
        DoubleAnimationUsingKeyFrames Once(params (double t,double value)[] frames){var a=Sequence(1400,frames);a.RepeatBehavior=new RepeatBehavior(1);a.FillBehavior=FillBehavior.Stop;return a;}
        var wake=Once((0,5),(.2,0),(.72,0),(1,5));wake.Completed+=(_,_)=>{if(state=="idle:True"){state="";SetState("idle",true);}};
        bounce.BeginAnimation(TranslateTransform.YProperty,wake);squash.BeginAnimation(ScaleTransform.ScaleYProperty,Once((0,.58),(.2,1),(.72,1),(1,.58)));
        openEyes.BeginAnimation(DrawingGroup.OpacityProperty,Once((0,0),(.2,1),(.72,1),(1,0)));closedEyes.BeginAnimation(DrawingGroup.OpacityProperty,Once((0,1),(.2,0),(.72,0),(1,1)));
    }
    static DoubleAnimation Loop(double from,double to,int milliseconds){var a=new DoubleAnimation(from,to,TimeSpan.FromMilliseconds(milliseconds)){AutoReverse=true,RepeatBehavior=RepeatBehavior.Forever,EasingFunction=new SineEase()};Timeline.SetDesiredFrameRate(a,30);return a;}
    static DoubleAnimationUsingKeyFrames Sequence(int milliseconds,params (double t,double value)[] frames)
    {
        var a=new DoubleAnimationUsingKeyFrames{Duration=TimeSpan.FromMilliseconds(milliseconds),RepeatBehavior=RepeatBehavior.Forever};
        foreach(var frame in frames)a.KeyFrames.Add(new SplineDoubleKeyFrame(frame.value,KeyTime.FromPercent(frame.t),new KeySpline(.4,0,.6,1)));Timeline.SetDesiredFrameRate(a,30);return a;
    }
}
