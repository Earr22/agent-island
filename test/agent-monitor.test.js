const test = require('node:test');
const assert = require('node:assert/strict');
const { detectActiveAgents, parseTasklistOutput, parseTasklistProcesses } = require('../src/agent-monitor');

const TASKLIST_SAMPLE = [
  '"codex.exe","7908","Console","1","42,000 K"',
  '"claude.exe","44044","Console","1","84,000 K"',
  '"claude.exe","3996","Console","1","82,000 K"',
  '"explorer.exe","1200","Console","1","100,000 K"'
].join('\r\n');

test('parses tasklist process counts', () => {
  const counts = parseTasklistOutput(TASKLIST_SAMPLE);
  assert.equal(counts.get('codex.exe'), 1);
  assert.equal(counts.get('claude.exe'), 2);
});

test('parses tasklist process ids', () => {
  assert.deepEqual(parseTasklistProcesses(TASKLIST_SAMPLE).slice(0, 2), [
    { name: 'codex.exe', processId: 7908 },
    { name: 'claude.exe', processId: 44044 }
  ]);
});

test('detects supported running agents', () => {
  const agents = detectActiveAgents(TASKLIST_SAMPLE);
  assert.deepEqual(agents.map(({ id, processCount, processIds }) => ({ id, processCount, processIds })), [
    { id: 'codex', processCount: 1, processIds: [7908] },
    { id: 'claude', processCount: 2, processIds: [44044, 3996] }
  ]);
});
