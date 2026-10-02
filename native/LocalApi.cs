using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;

namespace AgentIsland;

// Loopback-only HTTP without HTTP.sys URL ACLs or administrator privileges.
sealed class LocalApi : IDisposable
{
    readonly Backend backend;
    readonly CancellationTokenSource stop = new();
    readonly SemaphoreSlim slots = new(32);
    TcpListener? listener;
    public int Port { get; private set; }
    public LocalApi(Backend backend) => this.backend = backend;
    public void Start(int port)
    {
        listener = new(IPAddress.Loopback, port); listener.Start(); Port = ((IPEndPoint)listener.LocalEndpoint).Port;
        _ = Task.Run(async () =>
        {
            while (!stop.IsCancellationRequested)
            {
                try { var client = await listener.AcceptTcpClientAsync(stop.Token); if (!await slots.WaitAsync(0)) { client.Dispose(); continue; } _ = Handle(client); }
                catch (OperationCanceledException) { break; } catch (SocketException) when (stop.IsCancellationRequested) { break; }
            }
        });
    }
    async Task Handle(TcpClient client)
    {
        using (client)
        {
            try
            {
                using var stream = client.GetStream();
                using var readStop = CancellationTokenSource.CreateLinkedTokenSource(stop.Token); readStop.CancelAfter(10000);
                using var header = new MemoryStream(); var one = new byte[1]; var end = 0;
                while (header.Length < 16384)
                {
                    if (await stream.ReadAsync(one, readStop.Token) == 0) return;
                    header.WriteByte(one[0]);
                    end = (end << 8) | one[0]; if (end == 0x0d0a0d0a) break;
                }
                if (end != 0x0d0a0d0a) return;
                var lines = Encoding.ASCII.GetString(header.ToArray()).Split("\r\n");
                var request = lines[0].Split(' '); if (request.Length < 2) return;
                int size = 0;
                foreach (var line in lines) if (line.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase)) int.TryParse(line[15..].Trim(), out size);
                if (size < 0 || size > 512 * 1024) { await Send(stream, 413, new { error = "Request body too large" }); return; }
                var bytes = new byte[size]; if (size > 0) await stream.ReadExactlyAsync(bytes, readStop.Token);
                if (Array.Exists(lines, line => line.StartsWith("Origin:", StringComparison.OrdinalIgnoreCase)))
                {
                    await Send(stream, 403, new { error = "Browser cross-origin access is disabled" }); return;
                }
                JsonNode p;
                try { p = size == 0 ? new JsonObject() : JsonNode.Parse(bytes)!; if(p is not JsonObject) { await Send(stream, 400, new { error = "Expected a JSON object" }); return; } }
                catch (System.Text.Json.JsonException) { await Send(stream, 400, new { error = "Invalid JSON" }); return; }
                readStop.CancelAfter(Timeout.Infinite);
                var method = request[0]; var path = request[1].Split('?')[0]; int status = 200; object result;
                if (method == "GET" && path is "/health" or "/v1/state") result = backend.State;
                else if (method == "GET" && path == "/v1/history") result = new { events = backend.History };
                else if (method == "POST" && path == "/v1/events") { result = new { ok = true, @event = backend.Publish(p) }; status = 202; }
                else if (method == "POST" && path == "/v1/decisions")
                {
                    var d = backend.Ask(p); if (p["wait"] != null && !p.Bool("wait")) { result = new { ok = true, decisionId = d.Id, @event = d.Event }; status = 202; }
                    else { result = await d.Completion.Task.WaitAsync(stop.Token); status = d.Status == "answered" ? 200 : 408; }
                }
                else if (method == "POST" && path is "/hooks/claude" or "/hooks/codex")
                {
                    var source = path.EndsWith("claude") ? "claude" : "codex"; var e = backend.Hook(p, source);
                    if (source == "claude" && p.Text("hook_event_name") == "PermissionRequest")
                    {
                        e["timeoutMs"] = p.Number("timeout_ms", 600000);
                        var d = backend.Ask(e); await d.Completion.Task.WaitAsync(stop.Token);
                        result = new { hookSpecificOutput = new { hookEventName = "PermissionRequest", decision = new { behavior = d.Choice == "allow" ? "allow" : "deny", message = d.Choice == "allow" ? "" : "用户拒绝或决策超时", interrupt = false } } };
                    }
                    else { backend.Publish(e); result = new { }; }
                }
                else if (path.StartsWith("/v1/decisions/"))
                {
                    var segments = path.Split('/'); var id = Uri.UnescapeDataString(segments[3]);
                    if (method == "POST" && segments.Length == 5 && segments[4] == "respond") { var ok = backend.Respond(id, p.Text("choice")); result = new { ok, decision = backend.GetDecision(id) }; status = ok ? 200 : 409; }
                    else if (method == "GET" && segments.Length == 4) { result = (object?)backend.GetDecision(id) ?? new { error = "Decision not found" }; status = backend.GetDecision(id) == null ? 404 : 200; }
                    else { result = new { error = "Not found" }; status = 404; }
                }
                else { result = new { error = "Not found" }; status = method == "OPTIONS" ? 403 : 404; }
                await Send(stream, status, result);
            }
            catch (OperationCanceledException) { }
            catch (IOException) { }
            catch (Exception ex) { Diagnostics.Log("local-api", ex.Message); }
            finally { slots.Release(); }
        }
    }
    static async Task Send(NetworkStream stream, int status, object payload)
    {
        var body = Encoding.UTF8.GetBytes(Json.Write(payload));
        var header = Encoding.ASCII.GetBytes($"HTTP/1.1 {status} Result\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {body.Length}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n");
        await stream.WriteAsync(header); await stream.WriteAsync(body);
    }
    public void Dispose() { stop.Cancel(); listener?.Stop(); }
}
