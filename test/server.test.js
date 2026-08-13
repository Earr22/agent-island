const test = require('node:test');
const assert = require('node:assert/strict');
const { AgentIslandServer } = require('../src/server');

async function withServer(run) {
  const server = new AgentIslandServer({ port: 0 });
  await server.start();
  const address = server.httpServer.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(server, baseUrl);
  } finally {
    await server.stop();
  }
}

test('accepts generic events through the local API', async () => {
  await withServer(async (server, baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'cursor', type: 'success', title: 'Done', message: 'Ready' })
    });
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.event.sourceLabel, 'Cursor');
    assert.equal(server.history[0].title, 'Done');
  });
});
test('resolves an asynchronous decision through the response endpoint', async () => {
  await withServer(async (_server, baseUrl) => {
    const create = await fetch(`${baseUrl}/v1/decisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Continue?', actions: ['Yes', 'No'], wait: false })
    });
    const pending = await create.json();
    assert.equal(create.status, 202);

    const answer = await fetch(`${baseUrl}/v1/decisions/${pending.decisionId}/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ choice: 'yes' })
    });
    assert.equal(answer.status, 200);

    const state = await fetch(`${baseUrl}/v1/decisions/${pending.decisionId}`).then((result) => result.json());
    assert.equal(state.status, 'answered');
    assert.equal(state.choice, 'yes');
  });
});

test('returns a Claude permission decision after the island responds', async () => {
  await withServer(async (server, baseUrl) => {
    const seenDecision = new Promise((resolve) => server.once('event', resolve));
    const responsePromise = fetch(`${baseUrl}/hooks/claude`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hook_event_name: 'PermissionRequest',
        session_id: 'session-1',
        tool_name: 'Bash',
        tool_input: { command: 'npm test' }
      })
    });

    const event = await seenDecision;
    const result = server.respond(event.id, 'allow');
    assert.equal(result.ok, true);

    const response = await responsePromise;
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.hookSpecificOutput.hookEventName, 'PermissionRequest');
    assert.equal(payload.hookSpecificOutput.decision.behavior, 'allow');
  });
});
