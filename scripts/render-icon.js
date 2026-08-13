const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.whenReady().then(() => {
  const inputPath = path.resolve(__dirname, '..', 'build', 'icon.svg');
  const outputPath = path.resolve(__dirname, '..', 'build', 'icon.png');
  const svg = fs.readFileSync(inputPath, 'utf8');
  const svgUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const html = `<!doctype html><html><style>*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;background:transparent}img{display:block;width:100%;height:100%}</style><body><img src="${svgUrl}"></body></html>`;
  const window = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true }
  });
  return window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).then(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    const image = await window.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
    fs.writeFileSync(outputPath, image.toPNG());
    console.log(`Rendered icon: ${outputPath}`);
    window.destroy();
    app.quit();
  });
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
