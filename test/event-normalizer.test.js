const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEvent, fromClaudeHook, fromCodexPayload } = require('../src/event-normalizer');

test('normalizes progress values and source metadata', () => {
  const event = normalizeEvent({ source: 'codex', type: 'progress', title: 'Build', progress: 0.42 });
  assert.equal(event.sourceLabel, 'Codex');
  assert.equal(event.progress, 42);
  assert.equal(event.type, 'progress');
  assert.equal(event.systemNotify, false);
});

test('maps Claude permission requests to a decision card', () => {
  const event = fromClaudeHook({
    hook_event_name: 'PermissionRequest',
    session_id: 'abc',
    tool_name: 'Bash',
    tool_input: { command: 'npm test', description: 'Run tests' }
  });
  assert.equal(event.type, 'decision');
  assert.equal(event.taskId, 'abc');
  assert.deepEqual(event.actions.map((action) => action.id), ['allow', 'deny']);
  assert.match(event.message, /Run tests/);
});

test('maps Claude prompt submission to a working state', () => {
  const event = fromClaudeHook({
    hook_event_name: 'UserPromptSubmit',
    session_id: 'claude-live',
    prompt: '继续当前任务'
  });
  assert.equal(event.type, 'working');
  assert.equal(event.title, 'Claude 正在工作');
  assert.equal(event.message, '继续当前任务');
});

test('maps Claude SessionStart to idle presence instead of work', () => {
  const event = fromClaudeHook({ hook_event_name: 'SessionStart', session_id: 'claude-ready' });
  assert.equal(event.type, 'success');
  assert.equal(event.context.presenceOnly, true);
  assert.equal(event.systemNotify, false);
});

test('maps Codex completion payloads', () => {
  const event = fromCodexPayload({
    type: 'agent-turn-complete',
    'thread-id': 'thread-1',
    'last-assistant-message': 'All tests passed.'
  });
  assert.equal(event.type, 'success');
  assert.equal(event.taskId, 'thread-1');
  assert.equal(event.message, 'All tests passed.');
});

test('maps Codex prompt submission to a working state', () => {
  const event = fromCodexPayload({
    hook_event_name: 'UserPromptSubmit',
    session_id: 'thread-live',
    cwd: 'D:\\workspace',
    prompt: '修复通知联动'
  });
  assert.equal(event.type, 'working');
  assert.equal(event.title, 'Codex 正在工作');
  assert.equal(event.taskId, 'thread-live');
});

test('maps Codex SessionStart to idle presence instead of work', () => {
  const event = fromCodexPayload({ hook_event_name: 'SessionStart', session_id: 'thread-ready' });
  assert.equal(event.type, 'success');
  assert.equal(event.context.presenceOnly, true);
  assert.equal(event.systemNotify, false);
});
