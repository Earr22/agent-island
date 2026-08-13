const { EventEmitter } = require('node:events');
const { execFile } = require('node:child_process');

const AGENT_DEFINITIONS = [
  { id: 'codex', label: 'Codex', glyph: 'CX', processNames: ['codex.exe'], focusProcessNames: ['ChatGPT', 'codex'] },
  { id: 'claude', label: 'Claude', glyph: 'CL', processNames: ['claude.exe'], focusProcessNames: ['WindowsTerminal', 'powershell', 'cmd'] },
  { id: 'cursor', label: 'Cursor', glyph: 'CU', processNames: ['cursor.exe'], focusProcessNames: ['Cursor'] },
  { id: 'opencode', label: 'OpenCode', glyph: 'OC', processNames: ['opencode.exe'], focusProcessNames: ['OpenCode', 'WindowsTerminal'] },
  { id: 'windsurf', label: 'Windsurf', glyph: 'WS', processNames: ['windsurf.exe'], focusProcessNames: ['Windsurf'] }
];

function parseTasklistProcesses(output = '') {
  const processes = [];
  for (const line of String(output).split(/\r?\n/)) {
    const match = line.match(/^"([^"]+)","([^"]+)"/);
    if (!match) continue;
    const processId = Number.parseInt(match[2], 10);
    if (!Number.isFinite(processId)) continue;
    processes.push({ name: match[1].toLowerCase(), processId });
  }
  return processes;
}

function parseTasklistOutput(output = '') {
  const counts = new Map();
  for (const { name } of parseTasklistProcesses(output)) {
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return counts;
}

function detectActiveAgents(output = '') {
  const processes = parseTasklistProcesses(output);
  return AGENT_DEFINITIONS.flatMap((definition) => {
    const names = new Set(definition.processNames);
    const processIds = processes.filter((process) => names.has(process.name)).map((process) => process.processId);
    return processIds.length > 0 ? [{ ...definition, processCount: processIds.length, processIds }] : [];
  });
}

class AgentProcessMonitor extends EventEmitter {
  constructor({ intervalMs = 30000, runTasklist } = {}) {
    super();
    this.intervalMs = intervalMs;
    this.timer = null;
    this.polling = false;
    this.signature = null;
    this.runTasklist = runTasklist || (() => new Promise((resolve, reject) => {
      execFile('tasklist.exe', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true }, (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    }));
  }

  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      const agents = detectActiveAgents(await this.runTasklist());
      const signature = agents.map((agent) => `${agent.id}:${agent.processIds.join(',')}`).join('|');
      if (signature !== this.signature) {
        const initial = this.signature === null;
        this.signature = signature;
        this.emit('agents', agents, { initial });
      }
    } catch (error) {
      this.emit('error', error);
    } finally {
      this.polling = false;
    }
  }

  start() {
    if (this.timer) return;
    this.poll();
    this.timer = setInterval(() => this.poll(), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { AGENT_DEFINITIONS, AgentProcessMonitor, detectActiveAgents, parseTasklistOutput, parseTasklistProcesses };
