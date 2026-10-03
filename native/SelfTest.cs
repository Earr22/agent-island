using System;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading.Tasks;

namespace AgentIsland;

static class SelfTest
{
    public static async Task Run()
    {
        var folder=Path.Combine(Diagnostics.OutputPath,"self-test-data");Directory.CreateDirectory(folder);
        int checks=0;
        void Check(bool condition,string name) { if(!condition)throw new Exception("Self-test failed: "+name);checks++; }
        var defaults=new Settings();Check(!defaults.CaptureWindowsNotifications&&!defaults.DismissCapturedNotifications,"notification privacy defaults");
        using(var diagnosticBackend=new Backend(Path.Combine(folder,"diagnostic"),new(){Port=0,ClipboardHistory=false}))
        {
            diagnosticBackend.Start(true,startApi:false);
            Check(diagnosticBackend.Agents.Length==1&&diagnosticBackend.Agents[0].ProcessIds.Length==0&&diagnosticBackend.Usage[0].Windows[0].RemainingPercent==77,"isolated diagnostic fixtures");
            Check(diagnosticBackend.Api.Port==0,"showcase fixture does not open HTTP listener");
        }
        var todos=new TodoStore(Path.Combine(folder,"todos.json"));
        foreach(var existing in todos.Items)todos.Edit(existing.Id,"delete");
        todos.Create("  测试   待办  "); Check(todos.Items[0].Title=="测试 待办","todo normalization");
        var first=todos.Items[0];todos.Edit(first.Id,"timer");await Task.Delay(25);Check(todos.Items[0].CurrentElapsed>0,"timer elapsed");
        todos.Create("第二个任务");var second=Array.Find(todos.Items,t=>t.Id!=first.Id)!;todos.Edit(second.Id,"timer");Check(first.TimerStartedAt==null&&second.TimerStartedAt!=null,"single active timer");
        todos.Edit(second.Id,"complete");Check(second.Completed&&second.TimerStartedAt==null,"completion stops timer");
        var restored=new TodoStore(Path.Combine(folder,"todos.json"));Check(restored.Items.Length==2&&Array.Find(restored.Items,t=>t.Id==second.Id)!.Completed,"todo persistence");
        todos.ClearCompleted();Check(todos.Items.Length==1,"clear completed");
        var sessionRoot=Path.Combine(folder,"sessions");Directory.CreateDirectory(sessionRoot);
        var sessionFile=Path.Combine(sessionRoot,"rollout-test-00000000-0000-0000-0000-000000000001.jsonl");
        File.WriteAllText(sessionFile,"");
        TaskState? current=null;Usage? quota=null;
        using var monitor=new SessionMonitor(sessionRoot);
        monitor.Changed+=(s,u)=>{current=s;quota=u;};monitor.Start();
        async Task Await(Func<bool> predicate,string label) { for(int i=0;i<50&&!predicate();i++)await Task.Delay(100);Check(predicate(),label); }
        await Await(()=>current?.Status=="idle","session starts idle");
        File.AppendAllText(sessionFile,new JsonObject{["type"]="event_msg",["timestamp"]=Json.Now,["payload"]=new JsonObject{["type"]="task_started",["turn_id"]="one"}}.ToJsonString()+"\n");
        await Await(()=>current?.Status=="working","real session start");
        File.AppendAllText(sessionFile,new JsonObject{["type"]="event_msg",["timestamp"]=Json.Now,["payload"]=new JsonObject{["type"]="token_count",["rate_limits"]=new JsonObject{["primary"]=new JsonObject{["used_percent"]=23,["window_minutes"]=300},["secondary"]=new JsonObject{["used_percent"]=40,["window_minutes"]=10080}}}}.ToJsonString()+"\n");
        await Await(()=>quota?.Windows.Length==2&&quota.Windows[0].RemainingPercent==77&&quota.Windows[1].RemainingPercent==60,"quota remaining mapping");
        File.AppendAllText(sessionFile,new JsonObject{["type"]="event_msg",["timestamp"]=Json.Now,["payload"]=new JsonObject{["type"]="task_complete",["turn_id"]="one"}}.ToJsonString()+"\n");
        await Await(()=>current?.Status=="idle","real session completed");
        using var backend=new Backend(folder,new(){Port=0,CaptureWindowsNotifications=false,ClipboardHistory=false});
        backend.Api.Start(0);
        using var http=new HttpClient{BaseAddress=new Uri($"http://127.0.0.1:{backend.Api.Port}"),Timeout=TimeSpan.FromSeconds(5)};
        async Task<JsonNode> Post(string route,JsonNode p) { using var response=await http.PostAsync(route,new StringContent(p.ToJsonString(),Encoding.UTF8,"application/json"));return JsonNode.Parse(await response.Content.ReadAsStringAsync())!; }
        var health=JsonNode.Parse(await http.GetStringAsync("/health"))!;Check(health.Text("version")=="0.12.2-native","api state");
        using(var crossOrigin=new HttpRequestMessage(HttpMethod.Post,"/v1/events"))
        {
            crossOrigin.Headers.Add("Origin","https://example.com");crossOrigin.Content=new StringContent("{}",Encoding.UTF8,"application/json");
            using var response=await http.SendAsync(crossOrigin);Check(response.StatusCode==System.Net.HttpStatusCode.Forbidden&&backend.History.Length==0,"cross-origin event blocked");
        }
        using(var invalidBody=await http.PostAsync("/v1/events",new StringContent("null",Encoding.UTF8,"application/json")))Check(invalidBody.StatusCode==System.Net.HttpStatusCode.BadRequest,"non-object JSON rejected");
        var ev=await Post("/v1/events",new JsonObject{["source"]="claude",["type"]="working",["title"]="真实任务",["message"]="处理中"});Check(ev.Bool("ok")&&backend.History[0].Type=="working","event ingestion");
        var pending=await Post("/v1/decisions",new JsonObject{["source"]="claude",["title"]="测试批准",["wait"]=false});var id=pending.Text("decisionId");Check(id.Length>0&&backend.Pending.Length==1,"nonblocking decision");
        var answered=await Post($"/v1/decisions/{id}/respond",new JsonObject{["choice"]="allow"});Check(answered.Bool("ok")&&backend.Pending.Length==0,"decision resolution");
        var invalid=await Post($"/v1/decisions/{id}/respond",new JsonObject{["choice"]="allow"});Check(!invalid.Bool("ok"),"decision cannot be answered twice");
        var permissionTask=Post("/hooks/claude",new JsonObject{["hook_event_name"]="PermissionRequest",["tool_name"]="Bash",["tool_input"]=new JsonObject{["command"]="npm test"}});
        for(int i=0;i<20&&backend.Pending.Length==0;i++)await Task.Delay(10);
        backend.Respond(backend.Pending[0].Id,"deny");var permission=await permissionTask;Check(permission?["hookSpecificOutput"]?["decision"].Text("behavior")=="deny","claude blocking hook");
        await Post("/hooks/codex",new JsonObject{["type"]="agent-turn-complete",["thread-id"]="test-thread",["last-assistant-message"]="完成"});Check(backend.History[0].Type=="success"&&backend.History[0].TaskId=="test-thread","codex completion hook");
        var removed=backend.History[0].Id;backend.DeleteEvent(removed);Check(Array.Find(backend.History,e=>e.Id==removed)==null,"notification deletion");
        Json.AtomicWrite(Path.Combine(Diagnostics.OutputPath,"native-self-test.json"),new{ok=true,checks});
    }
}
