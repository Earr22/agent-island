const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_TODOS = 200;

function cleanTitle(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function validDate(value, fallback) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

class TodoStore extends EventEmitter {
  constructor({ filePath, now = () => new Date() } = {}) {
    super();
    this.filePath = filePath;
    this.now = now;
    this.items = [];
    this.load();
  }

  load() {
    if (!this.filePath) return;
    try {
      const payload = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      const source = Array.isArray(payload) ? payload : payload.items;
      const fallback = this.now().toISOString();
      this.items = (Array.isArray(source) ? source : []).slice(0, MAX_TODOS).flatMap((item) => {
        const title = cleanTitle(item.title);
        if (!title) return [];
        return [{
          id: String(item.id || randomUUID()),
          title,
          completed: Boolean(item.completed),
          createdAt: validDate(item.createdAt, fallback),
          updatedAt: validDate(item.updatedAt, fallback),
          elapsedMs: Math.max(0, Number(item.elapsedMs || 0)),
          timerStartedAt: item.completed ? null : (item.timerStartedAt ? validDate(item.timerStartedAt, null) : null)
        }];
      });
    } catch {
      this.items = [];
    }
  }

  save() {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify({ version: 1, items: this.items }, null, 2), 'utf8');
  }

  elapsedFor(item, now = this.now()) {
    if (!item.timerStartedAt) return item.elapsedMs;
    return item.elapsedMs + Math.max(0, now.getTime() - new Date(item.timerStartedAt).getTime());
  }

  getItems() {
    const now = this.now();
    return this.items
      .map((item) => ({
        ...item,
        timerRunning: Boolean(item.timerStartedAt),
        elapsedMs: this.elapsedFor(item, now),
        elapsedLabel: formatDuration(this.elapsedFor(item, now))
      }))
      .sort((a, b) => Number(a.completed) - Number(b.completed) || new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  create(title) {
    const clean = cleanTitle(title);
    if (!clean) return { ok: false, error: '请输入待办内容。' };
    const timestamp = this.now().toISOString();
    const item = {
      id: randomUUID(),
      title: clean,
      completed: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      elapsedMs: 0,
      timerStartedAt: null
    };
    this.items.unshift(item);
    this.items = this.items.slice(0, MAX_TODOS);
    this.commit();
    return { ok: true, item: this.getItems().find((entry) => entry.id === item.id) };
  }

  toggle(id) {
    const item = this.items.find((entry) => entry.id === String(id));
    if (!item) return { ok: false, error: '待办不存在。' };
    const now = this.now();
    if (!item.completed && item.timerStartedAt) {
      item.elapsedMs = this.elapsedFor(item, now);
      item.timerStartedAt = null;
    }
    item.completed = !item.completed;
    item.updatedAt = now.toISOString();
    this.commit();
    return { ok: true, item: this.getItems().find((entry) => entry.id === item.id) };
  }

  toggleTimer(id) {
    const item = this.items.find((entry) => entry.id === String(id));
    if (!item) return { ok: false, error: '待办不存在。' };
    if (item.completed) return { ok: false, error: '已完成的待办不能继续计时。' };
    const now = this.now();
    if (item.timerStartedAt) {
      item.elapsedMs = this.elapsedFor(item, now);
      item.timerStartedAt = null;
    } else {
      for (const running of this.items.filter((entry) => entry.timerStartedAt)) {
        running.elapsedMs = this.elapsedFor(running, now);
        running.timerStartedAt = null;
        running.updatedAt = now.toISOString();
      }
      item.timerStartedAt = now.toISOString();
    }
    item.updatedAt = now.toISOString();
    this.commit();
    return { ok: true, item: this.getItems().find((entry) => entry.id === item.id) };
  }

  delete(id) {
    const before = this.items.length;
    this.items = this.items.filter((entry) => entry.id !== String(id));
    if (this.items.length === before) return { ok: false, error: '待办不存在。' };
    this.commit();
    return { ok: true };
  }

  clearCompleted() {
    this.items = this.items.filter((entry) => !entry.completed);
    this.commit();
    return { ok: true };
  }

  exportMarkdown() {
    const generatedAt = this.now().toISOString();
    const rows = this.getItems().map((item) => {
      const state = item.completed ? 'x' : ' ';
      return `- [${state}] ${item.title} · 用时 ${item.elapsedLabel} · 创建 ${item.createdAt} · 更新 ${item.updatedAt}`;
    });
    return [`# Agent Island 待办`, ``, ...rows, ``, `导出时间：${generatedAt}`].join('\n');
  }

  commit() {
    this.save();
    this.emit('changed', this.getItems());
  }
}

module.exports = { TodoStore, cleanTitle, formatDuration };
