const test = require('node:test');
const assert = require('node:assert/strict');
const { ClipboardHistory, compactText, formatBytes } = require('../src/clipboard-history');

function makeFixture() {
  let text = '';
  let writtenText = '';
  const emptyImage = { isEmpty: () => true };
  const clipboard = {
    readText: () => text,
    readImage: () => emptyImage,
    writeText: (value) => { writtenText = value; },
    writeImage: () => {}
  };
  const history = new ClipboardHistory({ clipboard, nativeImage: {}, now: () => new Date('2026-07-15T08:00:00.000Z') });
  return {
    history,
    setText: (value) => { text = value; },
    getWrittenText: () => writtenText
  };
}

test('captures text changes and ignores consecutive duplicates', () => {
  const fixture = makeFixture();
  fixture.setText('第一条剪贴板内容');
  assert.equal(fixture.history.poll(), true);
  assert.equal(fixture.history.poll(), false);
  assert.equal(fixture.history.getItems().length, 1);
  assert.equal(fixture.history.getItems()[0].preview, '第一条剪贴板内容');
});

test('moves a repeated clipboard value back to the top', () => {
  const fixture = makeFixture();
  fixture.setText('A');
  fixture.history.poll();
  fixture.setText('B');
  fixture.history.poll();
  fixture.setText('A');
  fixture.history.poll();
  assert.deepEqual(fixture.history.getItems().map((item) => item.preview), ['A', 'B']);
});

test('restores a history item into the system clipboard', () => {
  const fixture = makeFixture();
  fixture.setText('npm test && npm run build');
  fixture.history.poll();
  const result = fixture.history.restore(fixture.history.getItems()[0].id);
  assert.equal(result.ok, true);
  assert.equal(fixture.getWrittenText(), 'npm test && npm run build');
});

test('captures and restores image clipboard entries', () => {
  const png = Buffer.from('fake-png');
  let pngEncodes = 0;
  const image = {
    isEmpty: () => false,
    toBitmap: () => Buffer.from('raw-bitmap'),
    toPNG: () => { pngEncodes += 1; return png; },
    getSize: () => ({ width: 320, height: 180 }),
    resize: () => ({ toDataURL: () => 'data:image/png;base64,ZmFrZQ==' })
  };
  let restoredImage = null;
  const clipboard = {
    readText: () => '',
    readImage: () => image,
    writeText: () => {},
    writeImage: (value) => { restoredImage = value; }
  };
  const nativeImage = { createFromBuffer: (value) => ({ value }) };
  const history = new ClipboardHistory({ clipboard, nativeImage });
  assert.equal(history.poll(), true);
  assert.equal(history.poll(), false);
  assert.equal(pngEncodes, 1);
  const [item] = history.getItems();
  assert.equal(item.type, 'image');
  assert.equal(item.width, 320);
  assert.equal(history.restore(item.id).ok, true);
  assert.deepEqual(restoredImage.value, png);
});

test('external clipboard monitoring suspends and resumes fallback polling', () => {
  const fixture = makeFixture();
  fixture.history.start();
  assert.notEqual(fixture.history.timer, null);
  fixture.history.setExternalMonitoring(true);
  assert.equal(fixture.history.timer, null);
  fixture.history.setExternalMonitoring(false);
  assert.notEqual(fixture.history.timer, null);
  fixture.history.stop();
});

test('keeps history in memory and clears it without clearing the system clipboard', () => {
  const fixture = makeFixture();
  fixture.setText('local only');
  fixture.history.poll();
  assert.deepEqual(fixture.history.clear(), { ok: true });
  assert.equal(fixture.history.getItems().length, 0);
});

test('formats compact previews and byte sizes', () => {
  assert.equal(compactText('one\n\n two'), 'one two');
  assert.equal(formatBytes(1536), '2 KB');
});
