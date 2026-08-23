const http = require('node:http');
const { EventEmitter } = require('node:events');
const { URL } = require('node:url');
const { normalizeEvent, fromClaudeHook, fromCodexPayload } = require('./event-normalizer');

const MAX_BODY_BYTES = 512 * 1024;
const MAX_HISTORY = 120;
const MAX_DECISION_WAIT_MS = 15 * 60 * 1000;

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  response.end(body);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body is too large'), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Request body must be valid JSON'), { statusCode: 400 }));
      }
    });
    request.on('error', reject);
  });
}

class AgentIslandServer extends EventEmitter {
  constructor({ host = '127.0.0.1', port = 17321 } = {}) {
    super();
    this.host = host;
    this.port = port;
    this.httpServer = null;
    this.history = [];
    this.decisions = new Map();
    this.activeAgents = [];
    this.windowsNotificationState = null;
  }

  publish(input, defaults = {}) {
    const event = normalizeEvent(input, defaults);
    this.history.unshift(event);
    this.history = this.history.slice(0, MAX_HISTORY);
    this.emit('event', event);
    return event;
  }

  ask(input, { waitMs } = {}) {
    const event = this.publish({
      ...input,
      type: 'decision',
      ttl: 0,
      systemNotify: input.systemNotify ?? true,
      actions: input.actions?.length ? input.actions : [
            { id: 'allow', label: '允许', style: 'primary' },
            { id: 'deny', label: '拒绝', style: 'danger' }
      ]
    });

    const timeoutMs = Math.max(5000, Math.min(Number(waitMs || input.timeoutMs || 10 * 60 * 1000), MAX_DECISION_WAIT_MS));
    let resolveDecision;
    const result = new Promise((resolve) => { resolveDecision = resolve; });
    const record = {
      id: event.id,
      event,
      status: 'pending',
      createdAt: event.timestamp,
      respondedAt: null,
      choice: null,
      label: null,
      resolve: resolveDecision,
      timer: null
    };

    record.timer = setTimeout(() => {
      if (record.status !== 'pending') return;
      record.status = 'expired';
      record.respondedAt = new Date().toISOString();
      record.resolve({ id: record.id, status: 'expired', choice: null, label: null, respondedAt: record.respondedAt });
      this.emit('decision-resolved', this.publicDecision(record));
    }, timeoutMs);

    this.decisions.set(event.id, record);
    return { event, result };
  }

  publicDecision(record) {
    if (!record) return null;
    return {
      id: record.id,
      status: record.status,
      choice: record.choice,
      label: record.label,
      createdAt: record.createdAt,
      respondedAt: record.respondedAt,
      event: record.event
    };
  }

  respond(id, choice) {
    const record = this.decisions.get(String(id));
    if (!record) return { ok: false, statusCode: 404, error: 'Decision not found' };
    if (record.status !== 'pending') return { ok: false, statusCode: 409, error: `Decision is already ${record.status}`, decision: this.publicDecision(record) };

    const action = record.event.actions.find((item) => item.id === String(choice));
    if (!action) return { ok: false, statusCode: 400, error: 'Unknown choice' };

    clearTimeout(record.timer);
    record.status = 'answered';
    record.choice = action.id;
    record.label = action.label;
    record.respondedAt = new Date().toISOString();
    const result = { id: record.id, status: record.status, choice: record.choice, label: record.label, respondedAt: record.respondedAt };
    record.resolve(result);
    this.emit('decision-resolved', this.publicDecision(record));
    return { ok: true, statusCode: 200, decision: this.publicDecision(record) };
  }

  getState() {
    return {
      name: 'Agent Island',
      version: '0.11.1',
      listening: Boolean(this.httpServer),
      address: `http://${this.host}:${this.port}`,
      activeAgents: this.activeAgents,
      windowsNotifications: this.windowsNotificationState,
      pendingDecisions: [...this.decisions.values()].filter((item) => item.status === 'pending').map((item) => this.publicDecision(item)),
      latestEvent: this.history[0] || null
    };
  }

  async handleClaudeHook(payload, response) {
    const event = fromClaudeHook(payload);
    if (payload.hook_event_name !== 'PermissionRequest') {
      this.publish(event);
      sendJson(response, 200, {});
      return;
    }

    const { result } = this.ask(event, { waitMs: payload.timeout_ms });
    const decision = await result;
    if (decision.status !== 'answered') {
      sendJson(response, 200, {
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: 'Agent Island 等待决策超时。', interrupt: false }
        }
      });
      return;
    }

    if (decision.choice === 'allow') {
      sendJson(response, 200, {
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: { behavior: 'allow' }
        }
      });
      return;
    }

    sendJson(response, 200, {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: '用户在 Agent Island 中拒绝了这次操作。', interrupt: false }
      }
    });
  }

  async handleRequest(request, response) {
    if (request.method === 'OPTIONS') return sendJson(response, 403, { error: 'Browser cross-origin access is disabled' });
    const url = new URL(request.url, `http://${this.host}:${this.port}`);

    if (request.method === 'GET' && url.pathname === '/health') {
      return sendJson(response, 200, { ok: true, ...this.getState() });
    }
    if (request.method === 'GET' && url.pathname === '/v1/state') {
      return sendJson(response, 200, this.getState());
    }
    if (request.method === 'GET' && url.pathname === '/v1/history') {
      return sendJson(response, 200, { events: this.history });
    }

    const decisionMatch = url.pathname.match(/^\/v1\/decisions\/([^/]+)$/);
    if (request.method === 'GET' && decisionMatch) {
      const record = this.decisions.get(decodeURIComponent(decisionMatch[1]));
      return record ? sendJson(response, 200, this.publicDecision(record)) : sendJson(response, 404, { error: 'Decision not found' });
    }

    if (request.method === 'POST' && url.pathname === '/v1/events') {
      const payload = await readJson(request);
      const event = this.publish(payload);
      return sendJson(response, 202, { ok: true, event });
    }

    if (request.method === 'POST' && url.pathname === '/v1/decisions') {
      const payload = await readJson(request);
      const { event, result } = this.ask(payload, { waitMs: payload.timeoutMs });
      if (payload.wait === false) return sendJson(response, 202, { ok: true, decisionId: event.id, event });
      const decision = await result;
      return sendJson(response, decision.status === 'answered' ? 200 : 408, decision);
    }

    const respondMatch = url.pathname.match(/^\/v1\/decisions\/([^/]+)\/respond$/);
    if (request.method === 'POST' && respondMatch) {
      const payload = await readJson(request);
      const result = this.respond(decodeURIComponent(respondMatch[1]), payload.choice);
      return sendJson(response, result.statusCode, result);
    }

    if (request.method === 'POST' && url.pathname === '/hooks/claude') {
      const payload = await readJson(request);
      return this.handleClaudeHook(payload, response);
    }

    if (request.method === 'POST' && url.pathname === '/hooks/codex') {
      const payload = await readJson(request);
      const event = fromCodexPayload(payload);
      this.publish(event);
      return sendJson(response, 200, {});
    }

    return sendJson(response, 404, { error: 'Not found' });
  }

  start() {
    if (this.httpServer) return Promise.resolve(this.getState());
    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer((request, response) => {
        this.handleRequest(request, response).catch((error) => {
          if (!response.headersSent) sendJson(response, error.statusCode || 500, { error: error.message || 'Internal server error' });
          else response.end();
        });
      });
      this.httpServer.once('error', (error) => {
        this.httpServer = null;
        reject(error);
      });
      this.httpServer.listen(this.port, this.host, () => resolve(this.getState()));
    });
  }

  stop() {
    if (!this.httpServer) return Promise.resolve();
    const server = this.httpServer;
    this.httpServer = null;
    return new Promise((resolve) => server.close(resolve));
  }
}

module.exports = { AgentIslandServer };
