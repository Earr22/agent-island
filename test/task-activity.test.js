const test = require('node:test');
const assert = require('node:assert/strict');
const { AgentTaskTracker } = require('../src/task-activity');

function tracker() {
  return new AgentTaskTracker({ now: () => new Date('2026-07-16T08:00:00.000Z') });
}

test('a detected process is connected but idle', () => {
  const [agent] = tracker().mergeAgents([{ id: 'codex', label: 'Codex' }]);
  assert.equal(agent.taskState.status, 'idle');
  assert.equal(agent.taskState.label, '空闲');
});

test('a real prompt starts work and Stop returns to idle', () => {
  const state = tracker();
  state.updateFromEvent({ source: 'codex', type: 'working', title: 'Codex 正在工作', context: { hookEventName: 'UserPromptSubmit' } });
  assert.equal(state.get('codex').status, 'working');
  state.updateFromEvent({ source: 'codex', type: 'success', title: 'Codex 已完成', context: { hookEventName: 'Stop' } });
  assert.equal(state.get('codex').status, 'idle');
});

test('SessionStart is presence only and never starts work', () => {
  const state = tracker();
  state.updateFromEvent({ source: 'claude', type: 'success', title: 'Claude 已连接', context: { hookEventName: 'SessionStart', presenceOnly: true } });
  assert.equal(state.get('claude').status, 'idle');
});

test('a subagent stopping does not idle an active parent turn', () => {
  const state = tracker();
  state.updateFromEvent({ source: 'codex', type: 'working', context: { hookEventName: 'UserPromptSubmit' } });
  state.updateFromEvent({ source: 'codex', type: 'working', context: { hookEventName: 'SubagentStart' } });
  state.updateFromEvent({ source: 'codex', type: 'success', context: { hookEventName: 'SubagentStop' } });
  assert.equal(state.get('codex').status, 'working');
});

test('approval waits and an allow decision resumes work', () => {
  const state = tracker();
  state.updateFromEvent({ source: 'claude', type: 'decision', title: '需要授权' });
  assert.equal(state.get('claude').status, 'waiting');
  state.resolveDecision({ status: 'answered', choice: 'allow', event: { source: 'claude', taskId: 'task-1' } });
  assert.equal(state.get('claude').status, 'working');
});

test('desktop session state can authoritatively update Codex activity', () => {
  const state = tracker();
  state.setExternalState('codex', { status: 'working', title: 'Codex 正在工作', message: '真实桌面任务', taskId: 'turn-1' });
  assert.equal(state.get('codex').status, 'working');
  assert.equal(state.get('codex').message, '真实桌面任务');
  state.setExternalState('codex', { status: 'idle', title: 'Codex 当前空闲' });
  assert.equal(state.get('codex').status, 'idle');
});
