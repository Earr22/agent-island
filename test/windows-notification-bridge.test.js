const test = require('node:test');
const assert = require('node:assert/strict');
const { WindowsNotificationBridge } = require('../src/windows-notification-bridge');

test('parses Windows notification bridge JSON lines', () => {
  const bridge = new WindowsNotificationBridge({ scriptPath: 'listener.ps1' });
  let received = null;
  bridge.on('notification', (payload) => { received = payload; });
  bridge.handleLine(JSON.stringify({
    kind: 'notification',
    id: 42,
    appName: 'Outlook',
    title: '新邮件',
    message: '会议时间已更新'
  }));
  assert.equal(received.appName, 'Outlook');
  assert.equal(received.title, '新邮件');
});

test('reports malformed bridge output as an error', () => {
  const bridge = new WindowsNotificationBridge({ scriptPath: 'listener.ps1' });
  let error = null;
  bridge.on('bridge-error', (payload) => { error = payload; });
  bridge.handleLine('not-json');
  assert.equal(error.message, 'not-json');
});

test('forwards Windows clipboard sequence changes', () => {
  const bridge = new WindowsNotificationBridge({ scriptPath: 'listener.ps1' });
  let sequence = null;
  bridge.on('clipboard-changed', (payload) => { sequence = payload.sequence; });
  bridge.handleLine(JSON.stringify({ kind: 'clipboard-changed', sequence: 42 }));
  assert.equal(sequence, 42);
});
