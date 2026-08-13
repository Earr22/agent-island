const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CodexSessionMonitor, eventFromLine, sessionIdFromPath } = require('../src/codex-session-monitor');

function line(timestamp, type, payload = {}) {
  return JSON.stringify({ timestamp, type: 'event_msg', payload: { type, ...payload } });
}

test('parses Codex Desktop lifecycle records without reading reasoning content', () => {
  assert.deepEqual(eventFromLine(line('2026-07-16T08:00:00.000Z', 'task_started', { turn_id: 'turn-1' })), {
    kind: 'start',
    turnId: 'turn-1',
    timestamp: '2026-07-16T08:00:00.000Z'
  });
  assert.equal(eventFromLine(JSON.stringify({ type: 'response_item', payload: { type: 'reasoning' } })), null);
  assert.equal(sessionIdFromPath('rollout-2026-07-16T12-00-00-019f6936-70d5-7642-98ca-d733cd86706b.jsonl'), '019f6936-70d5-7642-98ca-d733cd86706b');
});

test('reports a real desktop turn as working and returns to idle on task_complete', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-island-codex-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const day = path.join(root, '2026', '07', '16');
  fs.mkdirSync(day, { recursive: true });
  const filePath = path.join(day, 'rollout-2026-07-16T12-00-00-019f6936-70d5-7642-98ca-d733cd86706b.jsonl');
  fs.writeFileSync(filePath, [
    line('2026-07-16T08:00:00.000Z', 'task_started', { turn_id: 'turn-1' }),
    line('2026-07-16T08:00:00.010Z', 'user_message', { message: '修复灵动岛真实任务同步' })
  ].join('\n') + '\n');

  let now = Date.now();
  const monitor = new CodexSessionMonitor({ sessionsRoot: root, now: () => now, discoveryMs: 0 });
  const states = [];
  monitor.on('state', (state, meta) => states.push({ state, meta }));
  await monitor.poll();

  assert.equal(states.at(-1).state.status, 'working');
  assert.equal(states.at(-1).state.message, '修复灵动岛真实任务同步');
  assert.equal(states.at(-1).state.taskId, 'turn-1');
  assert.equal(states.at(-1).meta.initial, true);

  fs.appendFileSync(filePath, line('2026-07-16T08:01:00.000Z', 'task_complete', { turn_id: 'turn-1' }) + '\n');
  now += 1000;
  await monitor.poll();

  assert.equal(states.at(-1).state.status, 'idle');
  assert.equal(states.at(-1).meta.transition, 'complete');
});

test('a newer turn supersedes an interrupted turn in the same Codex thread', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-island-codex-steer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const day = path.join(root, '2026', '07', '16');
  fs.mkdirSync(day, { recursive: true });
  const filePath = path.join(day, 'rollout-2026-07-16T12-00-00-019f6936-70d5-7642-98ca-d733cd86706b.jsonl');
  fs.writeFileSync(filePath, [
    line('2026-07-16T08:00:00.000Z', 'task_started', { turn_id: 'old-turn' }),
    line('2026-07-16T08:00:00.010Z', 'user_message', { message: '旧任务' }),
    line('2026-07-16T08:01:00.000Z', 'task_started', { turn_id: 'current-turn' }),
    line('2026-07-16T08:01:00.010Z', 'user_message', { message: '当前真实任务' })
  ].join('\n') + '\n');

  const monitor = new CodexSessionMonitor({ sessionsRoot: root, discoveryMs: 0 });
  let current;
  monitor.on('state', (state) => { current = state; });
  await monitor.poll();

  assert.equal(current.activeCount, 1);
  assert.equal(current.taskId, 'current-turn');
  assert.equal(current.message, '当前真实任务');
});

test('filesystem events update a running monitor without fast recursive polling', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-island-codex-watch-'));
  const day = path.join(root, '2026', '07', '16');
  fs.mkdirSync(day, { recursive: true });
  const filePath = path.join(day, 'rollout-2026-07-16T12-00-00-019f6936-70d5-7642-98ca-d733cd86706b.jsonl');
  fs.writeFileSync(filePath, line('2026-07-16T08:00:00.000Z', 'task_complete', { turn_id: 'old-turn' }) + '\n');
  const monitor = new CodexSessionMonitor({ sessionsRoot: root, pollMs: 60000, discoveryMs: 60000, watchDebounceMs: 30 });
  t.after(() => {
    monitor.stop();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const working = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('filesystem watcher did not deliver the Codex state change')), 2500);
    monitor.on('state', (state) => {
      if (state.status === 'working' && state.taskId === 'watched-turn') {
        clearTimeout(timeout);
        resolve(state);
      }
    });
  });
  monitor.start();
  await new Promise((resolve) => setTimeout(resolve, 120));
  fs.appendFileSync(filePath, [
    line('2026-07-16T08:01:00.000Z', 'task_started', { turn_id: 'watched-turn' }),
    line('2026-07-16T08:01:00.010Z', 'user_message', { message: '文件事件驱动任务' })
  ].join('\n') + '\n');

  assert.equal((await working).message, '文件事件驱动任务');
});
