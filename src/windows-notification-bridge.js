const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

class WindowsNotificationBridge extends EventEmitter {
  constructor({ scriptPath, pollMilliseconds = 1200, removeAfterRead = true } = {}) {
    super();
    this.scriptPath = scriptPath;
    this.pollMilliseconds = pollMilliseconds;
    this.removeAfterRead = removeAfterRead;
    this.process = null;
    this.restartTimer = null;
    this.stopped = true;
  }

  handleLine(line) {
    const text = String(line || '').trim();
    if (!text) return;
    try {
      const payload = JSON.parse(text);
      if (payload.kind === 'notification') this.emit('notification', payload);
      else if (payload.kind === 'clipboard-changed') this.emit('clipboard-changed', payload);
      else if (payload.kind === 'status') this.emit('status', payload);
      else if (payload.kind === 'error') this.emit('bridge-error', payload);
    } catch {
      this.emit('bridge-error', { kind: 'error', message: text });
    }
  }

  start() {
    if (!this.stopped || this.process) return;
    this.stopped = false;
    this.spawnProcess();
  }

  spawnProcess() {
    if (this.stopped || this.process) return;
    const args = [
      '-NoProfile',
      '-STA',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      this.scriptPath,
      '-PollMilliseconds',
      String(this.pollMilliseconds)
    ];
    if (this.removeAfterRead) args.push('-RemoveAfterRead');

    const child = spawn('powershell.exe', args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    this.process = child;

    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => this.handleLine(line));
    child.stderr.on('data', (chunk) => {
      const message = chunk.toString('utf8').trim();
      if (message) this.emit('bridge-error', { kind: 'error', message });
    });
    child.on('error', (error) => this.emit('bridge-error', { kind: 'error', message: error.message }));
    child.on('exit', (code) => {
      lines.close();
      if (this.process === child) this.process = null;
      if (!this.stopped) {
        this.emit('status', { kind: 'status', access: 'Restarting', exitCode: code });
        this.restartTimer = setTimeout(() => this.spawnProcess(), 3000);
      }
    });
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}

module.exports = { WindowsNotificationBridge };
