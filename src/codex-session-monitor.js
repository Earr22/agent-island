const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const END_EVENT_TYPES = new Set([
  'task_complete',
  'turn_aborted',
  'turn_cancelled',
  'turn_canceled',
  'task_cancelled',
  'task_canceled'
]);

function cleanPrompt(value, maxLength = 520) {
  if (typeof value !== 'string') return '';
  return value.replace(/\u0000/g, '').trim().slice(0, maxLength);
}

function sessionIdFromPath(filePath = '') {
  const name = path.basename(filePath, path.extname(filePath));
  const match = name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return match?.[1] || name;
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeQuotaWindow(limit, id) {
  const usedPercent = finiteNumber(limit?.used_percent);
  if (usedPercent === null) return null;
  const clampedUsed = Math.max(0, Math.min(100, usedPercent));
  return {
    id,
    usedPercent: clampedUsed,
    remainingPercent: Math.max(0, Math.min(100, 100 - clampedUsed)),
    windowMinutes: finiteNumber(limit?.window_minutes),
    resetsAt: finiteNumber(limit?.resets_at)
  };
}

function usageFromRecord(record = {}) {
  if (record?.type !== 'event_msg' || record.payload?.type !== 'token_count') return null;
  const info = record.payload?.info || {};
  const limits = record.payload?.rate_limits || {};
  const primary = limits.primary || null;
  const secondary = limits.secondary || null;
  const credits = limits.credits || null;
  const windows = [
    normalizeQuotaWindow(primary, 'primary'),
    normalizeQuotaWindow(secondary, 'secondary')
  ].filter(Boolean);
  const currentWindow = windows[0] || null;
  const usedPercent = currentWindow?.usedPercent ?? null;
  const contextWindow = finiteNumber(info.model_context_window);
  const lastTokens = finiteNumber(info.last_token_usage?.total_tokens);
  const contextUsedPercent = contextWindow && lastTokens !== null
    ? Math.max(0, Math.min(100, lastTokens / contextWindow * 100))
    : null;
  return {
    kind: 'usage',
    agentId: 'codex',
    label: 'Codex',
    available: usedPercent !== null,
    usedPercent: usedPercent === null ? null : Math.max(0, Math.min(100, usedPercent)),
    remainingPercent: usedPercent === null ? null : Math.max(0, Math.min(100, 100 - usedPercent)),
    windowMinutes: currentWindow?.windowMinutes ?? null,
    resetsAt: currentWindow?.resetsAt ?? null,
    windows,
    planType: String(limits.plan_type || ''),
    creditBalance: finiteNumber(credits?.balance),
    hasCredits: Boolean(credits?.has_credits),
    unlimitedCredits: Boolean(credits?.unlimited),
    contextUsedPercent,
    contextWindow,
    lastTokens,
    updatedAt: record.timestamp || new Date().toISOString()
  };
}

function eventFromLine(line = '') {
  try {
    const record = JSON.parse(line);
    const usage = usageFromRecord(record);
    if (usage) return usage;
    if (record?.type !== 'event_msg') return null;
    const eventType = String(record.payload?.type || '');
    if (eventType === 'task_started') {
      return {
        kind: 'start',
        turnId: String(record.payload?.turn_id || ''),
        timestamp: record.timestamp || ''
      };
    }
    if (eventType === 'user_message') {
      return {
        kind: 'prompt',
        message: cleanPrompt(record.payload?.message),
        timestamp: record.timestamp || ''
      };
    }
    if (END_EVENT_TYPES.has(eventType)) {
      return {
        kind: 'complete',
        turnId: String(record.payload?.turn_id || ''),
        timestamp: record.timestamp || '',
        eventType
      };
    }
  } catch {}
  return null;
}

async function listSessionFiles(root) {
  const files = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return walk(fullPath);
      if (!entry.isFile() || !/^rollout-.*\.jsonl$/i.test(entry.name)) return;
      try {
        const stat = await fs.promises.stat(fullPath);
        files.push({ filePath: fullPath, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {}
    }));
  }
  await walk(root);
  return files;
}

async function readRange(filePath, start, length) {
  if (length <= 0) return '';
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

class CodexSessionMonitor extends EventEmitter {
  constructor({
    sessionsRoot,
    pollMs = 2500,
    discoveryMs = 10000,
    noWatchPollMs = 2500,
    watchDebounceMs = 350,
    maxFiles = 8,
    initialReadBytes = 2 * 1024 * 1024,
    staleActiveMs = 2 * 60 * 60 * 1000,
    now = () => Date.now()
  } = {}) {
    super();
    this.sessionsRoot = sessionsRoot;
    this.pollMs = pollMs;
    this.discoveryMs = discoveryMs;
    this.noWatchPollMs = noWatchPollMs;
    this.watchDebounceMs = watchDebounceMs;
    this.maxFiles = maxFiles;
    this.initialReadBytes = initialReadBytes;
    this.staleActiveMs = staleActiveMs;
    this.now = now;
    this.files = new Map();
    this.timer = null;
    this.watchTimer = null;
    this.watcher = null;
    this.polling = false;
    this.pendingPoll = false;
    this.forceDiscovery = false;
    this.dirtyFiles = new Set();
    this.lastDiscoveryAt = 0;
    this.lastSignature = null;
    this.lastUsageSignature = null;
    this.lastStatus = null;
  }

  makeFileState(filePath) {
    return {
      filePath,
      sessionId: sessionIdFromPath(filePath),
      offset: 0,
      partial: '',
      activeTurns: new Map(),
      latestTurnId: '',
      usage: null,
      lastWriteMs: 0
    };
  }

  applyEvent(fileState, event) {
    if (!event) return;
    if (event.kind === 'usage') {
      fileState.usage = event;
      return;
    }
    if (event.kind === 'start') {
      const turnId = event.turnId || `${fileState.sessionId}:${event.timestamp || fileState.lastWriteMs}`;
      // A Codex thread executes one foreground turn at a time. If the user
      // steers or interrupts it, Desktop can start the replacement turn
      // without writing task_complete for the superseded one.
      fileState.activeTurns.clear();
      fileState.latestTurnId = turnId;
      fileState.activeTurns.set(turnId, {
        turnId,
        sessionId: fileState.sessionId,
        prompt: '',
        startedAt: event.timestamp || '',
        updatedAt: event.timestamp || ''
      });
      return;
    }
    if (event.kind === 'prompt') {
      const current = fileState.activeTurns.get(fileState.latestTurnId);
      if (current && event.message) {
        current.prompt = event.message;
        current.updatedAt = event.timestamp || current.updatedAt;
      }
      return;
    }
    if (event.kind === 'complete') {
      if (event.turnId) fileState.activeTurns.delete(event.turnId);
      else if (fileState.latestTurnId) fileState.activeTurns.delete(fileState.latestTurnId);
      if (event.turnId === fileState.latestTurnId || !event.turnId) {
        fileState.latestTurnId = [...fileState.activeTurns.keys()].at(-1) || '';
      }
    }
  }

  processText(fileState, text, { discardFirstLine = false } = {}) {
    let input = `${fileState.partial}${text}`;
    fileState.partial = '';
    if (discardFirstLine) {
      const firstNewline = input.indexOf('\n');
      input = firstNewline >= 0 ? input.slice(firstNewline + 1) : '';
    }
    const endsWithNewline = input.endsWith('\n');
    const lines = input.split(/\r?\n/);
    if (!endsWithNewline) fileState.partial = lines.pop() || '';
    for (const line of lines) this.applyEvent(fileState, eventFromLine(line));
  }

  async addFile(file) {
    const state = this.makeFileState(file.filePath);
    state.lastWriteMs = file.mtimeMs;
    const start = Math.max(0, file.size - this.initialReadBytes);
    const text = await readRange(file.filePath, start, file.size - start);
    this.processText(state, text, { discardFirstLine: start > 0 });
    state.offset = file.size;
    this.files.set(file.filePath, state);
  }

  async discover() {
    const recent = (await listSessionFiles(this.sessionsRoot))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, this.maxFiles);
    const keep = new Set(recent.map((file) => file.filePath));
    for (const filePath of this.files.keys()) {
      if (!keep.has(filePath)) this.files.delete(filePath);
    }
    for (const file of recent) {
      if (!this.files.has(file.filePath)) await this.addFile(file);
    }
    this.lastDiscoveryAt = this.now();
    this.forceDiscovery = false;
  }

  async readUpdates(filePaths = null) {
    const states = filePaths
      ? [...filePaths].map((filePath) => this.files.get(filePath)).filter(Boolean)
      : [...this.files.values()];
    for (const state of states) {
      try {
        const stat = await fs.promises.stat(state.filePath);
        state.lastWriteMs = stat.mtimeMs;
        if (stat.size < state.offset) {
          this.files.delete(state.filePath);
          continue;
        }
        if (stat.size === state.offset) continue;
        const text = await readRange(state.filePath, state.offset, stat.size - state.offset);
        state.offset = stat.size;
        this.processText(state, text);
      } catch (error) {
        this.emit('error', error);
      }
    }
  }

  aggregateState() {
    const active = [];
    const cutoff = this.now() - this.staleActiveMs;
    for (const state of this.files.values()) {
      if (state.lastWriteMs < cutoff) continue;
      for (const turn of state.activeTurns.values()) {
        active.push({ ...turn, lastWriteMs: state.lastWriteMs });
      }
    }
    active.sort((a, b) => b.lastWriteMs - a.lastWriteMs);
    const current = active[0];
    if (!current) {
      return {
        status: 'idle',
      label: '空闲',
      title: 'Codex 当前空闲',
      message: '已连接，当前没有活动任务。',
        taskId: '',
        activeCount: 0,
        updatedAt: new Date(this.now()).toISOString()
      };
    }
    return {
      status: 'working',
    label: '工作中',
    title: active.length > 1 ? `Codex 正在处理 ${active.length} 个任务` : 'Codex 正在工作',
    message: current.prompt || '正在处理真实任务…',
      taskId: current.turnId || current.sessionId,
      sessionId: current.sessionId,
      activeCount: active.length,
      updatedAt: new Date(Math.max(current.lastWriteMs, this.now())).toISOString()
    };
  }

  emitState() {
    if (this.files.size === 0) return;
    const state = this.aggregateState();
    const signature = JSON.stringify([state.status, state.taskId, state.message, state.activeCount]);
    if (signature === this.lastSignature) return;
    const initial = this.lastStatus === null;
    const transition = initial
      ? 'initial'
      : (this.lastStatus !== state.status ? (state.status === 'working' ? 'start' : 'complete') : 'update');
    this.lastSignature = signature;
    this.lastStatus = state.status;
    this.emit('state', state, { initial, transition });
  }

  emitUsage() {
    const latest = [...this.files.values()]
      .map((state) => state.usage)
      .filter(Boolean)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
    if (!latest) return;
    const signature = JSON.stringify(latest);
    if (signature === this.lastUsageSignature) return;
    this.lastUsageSignature = signature;
    this.emit('usage', latest);
  }

  async poll({ forceDiscover = false } = {}) {
    if (forceDiscover) this.forceDiscovery = true;
    if (this.polling) {
      this.pendingPoll = true;
      return;
    }
    this.polling = true;
    try {
      const dirtyFiles = new Set(this.dirtyFiles);
      this.dirtyFiles.clear();
      const shouldDiscover = this.forceDiscovery || !this.lastDiscoveryAt || this.now() - this.lastDiscoveryAt >= this.discoveryMs;
      if (shouldDiscover) await this.discover();
      await this.readUpdates(shouldDiscover || dirtyFiles.size === 0 ? null : dirtyFiles);
      this.emitState();
      this.emitUsage();
    } catch (error) {
      this.emit('error', error);
    } finally {
      this.polling = false;
      if (this.pendingPoll) {
        this.pendingPoll = false;
        this.schedulePoll();
      }
    }
  }

  schedulePoll({ forceDiscover = false, changedPath = '' } = {}) {
    if (forceDiscover) this.forceDiscovery = true;
    if (changedPath) this.dirtyFiles.add(changedPath);
    clearTimeout(this.watchTimer);
    this.watchTimer = setTimeout(() => {
      this.watchTimer = null;
      this.poll();
    }, this.watchDebounceMs);
    this.watchTimer.unref?.();
  }

  startFallbackTimer(intervalMs, { forceDiscover = false } = {}) {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.poll({ forceDiscover }), intervalMs);
    this.timer.unref?.();
  }

  startWatcher() {
    try {
      this.watcher = fs.watch(this.sessionsRoot, { recursive: true, persistent: false }, (_eventType, filename) => {
        if (!filename || !/^.*rollout-.*\.jsonl$/i.test(String(filename))) return;
        const changedPath = path.resolve(this.sessionsRoot, String(filename));
        this.schedulePoll({ forceDiscover: !this.files.has(changedPath), changedPath });
      });
      this.watcher.on('error', (error) => {
        this.emit('error', error);
        this.watcher?.close();
        this.watcher = null;
        this.startFallbackTimer(this.noWatchPollMs, { forceDiscover: true });
      });
      this.watcher.unref?.();
      // Windows can occasionally drop recursive fs.watch events. Recheck the
      // handful of known session files frequently, while keeping the more
      // expensive recursive discovery on its separate, slower schedule.
      this.startFallbackTimer(this.pollMs);
      return true;
    } catch (error) {
      this.emit('error', error);
      this.watcher = null;
      this.startFallbackTimer(this.noWatchPollMs, { forceDiscover: true });
      return false;
    }
  }

  start() {
    if (this.timer || this.watcher) return;
    this.poll({ forceDiscover: true });
    this.startWatcher();
  }

  stop() {
    clearInterval(this.timer);
    clearTimeout(this.watchTimer);
    this.watcher?.close();
    this.timer = null;
    this.watchTimer = null;
    this.watcher = null;
  }
}

module.exports = {
  CodexSessionMonitor,
  cleanPrompt,
  eventFromLine,
  usageFromRecord,
  sessionIdFromPath
};
