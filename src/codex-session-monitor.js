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

function eventFromLine(line = '') {
  try {
    const record = JSON.parse(line);
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
    pollMs = 15000,
    discoveryMs = 30000,
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
      lastWriteMs: 0
    };
  }

  applyEvent(fileState, event) {
    if (!event) return;
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
        label: 'Idle',
        title: 'Codex is idle',
        message: 'Connected with no active task.',
        taskId: '',
        activeCount: 0,
        updatedAt: new Date(this.now()).toISOString()
      };
    }
    return {
      status: 'working',
      label: 'Working',
      title: active.length > 1 ? `Codex is handling ${active.length} tasks` : 'Codex is working',
      message: current.prompt || 'Processing a task…',
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

  startFallbackTimer(intervalMs) {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.poll({ forceDiscover: true }), intervalMs);
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
        this.startFallbackTimer(this.noWatchPollMs);
      });
      this.watcher.unref?.();
      this.startFallbackTimer(this.pollMs);
      return true;
    } catch (error) {
      this.emit('error', error);
      this.watcher = null;
      this.startFallbackTimer(this.noWatchPollMs);
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
  sessionIdFromPath
};
