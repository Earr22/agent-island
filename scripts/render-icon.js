const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
// Build-only rendering should not depend on the current GPU/compositor session.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.whenReady().then(() => {
  const trayOnly = process.argv.includes('--tray-only');
  const previewArgument = process.argv.find(value => value.startsWith('--preview='));
  const previewInput = previewArgument ? path.resolve(previewArgument.slice('--preview='.length)) : null;
  // The restored original SVG is the default; archived PNGs are opt-in only.
  const bitmapPath = path.resolve(__dirname, '..', 'build', 'icon-source.png');
  const bitmapInput = !trayOnly && !previewInput && process.argv.includes('--original-png') && fs.existsSync(bitmapPath) ? bitmapPath : null;
  const bitmap = bitmapInput ? nativeImage.createFromPath(bitmapInput) : null;
  if (bitmap && bitmap.isEmpty()) throw new Error('Selected original icon cannot be decoded');
  let bitmapFrame = bitmap;
  let cropBounds = null;
  if (bitmap) {
    // Tighten canvas only; ignore near-invisible alpha noise when framing.
    // Keep all original pixels inside the frame, including edge antialiasing.
    const { width, height } = bitmap.getSize();
    const pixels = bitmap.toBitmap();
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] >= 16) {
        left = Math.min(left, x); top = Math.min(top, y);
        right = Math.max(right, x); bottom = Math.max(bottom, y);
      }
    }
    if (right < 0) throw new Error('Selected original icon is fully transparent');
    // Square framing preserves proportions, with a small safety margin.
    const side = Math.min(width, height, Math.ceil(Math.max(right-left+1, bottom-top+1) / .94));
    cropBounds = { x: Math.max(0, Math.min(width-side, Math.round((left+right+1-side)/2))), y: Math.max(0, Math.min(height-side, Math.round((top+bottom+1-side)/2))), width: side, height: side };
    if (left < cropBounds.x || right >= cropBounds.x + side || top < cropBounds.y || bottom >= cropBounds.y + side) throw new Error('Icon framing would clip visible pixels');
    bitmapFrame = bitmap.crop(cropBounds);
  }
  const inputPath = previewInput || path.resolve(__dirname, '..', 'build', trayOnly ? 'tray-icon.svg' : 'icon.svg');
  const outputPath = path.resolve(__dirname, '..', 'build', trayOnly ? 'tray-icon.png' : 'icon.png');
  const svg = bitmap ? null : fs.readFileSync(inputPath, 'utf8');
  const smallSvg = bitmap ? null : trayOnly ? svg : fs.readFileSync(path.resolve(__dirname, '..', 'build', 'icon-small.svg'), 'utf8');
  const window = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true }
  });
  async function render(source, size) {
    // Format/size conversion only: no tracing, retouching, recoloring or
    // small-size expression substitutions. Preserve the original alpha.
    if (bitmap) return bitmapFrame.resize({ width: size, height: size, quality: 'best' });
    const svgUrl = `data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}`;
    // Windows can clamp tiny native window dimensions. Keep the viewport fixed
    // and render at the requested CSS size, then capture that exact rectangle.
    const html = `<!doctype html><html><style>*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><body><img src="${svgUrl}"></body></html>`;
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await window.webContents.executeJavaScript('document.images[0].decode()');
    await new Promise((resolve) => setTimeout(resolve, 120));
    const image = await window.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
    return nativeImage.createFromBuffer(image.toPNG()).resize({ width: size, height: size, quality: 'best' });
  }
  return (async () => {
    if (previewInput) {
      // Draft rendering must never overwrite the installed/build icon assets.
      const folder = path.dirname(previewInput);
      for (const size of [16, 32, 256, 512]) {
        fs.writeFileSync(path.join(folder, `preview-${size}.png`), (await render(svg, size)).toPNG());
      }
      console.log(`Rendered draft only: ${folder}`);
      window.destroy();
      app.quit();
      return;
    }
    const master = await render(svg, 512);
    fs.writeFileSync(outputPath, master.toPNG());
    // PNG-backed ICO entries cover Explorer, task manager and high-DPI tray sizes.
    const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
    const entries = [];
    for (const size of sizes) entries.push((await render(size <= 24 ? smallSvg : svg, size)).toPNG());
    const header = Buffer.alloc(6 + sizes.length * 16);
    header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
    let offset = header.length;
    entries.forEach((png, index) => {
      const position = 6 + index * 16, size = sizes[index];
      header[position] = size === 256 ? 0 : size; header[position + 1] = size === 256 ? 0 : size;
      header.writeUInt16LE(1, position + 4); header.writeUInt16LE(32, position + 6);
      header.writeUInt32LE(png.length, position + 8); header.writeUInt32LE(offset, position + 12); offset += png.length;
    });
    fs.writeFileSync(path.resolve(__dirname, '..', 'build', trayOnly ? 'tray-icon.ico' : 'icon.ico'), Buffer.concat([header, ...entries]));
    const preview = path.resolve(__dirname, '..', 'artifacts', trayOnly ? 'tray-icon-check' : 'icon-check');
    fs.mkdirSync(preview, { recursive: true });
    [16, 32, 256].forEach(size => fs.writeFileSync(path.join(preview, `${trayOnly ? 'tray' : 'app'}-${size}.png`), entries[sizes.indexOf(size)]));
    fs.writeFileSync(path.join(preview, 'icon-validation.json'), JSON.stringify({ sizes, sourceMode: bitmap ? 'original-png' : 'svg', sourcePath: bitmapInput || inputPath, sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(bitmapInput || inputPath)).digest('hex'), cropBounds, scaleIncrease: bitmap ? bitmap.getSize().width / cropBounds.width : 1, smallSizeMaster: bitmap ? [] : [16, 20, 24], transparentCorner: master.toBitmap()[3] === 0, icoBytes: offset }, null, 2));
    console.log(`Rendered icon: ${outputPath}`);
    window.destroy();
    app.quit();
  })();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
