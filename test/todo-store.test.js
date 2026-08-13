const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TodoStore, formatDuration } = require('../src/todo-store');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-island-todos-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let current = new Date('2026-07-15T08:00:00.000Z');
  return {
    filePath: path.join(directory, 'todos.json'),
    now: () => new Date(current),
    advance: (milliseconds) => { current = new Date(current.getTime() + milliseconds); }
  };
}

test('persists todo creation and completion timestamps', (t) => {
  const clock = fixture(t);
  const store = new TodoStore(clock);
  const created = store.create('整理 Agent 通知').item;
  clock.advance(60000);
  const completed = store.toggle(created.id).item;
  assert.equal(completed.completed, true);
  assert.notEqual(completed.createdAt, completed.updatedAt);
  const reloaded = new TodoStore(clock);
  assert.equal(reloaded.getItems()[0].title, '整理 Agent 通知');
});

test('keeps only one running timer and accumulates elapsed time', (t) => {
  const clock = fixture(t);
  const store = new TodoStore(clock);
  const first = store.create('第一项').item;
  const second = store.create('第二项').item;
  store.toggleTimer(first.id);
  clock.advance(65000);
  store.toggleTimer(second.id);
  const items = store.getItems();
  assert.equal(items.find((item) => item.id === first.id).elapsedLabel, '01:05');
  assert.equal(items.filter((item) => item.timerRunning).length, 1);
});

test('completing a running todo stops its timer', (t) => {
  const clock = fixture(t);
  const store = new TodoStore(clock);
  const todo = store.create('完成我').item;
  store.toggleTimer(todo.id);
  clock.advance(5000);
  const result = store.toggle(todo.id).item;
  assert.equal(result.completed, true);
  assert.equal(result.timerRunning, false);
  assert.equal(result.elapsedLabel, '00:05');
});

test('exports a Notion-friendly Markdown checklist', (t) => {
  const clock = fixture(t);
  const store = new TodoStore(clock);
  store.create('同步到 Notion');
  assert.match(store.exportMarkdown(), /- \[ \] 同步到 Notion/);
  assert.equal(formatDuration(3661000), '01:01:01');
});
