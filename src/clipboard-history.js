const { EventEmitter } = require('node:events');
const { createHash, randomUUID } = require('node:crypto');

const DEFAULT_MAX_ITEMS = 30;
const DEFAULT_MAX_TEXT_BYTES = 512 * 1024;
const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 48 * 1024 * 1024;

function signatureFor(kind, value) {
  return `${kind}:${createHash('sha256').update(value).digest('hex')}`;
}

function signatureForImage(image) {
  const size = image.getSize();
  if (typeof image.toBitmap === 'function') {
    const bitmap = image.toBitmap();
    const hash = createHash('sha256');
    hash.update(`${size.width}x${size.height}:`);
    hash.update(bitmap);
    return `image:${hash.digest('hex')}`;
  }
  return signatureFor('image', image.toPNG());
}

function compactText(text, limit = 180) {
  const compact = String(text).replace(/\s+/g, ' ').trim();
  return compact.length > limit ? `${compact.slice(0, limit - 1)}…` : compact;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

class ClipboardHistory extends EventEmitter {
  constructor({
    clipboard,
    nativeImage,
    maxItems = DEFAULT_MAX_ITEMS,
    maxTextBytes = DEFAULT_MAX_TEXT_BYTES,
    maxImageBytes = DEFAULT_MAX_IMAGE_BYTES,
    maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
    pollMs = 700,
    now = () => new Date()
  } = {}) {
    super();
    this.clipboard = clipboard;
    this.nativeImage = nativeImage;
    this.maxItems = maxItems;
    this.maxTextBytes = maxTextBytes;
    this.maxImageBytes = maxImageBytes;
    this.maxTotalBytes = maxTotalBytes;
    this.pollMs = pollMs;
    this.now = now;
    this.items = [];
    this.lastSignature = null;
    this.timer = null;
    this.running = false;
    this.externalMonitoring = false;
  }

  start() {
    if (this.running || !this.clipboard) return;
    this.running = true;
    this.poll();
    this.startPolling();
  }

  startPolling() {
    if (!this.running || this.externalMonitoring || this.timer) return;
    this.timer = setInterval(() => this.poll(), this.pollMs);
    this.timer.unref?.();
  }

  setExternalMonitoring(enabled) {
    this.externalMonitoring = Boolean(enabled);
    if (this.externalMonitoring) {
      clearInterval(this.timer);
      this.timer = null;
    } else {
      this.startPolling();
    }
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    this.timer = null;
  }

  poll() {
    if (!this.clipboard) return false;
    try {
      const text = this.clipboard.readText();
      if (String(text).trim()) return this.addText(text);

      const image = this.clipboard.readImage();
      if (image && !image.isEmpty()) {
        const signature = signatureForImage(image);
        if (signature === this.lastSignature) return false;
        return this.addImage(image, this.now(), signature);
      }

      this.lastSignature = 'empty';
      return false;
    } catch {
      return false;
    }
  }

  addText(text, createdAt = this.now()) {
    const value = String(text);
    const bytes = Buffer.byteLength(value, 'utf8');
    if (!value.trim() || bytes > this.maxTextBytes) return false;
    const signature = signatureFor('text', value);
    if (signature === this.lastSignature) return false;
    this.lastSignature = signature;
    return this.remember({
      id: randomUUID(),
      type: 'text',
      signature,
      text: value,
      preview: compactText(value),
      characters: [...value].length,
      lines: value.split(/\r?\n/).length,
      bytes,
      createdAt: new Date(createdAt).toISOString()
    });
  }

  addImage(image, createdAt = this.now(), knownSignature = '') {
    const signature = knownSignature || signatureForImage(image);
    if (signature === this.lastSignature) return false;
    const png = image.toPNG();
    if (!png?.length || png.length > this.maxImageBytes) return false;
    this.lastSignature = signature;
    const size = image.getSize();
    const ratio = Math.min(1, 48 / Math.max(size.width, size.height, 1));
    const thumbnail = image.resize({
      width: Math.max(1, Math.round(size.width * ratio)),
      height: Math.max(1, Math.round(size.height * ratio)),
      quality: 'good'
    }).toDataURL();
    return this.remember({
      id: randomUUID(),
      type: 'image',
      signature,
      png,
      thumbnail,
      width: size.width,
      height: size.height,
      bytes: png.length,
      createdAt: new Date(createdAt).toISOString()
    });
  }

  remember(entry) {
    const existingIndex = this.items.findIndex((item) => item.signature === entry.signature);
    if (existingIndex >= 0) this.items.splice(existingIndex, 1);
    this.items.unshift(entry);
    this.items = this.items.slice(0, this.maxItems);
    while (this.items.length > 1 && this.items.reduce((total, item) => total + (item.bytes || 0), 0) > this.maxTotalBytes) {
      this.items.pop();
    }
    this.emitChanged();
    return true;
  }

  getItems() {
    return this.items.map((item) => ({
      id: item.id,
      type: item.type,
      preview: item.type === 'text' ? item.preview : 'Image',
      characters: item.characters || 0,
      lines: item.lines || 0,
      thumbnail: item.thumbnail || '',
      width: item.width || 0,
      height: item.height || 0,
      sizeLabel: formatBytes(item.bytes || 0),
      createdAt: item.createdAt
    }));
  }

  restore(id) {
    const index = this.items.findIndex((item) => item.id === String(id));
    if (index < 0) return { ok: false, error: 'Clipboard item not found.' };
    const [item] = this.items.splice(index, 1);
    try {
      if (item.type === 'text') this.clipboard.writeText(item.text);
      else this.clipboard.writeImage(this.nativeImage.createFromBuffer(item.png));
    } catch {
      this.items.splice(index, 0, item);
      return { ok: false, error: 'Could not write to the system clipboard.' };
    }
    item.createdAt = this.now().toISOString();
    this.items.unshift(item);
    this.lastSignature = item.signature;
    this.emitChanged();
    return { ok: true, type: item.type };
  }

  clear() {
    this.items = [];
    this.emitChanged();
    return { ok: true };
  }

  emitChanged() {
    this.emit('changed', this.getItems());
  }
}

module.exports = { ClipboardHistory, compactText, formatBytes, signatureForImage };
