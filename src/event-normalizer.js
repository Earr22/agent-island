const crypto = require('node:crypto');

const SOURCES = {
  codex: { label: 'Codex', color: '#78a8ff', glyph: 'CX' },
  claude: { label: 'Claude', color: '#e8a46a', glyph: 'CL' },
  cursor: { label: 'Cursor', color: '#c5f66f', glyph: 'CU' },
  opencode: { label: 'OpenCode', color: '#8ee8d1', glyph: 'OC' },
  gemini: { label: 'Gemini', color: '#8ca8ff', glyph: 'GM' },
  system: { label: 'Windows', color: '#70d7ff', glyph: 'W' },
  generic: { label: 'Agent', color: '#a8b5ff', glyph: 'AI' }
};

const TYPE_ALIASES = {
  running: 'working', started: 'working', start: 'working', thinking: 'working', pending: 'working',
  complete: 'success', completed: 'success', done: 'success', finished: 'success',
  failed: 'error', failure: 'error', warning: 'warning', approval: 'decision',
  permission: 'decision', question: 'decision', info: 'notification', notify: 'notification'
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function cleanString(value, fallback = '', maxLength = 1000) {
  if (value === undefined || value === null) return fallback;
  return String(value).replace(/\u0000/g, '').trim().slice(0, maxLength) || fallback;
}

function sourceMeta(source) {
  const key = cleanString(source, 'generic', 32).toLowerCase();
  return { key, ...(SOURCES[key] || SOURCES.generic) };
}

function normalizeType(type) {
  const key = cleanString(type, 'notification', 32).toLowerCase();
  const normalized = TYPE_ALIASES[key] || key;
  return ['working', 'progress', 'success', 'error', 'warning', 'decision', 'notification'].includes(normalized)
    ? normalized
    : 'notification';
}

function normalizeActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions.slice(0, 5).map((action, index) => {
    if (typeof action === 'string') {
      return { id: action.toLowerCase().replace(/\s+/g, '-').slice(0, 32) || `choice-${index + 1}`, label: action, style: index === 0 ? 'primary' : 'secondary' };
    }
    return {
      id: cleanString(action?.id ?? action?.value, `choice-${index + 1}`, 64),
      label: cleanString(action?.label ?? action?.title ?? action?.id, `Option ${index + 1}`, 80),
      style: ['primary', 'secondary', 'danger'].includes(action?.style) ? action.style : (index === 0 ? 'primary' : 'secondary'),
      hint: cleanString(action?.hint, '', 160)
    };
  });
}

function normalizeEvent(payload = {}, defaults = {}) {
  const source = sourceMeta(payload.source || defaults.source);
  const type = normalizeType(payload.type || defaults.type);
  const rawProgress = Number(payload.progress);
  const progress = Number.isFinite(rawProgress) ? clamp(rawProgress > 1 ? rawProgress : rawProgress * 100, 0, 100) : null;
  const ttlDefault = ['decision', 'error'].includes(type) ? 0 : (type === 'working' ? 0 : 6000);
  const ttl = clamp(Number(payload.ttl ?? defaults.ttl ?? ttlDefault) || 0, 0, 60 * 60 * 1000);
  const actions = normalizeActions(payload.actions || defaults.actions);

  return {
    id: cleanString(payload.id, crypto.randomUUID(), 100),
    source: source.key,
    sourceLabel: cleanString(payload.sourceLabel, source.label, 40),
    sourceColor: cleanString(payload.sourceColor, source.color, 32),
    sourceGlyph: cleanString(payload.sourceGlyph, source.glyph, 4),
    type,
    title: cleanString(payload.title, defaults.title || `${source.label} notification`, 140),
    message: cleanString(payload.message ?? payload.body, defaults.message || '', 1200),
    detail: cleanString(payload.detail, defaults.detail || '', 2400),
    taskId: cleanString(payload.taskId ?? payload.task_id, defaults.taskId || '', 160),
    progress,
    ttl,
    systemNotify: payload.systemNotify ?? defaults.systemNotify ?? ['decision', 'error', 'success'].includes(type),
    silent: Boolean(payload.silent ?? defaults.silent),
    actions,
    timestamp: new Date().toISOString(),
    context: payload.context && typeof payload.context === 'object' ? payload.context : {}
  };
}

function summarizeToolInput(toolInput = {}) {
  if (!toolInput || typeof toolInput !== 'object') return '';
  return cleanString(toolInput.description || toolInput.command || toolInput.file_path || toolInput.path || JSON.stringify(toolInput), '', 520);
}

function fromClaudeHook(payload = {}) {
  const eventName = cleanString(payload.hook_event_name, 'Notification', 64);
  const toolName = cleanString(payload.tool_name, '', 100);
  const base = { source: 'claude', taskId: payload.session_id, context: { hookEventName: eventName, cwd: payload.cwd, toolName, raw: payload } };

  if (eventName === 'PermissionRequest') {
    return normalizeEvent({
      ...base,
      type: 'decision',
      title: `${toolName || 'Tool'} needs your approval`,
      message: summarizeToolInput(payload.tool_input) || 'Claude is waiting for you to decide whether to continue.',
      detail: cleanString(payload.cwd, '', 320),
      actions: [
        { id: 'allow', label: 'Allow', style: 'primary' },
        { id: 'deny', label: 'Deny', style: 'danger' }
      ],
      systemNotify: true
    });
  }

  if (eventName === 'SessionStart') {
    return normalizeEvent({ ...base, type: 'success', title: 'Claude connected', message: 'No active task.', silent: true, systemNotify: false, context: { ...base.context, presenceOnly: true } });
  }

  if (eventName === 'Notification') {
    const notificationType = cleanString(payload.notification_type, 'notification', 64);
    const type = ['permission_prompt', 'agent_needs_input', 'elicitation_dialog'].includes(notificationType)
      ? 'warning'
      : (notificationType === 'agent_completed' ? 'success' : 'notification');
    return normalizeEvent({
      ...base,
      type,
      title: payload.title || (notificationType === 'agent_needs_input' ? 'Claude is waiting for input' : 'Claude notification'),
      message: payload.message || notificationType.replaceAll('_', ' '),
      systemNotify: ['permission_prompt', 'agent_needs_input', 'agent_completed'].includes(notificationType)
    });
  }

  if (eventName === 'Stop' || eventName === 'SubagentStop' || eventName === 'TaskCompleted') {
    return normalizeEvent({ ...base, type: 'success', title: eventName === 'SubagentStop' ? 'Claude subtask completed' : 'Claude completed', message: payload.last_assistant_message || payload.task_subject || 'This task has finished.' });
  }

  if (eventName === 'PostToolUseFailure' || eventName === 'StopFailure') {
    return normalizeEvent({ ...base, type: 'error', title: 'Claude ran into a problem', message: payload.error || 'The task failed.', detail: summarizeToolInput(payload.tool_input) });
  }

  if (eventName === 'SubagentStart' || eventName === 'TaskCreated' || eventName === 'UserPromptSubmit') {
    return normalizeEvent({ ...base, type: 'working', title: eventName === 'SubagentStart' ? `${payload.agent_type || 'Subagent'} started` : 'Claude is working', message: payload.prompt || payload.task_subject || cleanString(payload.cwd, 'Processing task…', 320), systemNotify: false });
  }

  return normalizeEvent({ ...base, type: 'notification', title: `Claude · ${eventName}`, message: summarizeToolInput(payload.tool_input) || payload.message || '' });
}

function fromCodexPayload(payload = {}) {
  const eventName = cleanString(payload.hook_event_name || payload.type, 'agent-turn-complete', 80);
  const isPresence = eventName === 'SessionStart';
  const isPermission = eventName === 'PermissionRequest' || eventName === 'approval-requested';
  const isComplete = eventName === 'Stop' || eventName === 'SubagentStop' || eventName === 'agent-turn-complete';
  const isStart = eventName === 'SubagentStart' || eventName === 'UserPromptSubmit';
  const isFailure = eventName === 'PostToolUseFailure' || eventName === 'StopFailure';

  let title = `Codex · ${eventName}`;
  if (isPresence) title = 'Codex connected';
  else if (isPermission) title = 'Codex is waiting for approval';
  else if (isComplete) title = eventName === 'SubagentStop' ? 'Codex subtask completed' : 'Codex completed';
  else if (isStart) title = eventName === 'SubagentStart' ? 'Codex subagent is working' : 'Codex is working';
  else if (isFailure) title = 'Codex ran into a problem';

  return normalizeEvent({
    source: 'codex',
    taskId: payload.session_id || payload['thread-id'] || payload.thread_id,
    type: isPermission ? 'warning' : (isPresence || isComplete ? 'success' : (isStart ? 'working' : (isFailure ? 'error' : 'notification'))),
    title,
    message: payload['last-assistant-message'] || payload.last_assistant_message || payload.prompt || payload.error || summarizeToolInput(payload.tool_input) || cleanString(payload.cwd, 'Status updated', 320),
    detail: isPermission ? 'Return to Codex to approve or deny this request.' : '',
    silent: isPresence,
    systemNotify: !isPresence && (isPermission || isComplete),
    context: { hookEventName: eventName, cwd: payload.cwd, raw: payload, presenceOnly: isPresence }
  });
}

module.exports = { normalizeActions, normalizeEvent, fromClaudeHook, fromCodexPayload, summarizeToolInput };
