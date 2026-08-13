// Copy this file to ~/.config/opencode/plugins/agent-island.js.
const endpoint = 'http://127.0.0.1:17321/v1/events';

async function publish(payload) {
  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'opencode', ...payload })
    });
  } catch {
    // Agent Island is optional; never interrupt an OpenCode session if it is closed.
  }
}

export const AgentIsland = async () => ({
  event: async ({ event }) => {
    if (event.type === 'permission.asked') {
    await publish({ type: 'warning', title: 'OpenCode is waiting for approval', message: 'Return to OpenCode to handle the permission request.', systemNotify: true });
    } else if (event.type === 'session.idle') {
    await publish({ type: 'success', title: 'OpenCode completed', message: 'The session is now idle.' });
    } else if (event.type === 'session.error') {
    await publish({ type: 'error', title: 'OpenCode ran into an error', message: event.properties?.error?.message || 'The session failed.' });
    }
  }
});
