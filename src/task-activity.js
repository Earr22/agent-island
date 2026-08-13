const AGENT_SOURCES = new Set(['codex', 'claude', 'cursor', 'opencode', 'windsurf', 'gemini']);

const SOURCE_LABELS = {
  codex: 'Codex',
  claude: 'Claude',
  cursor: 'Cursor',
  opencode: 'OpenCode',
  windsurf: 'Windsurf',
  gemini: 'Gemini'
};

class AgentTaskTracker {
  constructor({ now = () => new Date() } = {}) {
    this.now = now;
    this.records = new Map();
  }

  isAgentSource(source) {
    return AGENT_SOURCES.has(String(source || '').toLowerCase());
  }

  ensure(source) {
    const id = String(source || '').toLowerCase();
    if (!this.records.has(id)) {
      this.records.set(id, {
        source: id,
        parentActive: false,
        subagentCount: 0,
        public: this.makePublic(id, 'idle')
      });
    }
    return this.records.get(id);
  }

  makePublic(source, status, event = {}) {
    const label = status === 'working' ? 'Working' : (status === 'waiting' ? 'Waiting' : 'Idle');
    const sourceLabel = SOURCE_LABELS[source] || source || 'Agent';
    return {
      status,
      label,
      title: event.title || (status === 'idle' ? `${sourceLabel} is idle` : `${sourceLabel} · ${label}`),
      message: event.message || (status === 'idle' ? 'Connected with no active task.' : ''),
      taskId: event.taskId || '',
      updatedAt: this.now().toISOString()
    };
  }

  connect(source) {
    if (!this.isAgentSource(source)) return null;
    return { ...this.ensure(source).public };
  }

  setExternalState(source, state = {}) {
    if (!this.isAgentSource(source)) return null;
    const record = this.ensure(source);
    const status = ['working', 'waiting', 'idle'].includes(state.status) ? state.status : 'idle';
    record.parentActive = status === 'working';
    if (status === 'idle') record.subagentCount = 0;
    record.public = {
      ...this.makePublic(record.source, status, state),
      ...state,
      status,
      label: state.label || (status === 'working' ? 'Working' : (status === 'waiting' ? 'Waiting' : 'Idle'))
    };
    return { ...record.public };
  }

  updateFromEvent(event = {}) {
    const source = String(event.source || '').toLowerCase();
    if (!this.isAgentSource(source)) return null;
    const record = this.ensure(source);
    const hookName = event.context?.hookEventName || '';

    if (event.context?.presenceOnly || hookName === 'SessionStart') {
      record.parentActive = false;
      record.subagentCount = 0;
      record.public = this.makePublic(source, 'idle', event);
      return { ...record.public };
    }

    if (hookName === 'SubagentStart') {
      record.subagentCount += 1;
      record.public = this.makePublic(source, 'working', event);
      return { ...record.public };
    }

    if (hookName === 'SubagentStop') {
      record.subagentCount = Math.max(0, record.subagentCount - 1);
      const status = record.parentActive || record.subagentCount > 0 ? 'working' : 'idle';
      record.public = this.makePublic(source, status, status === 'working' ? { ...event, title: `${SOURCE_LABELS[source] || source} continues working` } : event);
      return { ...record.public };
    }

    if (hookName === 'Stop' || hookName === 'TaskCompleted' || hookName === 'agent-turn-complete') {
      record.parentActive = false;
      record.subagentCount = 0;
      record.public = this.makePublic(source, 'idle', event);
      return { ...record.public };
    }

    if (['decision', 'warning'].includes(event.type)) {
      record.public = this.makePublic(source, 'waiting', event);
      return { ...record.public };
    }

    if (['working', 'progress'].includes(event.type)) {
      record.parentActive = true;
      record.public = this.makePublic(source, 'working', event);
      return { ...record.public };
    }

    if (['success', 'error'].includes(event.type)) {
      record.parentActive = false;
      record.subagentCount = 0;
      record.public = this.makePublic(source, 'idle', event);
      return { ...record.public };
    }

    return { ...record.public };
  }

  resolveDecision(decision = {}) {
    const source = decision.event?.source;
    if (!this.isAgentSource(source)) return null;
    const record = this.ensure(source);
    if (decision.status === 'answered' && decision.choice !== 'deny') {
      record.parentActive = true;
      record.public = this.makePublic(source, 'working', {
        ...decision.event,
        title: `${SOURCE_LABELS[source] || source} continues working`,
        message: 'Decision received. The task is continuing.'
      });
    } else {
      record.parentActive = false;
      record.subagentCount = 0;
      record.public = this.makePublic(source, 'idle', decision.event);
    }
    return { ...record.public };
  }

  get(source) {
    if (!this.isAgentSource(source)) return null;
    return { ...this.ensure(source).public };
  }

  mergeAgents(agents = []) {
    return agents.map((agent) => ({ ...agent, taskState: this.connect(agent.id) }));
  }
}

module.exports = { AgentTaskTracker, AGENT_SOURCES };
