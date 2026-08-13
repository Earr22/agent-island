const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, Notification, shell, clipboard, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { execFile, spawn } = require('node:child_process');
const { AgentIslandServer } = require('./server');
const { AgentProcessMonitor } = require('./agent-monitor');
const { ClipboardHistory } = require('./clipboard-history');
const { TodoStore } = require('./todo-store');
const { AgentTaskTracker } = require('./task-activity');
const { CodexSessionMonitor } = require('./codex-session-monitor');
const { WindowsNotificationBridge } = require('./windows-notification-bridge');
const {
  sanitizePlacement,
  targetBounds: calculateTargetBounds,
  visualBounds,
  freeBoundsForVisual,
  clampFreeBoundsForLayout,
  nearestSnapEdge,
  ratioForEdge,
  pointInRect
} = require('./placement');

const APP_ID = 'com.agentisland.desktop';
const CANVAS_WINDOW = { width: 440, height: 276 };
const DEFAULT_SETTINGS = {
  systemNotifications: true,
  captureWindowsNotifications: false,
  dismissCapturedNotifications: false,
  clipboardHistory: true,
  privacyNoticeSeen: false,
  startWithWindows: false,
  autoHide: true,
  placement: { mode: 'top', ratio: 0.5, x: null, y: null, displayId: '' },
  port: 17321,
  edgeOffset: 4
};

let mainWindow = null;
let tray = null;
let apiServer = null;
let settings = { ...DEFAULT_SETTINGS };
let isQuitting = false;
let activeNotification = null;
let activeAgents = [];
let agentMonitor = null;
let codexSessionMonitor = null;
let clipboardHistory = null;
let todoStore = null;
const taskTracker = new AgentTaskTracker();
let windowsNotificationBridge = null;
let windowsNotificationAccess = 'Starting';
let islandLayoutSize = { width: 146, height: 38 };
let isAutoHidden = false;
let proximityTimer = null;
let lastProximity = null;
let dragState = null;
let dragTimer = null;
let snapOffer = null;
let snapAnimationTimer = null;
const smokeCaptureArg = process.argv.find((arg) => arg.startsWith('--smoke-capture='));

app.setAppUserModelId(APP_ID);

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function todosPath() {
  return path.join(app.getPath('userData'), 'todos.json');
}

function loadSettings() {
  try {
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
  settings.placement = sanitizePlacement(settings.placement);
  settings.autoHide = settings.autoHide !== false;
}

function saveSettings() {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
}

async function showFirstRunPrivacyNotice() {
  if (settings.privacyNoticeSeen || smokeCaptureArg) return;
  const result = await dialog.showMessageBox({
    type: 'info',
    title: 'Agent Island privacy',
    message: 'Clipboard history is enabled by default.',
    detail: 'Agent Island keeps up to 30 recent text or image items in memory only. Nothing is uploaded, and the history disappears when the app exits. You can disable it from the tray menu at any time. Windows notification capture is off by default.',
    buttons: ['Keep clipboard history on', 'Turn it off'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  settings.clipboardHistory = result.response === 0;
  settings.privacyNoticeSeen = true;
  saveSettings();
}

function placementDisplay(placement = settings.placement) {
  const storedId = String(placement?.displayId || '');
  const stored = screen.getAllDisplays().find((display) => String(display.id) === storedId);
  if (stored) return stored;
  if (placement?.mode === 'free' && Number.isFinite(placement.x) && Number.isFinite(placement.y)) {
    return screen.getDisplayNearestPoint({
      x: placement.x + Math.round(CANVAS_WINDOW.width / 2),
      y: placement.y + Math.round(CANVAS_WINDOW.height / 2)
    });
  }
  return screen.getPrimaryDisplay();
}

function targetBounds() {
  return calculateTargetBounds({
    placement: settings.placement,
    display: placementDisplay(),
    canvas: CANVAS_WINDOW,
    edgeOffset: settings.edgeOffset
  });
}

function placementPayload() {
  return { ...settings.placement, autoHide: settings.autoHide };
}

function sendPlacement() {
  mainWindow?.webContents.send('island:placement', placementPayload());
}

function positionIsland() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setBounds(targetBounds(), false);
}

function currentVisualBounds(mode = settings.placement.mode) {
  if (!mainWindow || mainWindow.isDestroyed()) return { x: 0, y: 0, width: 1, height: 1 };
  return visualBounds(mainWindow.getBounds(), mode, islandLayoutSize);
}

function animateWindowTo(bounds, duration = 240) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  clearInterval(snapAnimationTimer);
  const from = mainWindow.getBounds();
  const startedAt = Date.now();
  snapAnimationTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return clearInterval(snapAnimationTimer);
    const progress = Math.min(1, (Date.now() - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const x = Math.round(from.x + (bounds.x - from.x) * eased);
    const y = Math.round(from.y + (bounds.y - from.y) * eased);
    mainWindow.setPosition(x, y, false);
    if (progress >= 1) {
      clearInterval(snapAnimationTimer);
      snapAnimationTimer = null;
    }
  }, 16);
  snapAnimationTimer.unref?.();
}

function startIslandDrag() {
  if (!mainWindow || mainWindow.isDestroyed() || dragState) return false;
  const cursor = screen.getCursorScreenPoint();
  dragState = {
    cursor,
    bounds: mainWindow.getBounds(),
    sourceMode: settings.placement.mode
  };
  isAutoHidden = false;
  mainWindow.webContents.send('island:dragging', true);
  mainWindow.setIgnoreMouseEvents(false);
  clearInterval(dragTimer);
  dragTimer = setInterval(() => {
    if (!dragState || !mainWindow || mainWindow.isDestroyed()) return;
    const point = screen.getCursorScreenPoint();
    const x = Math.round(dragState.bounds.x + point.x - dragState.cursor.x);
    const y = Math.round(dragState.bounds.y + point.y - dragState.cursor.y);
    const current = mainWindow.getBounds();
    if (current.x !== x || current.y !== y) mainWindow.setPosition(x, y, false);
  }, 16);
  dragTimer.unref?.();
  return true;
}

function endIslandDrag() {
  if (!dragState || !mainWindow || mainWindow.isDestroyed()) return false;
  clearInterval(dragTimer);
  dragTimer = null;
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const visible = currentVisualBounds(dragState.sourceMode);
  const edge = nearestSnapEdge(cursor, display);
  const proposedFreeBounds = freeBoundsForVisual(visible, CANVAS_WINDOW);
  const freeBounds = clampFreeBoundsForLayout(
    proposedFreeBounds,
    display,
    edge ? { width: 310, height: 58 } : islandLayoutSize,
    CANVAS_WINDOW
  );
  const freePlacement = sanitizePlacement({
    mode: 'free',
    x: freeBounds.x,
    y: freeBounds.y,
    displayId: display.id
  });
  dragState = null;
  settings.placement = freePlacement;
  mainWindow.setBounds(freeBounds, false);
  sendPlacement();
  mainWindow.webContents.send('island:dragging', false);

  if (edge) {
    snapOffer = {
      edge,
      ratio: ratioForEdge(edge, cursor, display),
      displayId: String(display.id),
      freePlacement
    };
    mainWindow.webContents.send('island:snap-offer', { edge });
  } else {
    snapOffer = null;
    saveSettings();
  }
  return true;
}

function resolveSnapOffer(accept) {
  if (!snapOffer) return { ok: false, error: 'There is no pending snap choice.' };
  const offer = snapOffer;
  snapOffer = null;
  if (accept) {
    settings.placement = sanitizePlacement({
      mode: offer.edge,
      ratio: offer.ratio,
      displayId: offer.displayId
    });
    saveSettings();
    sendPlacement();
    animateWindowTo(targetBounds());
    return { ok: true, snapped: true, placement: placementPayload() };
  }
  settings.placement = offer.freePlacement;
  saveSettings();
  sendPlacement();
  return { ok: true, snapped: false, placement: placementPayload() };
}

function cursorNearIsland(point) {
  const visible = currentVisualBounds();
  const mode = settings.placement.mode;
  const display = placementDisplay();
  const area = display.bounds;
  if (mode === 'top') return point.y <= area.y + 30 && pointInRect(point, visible, 84);
  if (mode === 'bottom') return point.y >= area.y + area.height - 30 && pointInRect(point, visible, 84);
  if (mode === 'left') return point.x <= area.x + 30 && pointInRect(point, visible, 84);
  if (mode === 'right') return point.x >= area.x + area.width - 30 && pointInRect(point, visible, 84);
  return pointInRect(point, visible, 38);
}

function updateProximity() {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible() || dragState) return;
  const point = screen.getCursorScreenPoint();
  const visible = currentVisualBounds();
  const near = cursorNearIsland(point);
  if (near !== lastProximity) {
    lastProximity = near;
    mainWindow.webContents.send('island:proximity', near);
  }
  const inside = pointInRect(point, visible, 2);
  if (!isAutoHidden && inside) mainWindow.setIgnoreMouseEvents(false);
  else mainWindow.setIgnoreMouseEvents(true, { forward: true });
}

function startProximityMonitor() {
  clearInterval(proximityTimer);
  proximityTimer = setInterval(updateProximity, 160);
  proximityTimer.unref?.();
}

function enforceTrayOnlyWindow({ refresh = false } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // Electron can recreate the native window style when a hidden transparent
  // window is shown again. Re-apply this flag so Windows never promotes the
  // island to a normal taskbar/Alt+Tab application window.
  if (refresh) mainWindow.setSkipTaskbar(false);
  mainWindow.setSkipTaskbar(true);
}

function showIsland({ focus = false } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  enforceTrayOnlyWindow();
  if (!mainWindow.isVisible()) mainWindow.showInactive();
  enforceTrayOnlyWindow({ refresh: true });
  mainWindow.moveTop();
  if (focus) mainWindow.focus();
}

function createWindow() {
  const bounds = targetBounds();
  mainWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    closable: true,
    hasShadow: false,
    thickFrame: false,
    show: false,
    title: 'Agent Island',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: process.argv.includes('--dev')
    }
  });

  enforceTrayOnlyWindow();
  mainWindow.setAlwaysOnTop(true, 'pop-up-menu');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  enforceTrayOnlyWindow();
  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
    sendPlacement();
    const latestEvent = apiServer?.history?.[0];
    if (latestEvent) mainWindow.webContents.send('island:event', latestEvent);
    mainWindow.webContents.send('island:agents', activeAgents);
  });
  mainWindow.once('ready-to-show', () => {
    enforceTrayOnlyWindow();
    mainWindow.showInactive();
    enforceTrayOnlyWindow({ refresh: true });
  });
  mainWindow.on('show', () => {
    setImmediate(() => enforceTrayOnlyWindow({ refresh: true }));
    rebuildTrayMenu();
  });
  mainWindow.on('hide', rebuildTrayMenu);
  mainWindow.on('blur', () => {
    mainWindow?.webContents.send('island:external-blur');
  });
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTrayImage() {
  const trayIconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'tray-icon.ico')
    : path.resolve(__dirname, '..', 'build', 'icon.ico');
  const trayIcon = nativeImage.createFromPath(trayIconPath);
  if (!trayIcon.isEmpty()) return trayIcon;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#8aa8ff"/><stop offset="1" stop-color="#8df0d0"/></linearGradient></defs>
      <rect width="32" height="32" rx="10" fill="#080a10"/>
      <rect x="5" y="8" width="22" height="16" rx="8" fill="url(#g)"/>
      <circle cx="23" cy="16" r="3" fill="#080a10"/>
    </svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`).resize({ width: 20, height: 20 });
}

function setAutostart(enabled) {
  settings.startWithWindows = Boolean(enabled);
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: settings.startWithWindows, path: process.execPath });
  }
  saveSettings();
}

function toggleIslandVisibility() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible()) mainWindow.hide();
  else showIsland({ focus: false });
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  if (!tray) return;
  const agentSummary = activeAgents.length
    ? activeAgents.map((agent) => `${agent.label} · ${agent.taskState?.label || 'Idle'}`).join(' · ')
    : 'No supported agents are running';
  const recentWindowsNotifications = (apiServer?.history || [])
    .filter((event) => event.context?.capturedFromWindows)
    .slice(0, 8)
    .map((event) => ({
      label: `${event.sourceLabel} · ${event.title}`.slice(0, 88),
      click: () => {
        showIsland();
        mainWindow?.webContents.send('island:event', { ...event, ttl: 9000 });
      }
    }));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: mainWindow?.isVisible() ? 'Hide Agent Island' : 'Show Agent Island', click: toggleIslandVisibility },
    { label: agentSummary, enabled: false },
    { type: 'separator' },
    {
      label: 'Auto-hide and wake on approach',
      type: 'checkbox',
      checked: settings.autoHide,
      click: (item) => {
        settings.autoHide = item.checked;
        if (!settings.autoHide) isAutoHidden = false;
        saveSettings();
        sendPlacement();
        mainWindow?.webContents.send('island:proximity', true);
        rebuildTrayMenu();
      }
    },
    {
      label: 'Move to top center',
      click: () => {
        const display = screen.getPrimaryDisplay();
        settings.placement = sanitizePlacement({ mode: 'top', ratio: 0.5, displayId: display.id });
        saveSettings();
        sendPlacement();
        animateWindowTo(targetBounds());
      }
    },
    { type: 'separator' },
    {
      label: 'Clipboard history (memory only)',
      type: 'checkbox',
      checked: settings.clipboardHistory,
      click: (item) => {
        settings.clipboardHistory = item.checked;
        saveSettings();
        if (item.checked) startClipboardHistory();
        else stopClipboardHistory();
        rebuildTrayMenu();
      }
    },
    {
      label: 'Capture Windows notifications',
      type: 'checkbox',
      checked: settings.captureWindowsNotifications,
      click: (item) => {
        settings.captureWindowsNotifications = item.checked;
        saveSettings();
        if (item.checked) startWindowsNotificationBridge();
        else stopWindowsNotificationBridge();
        rebuildTrayMenu();
      }
    },
    {
      label: 'Remove captured notifications from Action Center',
      type: 'checkbox',
      checked: settings.dismissCapturedNotifications,
      enabled: settings.captureWindowsNotifications,
      click: (item) => {
        settings.dismissCapturedNotifications = item.checked;
        saveSettings();
        restartWindowsNotificationBridge();
        rebuildTrayMenu();
      }
    },
    { label: `Windows notification access · ${windowsNotificationAccess}`, enabled: false },
    {
      label: 'Recent Windows notifications',
      submenu: recentWindowsNotifications.length ? recentWindowsNotifications : [{ label: 'No notifications yet', enabled: false }]
    },
    { label: 'Open Focus Assist settings', click: () => shell.openExternal('ms-settings:quiethours') },
    { label: 'Test Windows notification capture', click: showWindowsCaptureTest },
    { type: 'separator' },
    {
      label: 'Demo: agent working',
      click: () => apiServer.publish({ source: 'codex', type: 'progress', title: 'Organizing the project', message: '3 of 5 steps complete', progress: 62, ttl: 7000, systemNotify: false })
    },
    {
      label: 'Demo: decision required',
      click: () => apiServer.ask({ source: 'claude', title: 'Allow this test command?', message: 'npm test -- --runInBand', detail: 'This demo does not execute the command.', timeoutMs: 120000 })
    },
    {
      label: 'Demo: task complete',
      click: () => apiServer.publish({ source: 'generic', type: 'success', title: 'Agent finished', message: 'All checks passed.', ttl: 7000 })
    },
    { type: 'separator' },
    {
      label: 'Mirror events to Windows notifications',
      type: 'checkbox',
      checked: settings.systemNotifications,
      enabled: !settings.captureWindowsNotifications,
      click: (item) => { settings.systemNotifications = item.checked; saveSettings(); rebuildTrayMenu(); }
    },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: settings.startWithWindows,
      click: (item) => { setAutostart(item.checked); rebuildTrayMenu(); }
    },
    { label: `Local API · 127.0.0.1:${settings.port}`, enabled: false },
    { type: 'separator' },
    { label: 'Open app folder', click: () => shell.openPath(path.resolve(__dirname, '..')) },
    { label: 'Quit Agent Island', click: () => { isQuitting = true; app.quit(); } }
  ]));
}

function createTray() {
  const trayImage = createTrayImage();
  tray = new Tray(trayImage);
  tray.setToolTip('Agent Island · AI coding agent command center');
  tray.on('click', toggleIslandVisibility);
  rebuildTrayMenu();
}

function showSystemNotification(event) {
  if (settings.captureWindowsNotifications) return;
  if (!settings.systemNotifications || !event.systemNotify || event.silent || !Notification.isSupported()) return;
  if (activeNotification && event.type === 'progress') activeNotification.close();
  activeNotification = new Notification({
    title: `${event.sourceLabel} · ${event.title}`,
    body: event.message || event.detail || 'Status updated',
    silent: event.silent,
    urgency: event.type === 'decision' || event.type === 'error' ? 'critical' : 'normal',
    timeoutType: event.type === 'decision' ? 'never' : 'default'
  });
  activeNotification.on('click', () => showIsland({ focus: event.type === 'decision' }));
  activeNotification.show();
}

function windowsListenerScriptPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'windows-notification-listener.ps1')
    : path.resolve(__dirname, '..', 'scripts', 'windows-notification-listener.ps1');
}

function glyphForApp(appName = 'Windows') {
  const parts = String(appName).trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  return [...(parts[0] || 'W')].slice(0, 2).join('').toUpperCase();
}

const EVENT_STATUS_LABELS = {
    working: 'Working',
    progress: 'In progress',
    success: 'Complete',
    error: 'Needs attention',
    warning: 'Waiting',
    decision: 'Decision needed',
    notification: 'Notification'
};

const SOURCE_PROCESS_HINTS = {
  codex: ['ChatGPT', 'codex'],
  claude: ['WindowsTerminal', 'powershell', 'cmd'],
  cursor: ['Cursor'],
  opencode: ['OpenCode', 'WindowsTerminal'],
  windsurf: ['Windsurf']
};

function processHintsForApp(appName = '') {
  const compact = String(appName).replace(/\s+/g, '');
  const common = {
    ChatGPT: ['ChatGPT'],
    Outlook: ['OUTLOOK', 'olk'],
    'Microsoft Outlook': ['OUTLOOK', 'olk'],
    Teams: ['ms-teams', 'Teams'],
    微信: ['WeChat'],
    QQ: ['QQ'],
    Telegram: ['Telegram'],
    Discord: ['Discord'],
    Slack: ['slack']
  };
  return common[appName] || [appName, compact].filter(Boolean);
}

function targetForAgent(agent) {
  return {
    kind: 'process',
    processIds: agent?.processIds || [],
    processNames: agent?.focusProcessNames || SOURCE_PROCESS_HINTS[agent?.id] || []
  };
}

function targetForEvent(event) {
  const activeAgent = activeAgents.find((agent) => agent.id === event.source);
  if (activeAgent) return targetForAgent(activeAgent);
  if (event.context?.appUserModelId || event.context?.capturedFromWindows) {
    return {
      kind: 'application',
      appUserModelId: event.context?.appUserModelId || '',
      processIds: [],
      processNames: processHintsForApp(event.sourceLabel)
    };
  }
  const processNames = SOURCE_PROCESS_HINTS[event.source] || [];
  return processNames.length ? { kind: 'process', processIds: [], processNames } : null;
}

function buildWorkItems() {
  const items = [];
  for (const agent of activeAgents) {
  const taskState = agent.taskState || { status: 'idle', label: 'Idle', title: '', message: '' };
    const isActiveTask = ['working', 'waiting'].includes(taskState.status);
    items.push({
      id: `agent:${agent.id}`,
      kind: 'agent',
      glyph: agent.glyph,
      accent: agent.id,
      title: `${agent.label} · ${taskState.label}`,
      subtitle: isActiveTask
      ? `${taskState.message || taskState.title || 'Processing a task'} · Click to return`
      : `${agent.processCount} process${agent.processCount === 1 ? '' : 'es'} · No active task · Click to return`,
      status: taskState.label,
      target: targetForAgent(agent)
    });
  }

  const seenTasks = new Set();
  for (const event of apiServer?.history || []) {
    if (!['codex', 'claude', 'cursor', 'opencode', 'windsurf'].includes(event.source)) continue;
    if (event.context?.presenceOnly) continue;
    const key = event.taskId || `${event.source}:${event.title}`;
    if (seenTasks.has(key)) continue;
    seenTasks.add(key);
    items.push({
      id: `task:${event.id}`,
      kind: 'task',
      glyph: event.sourceGlyph,
      accent: event.source,
      title: event.title,
      subtitle: event.message || event.detail || event.sourceLabel,
      status: EVENT_STATUS_LABELS[event.type] || 'Task',
      target: targetForEvent(event)
    });
    if (seenTasks.size >= 4) break;
  }

  for (const event of (apiServer?.history || []).filter((item) => item.context?.capturedFromWindows).slice(0, 5)) {
    items.push({
      id: `notification:${event.id}`,
      kind: 'notification',
      glyph: event.sourceGlyph,
      accent: 'system',
      title: `${event.sourceLabel} · ${event.title}`,
      subtitle: event.message || 'Windows notification',
      status: 'Notification',
      eventId: event.id,
      deletable: true,
      target: targetForEvent(event)
    });
  }
  return items.slice(0, 12);
}

function focusHelperPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'focus-app-window.ps1')
    : path.resolve(__dirname, '..', 'scripts', 'focus-app-window.ps1');
}

function focusExistingWindow(target = {}) {
  return new Promise((resolve) => {
    const args = [
      '-NoProfile',
      '-STA',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      focusHelperPath(),
      '-ProcessIds',
      (target.processIds || []).join(','),
      '-ProcessNames',
      (target.processNames || []).join(',')
    ];
    execFile('powershell.exe', args, { encoding: 'utf8', windowsHide: true, timeout: 7000 }, (error, stdout) => {
      try {
        const result = JSON.parse(String(stdout || '').trim());
        resolve(Boolean(result.ok));
      } catch {
        resolve(!error);
      }
    });
  });
}

function deleteHistoryEvent(eventId) {
  const before = apiServer?.history?.length || 0;
  if (apiServer) apiServer.history = apiServer.history.filter((event) => event.id !== String(eventId));
  if ((apiServer?.history?.length || 0) === before) return { ok: false, error: 'The notification does not exist or was already deleted.' };
  mainWindow?.webContents.send('island:event-deleted', String(eventId));
  rebuildTrayMenu();
  return { ok: true };
}

async function activateTarget(target = {}) {
  if (target.url) {
    await shell.openExternal(target.url);
    return { ok: true, action: 'url' };
  }
  if ((target.processIds?.length || 0) > 0 || (target.processNames?.length || 0) > 0) {
    if (await focusExistingWindow(target)) return { ok: true, action: 'focused' };
  }
  if (target.appUserModelId) {
    const child = spawn('explorer.exe', [`shell:AppsFolder\\${target.appUserModelId}`], { detached: true, windowsHide: true });
    child.unref();
    return { ok: true, action: 'launched' };
  }
  return { ok: false, error: 'No matching application window was found.' };
}

function publishWindowsNotification(payload) {
  const appName = String(payload.appName || 'Windows').trim() || 'Windows';
  apiServer.publish({
    source: 'system',
    sourceLabel: appName,
    sourceGlyph: glyphForApp(appName),
    type: 'notification',
    title: payload.title || `${appName} notification`,
    message: payload.message || '',
    detail: `From ${appName} · Windows notification`,
    ttl: 6500,
    systemNotify: false,
    context: {
      capturedFromWindows: true,
      windowsNotificationId: payload.id,
      appUserModelId: payload.appUserModelId || '',
      originalCreatedAt: payload.createdAt
    }
  });
  rebuildTrayMenu();
}

function startWindowsNotificationBridge() {
  if (process.platform !== 'win32' || !settings.captureWindowsNotifications || windowsNotificationBridge) return;
  windowsNotificationAccess = 'Starting';
  windowsNotificationBridge = new WindowsNotificationBridge({
    scriptPath: windowsListenerScriptPath(),
    pollMilliseconds: 1200,
    removeAfterRead: settings.dismissCapturedNotifications
  });
  apiServer.windowsNotificationState = {
    enabled: true,
    access: windowsNotificationAccess,
    removeAfterRead: settings.dismissCapturedNotifications
  };
  windowsNotificationBridge.on('status', (status) => {
    windowsNotificationAccess = status.access || 'Unknown';
    clipboardHistory?.setExternalMonitoring(status.access === 'Allowed');
    apiServer.windowsNotificationState = {
      enabled: true,
      access: windowsNotificationAccess,
      removeAfterRead: settings.dismissCapturedNotifications
    };
    rebuildTrayMenu();
    if (status.access === 'Denied') {
      apiServer.publish({
        source: 'system',
        type: 'warning',
        title: 'Windows notification access is required',
        message: 'Allow notification access in Windows Settings, then enable capture again.',
        ttl: 0,
        systemNotify: false
      });
    }
  });
  windowsNotificationBridge.on('notification', publishWindowsNotification);
  windowsNotificationBridge.on('clipboard-changed', () => clipboardHistory?.poll());
  windowsNotificationBridge.on('bridge-error', () => {});
  windowsNotificationBridge.start();
  rebuildTrayMenu();
}

function stopWindowsNotificationBridge() {
  windowsNotificationBridge?.stop();
  windowsNotificationBridge = null;
  clipboardHistory?.setExternalMonitoring(false);
  windowsNotificationAccess = 'Stopped';
  if (apiServer) apiServer.windowsNotificationState = { enabled: false, access: windowsNotificationAccess, removeAfterRead: false };
  rebuildTrayMenu();
}

function restartWindowsNotificationBridge() {
  stopWindowsNotificationBridge();
  if (settings.captureWindowsNotifications) startWindowsNotificationBridge();
}

function startClipboardHistory() {
  if (!settings.clipboardHistory || clipboardHistory) return;
  clipboardHistory = new ClipboardHistory({ clipboard, nativeImage, maxItems: 30, pollMs: 1500 });
  clipboardHistory.on('changed', (items) => {
    mainWindow?.webContents.send('island:clipboard-changed', items);
  });
  clipboardHistory.start();
}

function stopClipboardHistory() {
  clipboardHistory?.clear();
  clipboardHistory?.stop();
  clipboardHistory = null;
  mainWindow?.webContents.send('island:clipboard-changed', []);
}

function startTodoStore() {
  todoStore = new TodoStore({ filePath: todosPath() });
  todoStore.on('changed', (items) => {
    mainWindow?.webContents.send('island:todos-changed', items);
  });
}

async function exportTodosToNotion() {
  if (!todoStore?.getItems().length) return { ok: false, error: 'There are no todos to send to Notion.' };
  clipboard.writeText(todoStore.exportMarkdown());
  await shell.openExternal('https://www.notion.so/');
  return {
    ok: true,
    mode: 'clipboard',
    message: 'Todos were copied as Markdown and Notion was opened. Paste them into your page.'
  };
}

function showWindowsCaptureTest() {
  if (!Notification.isSupported()) return;
  new Notification({
    title: 'Windows notification capture test',
    body: 'Agent Island should capture and display this notification.',
    silent: true
  }).show();
}

function syncAgentTaskStates() {
  activeAgents = taskTracker.mergeAgents(activeAgents);
  if (apiServer) apiServer.activeAgents = activeAgents;
  mainWindow?.webContents.send('island:agents', activeAgents);
  rebuildTrayMenu();
}

function wireApiEvents() {
  apiServer.on('event', (event) => {
    if (taskTracker.updateFromEvent(event)) syncAgentTaskStates();
    if (event.context?.presenceOnly) return;
    showIsland({ focus: event.type === 'decision' });
    mainWindow?.webContents.send('island:event', event);
    showSystemNotification(event);
  });
  apiServer.on('decision-resolved', (decision) => {
    if (taskTracker.resolveDecision(decision)) syncAgentTaskStates();
    mainWindow?.webContents.send('island:decision-resolved', decision);
  });
}

function registerIpc() {
  ipcMain.handle('island:resize', (_event, size = {}) => {
    const width = Math.max(36, Math.min(CANVAS_WINDOW.width, Math.round(Number(size.width) || islandLayoutSize.width)));
    const height = Math.max(30, Math.min(CANVAS_WINDOW.height, Math.round(Number(size.height) || islandLayoutSize.height)));
    islandLayoutSize = { width, height };
    return true;
  });
  ipcMain.handle('island:set-interactive', (_event, interactive) => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (!interactive) mainWindow.setIgnoreMouseEvents(true, { forward: true });
    else updateProximity();
    return true;
  });
  ipcMain.handle('island:set-auto-hidden', (_event, hidden) => {
    isAutoHidden = Boolean(hidden) && settings.autoHide;
    if (isAutoHidden) mainWindow?.setIgnoreMouseEvents(true, { forward: true });
    return { ok: true, hidden: isAutoHidden };
  });
  ipcMain.handle('island:drag-start', () => startIslandDrag());
  ipcMain.handle('island:drag-end', () => endIslandDrag());
  ipcMain.handle('island:resolve-snap', (_event, accept) => resolveSnapOffer(Boolean(accept)));
  ipcMain.handle('island:respond', (_event, { id, choice }) => apiServer.respond(id, choice));
  ipcMain.handle('island:hide', () => mainWindow?.hide());
  ipcMain.handle('island:get-state', () => ({ api: apiServer.getState(), settings: { ...settings, placement: placementPayload() }, activeAgents }));
  ipcMain.handle('island:get-work-items', () => buildWorkItems());
  ipcMain.handle('island:activate-target', (_event, target) => activateTarget(target));
  ipcMain.handle('island:delete-history-event', (_event, id) => deleteHistoryEvent(id));
  ipcMain.handle('island:get-clipboard-items', () => clipboardHistory?.getItems() || []);
  ipcMain.handle('island:restore-clipboard-item', (_event, id) => clipboardHistory?.restore(id) || { ok: false, error: 'Clipboard history is disabled.' });
  ipcMain.handle('island:clear-clipboard-history', () => clipboardHistory?.clear() || { ok: true });
  ipcMain.handle('island:get-todos', () => todoStore?.getItems() || []);
  ipcMain.handle('island:create-todo', (_event, title) => todoStore?.create(title) || { ok: false, error: 'Todo storage is unavailable.' });
  ipcMain.handle('island:toggle-todo', (_event, id) => todoStore?.toggle(id) || { ok: false, error: 'Todo storage is unavailable.' });
  ipcMain.handle('island:toggle-todo-timer', (_event, id) => todoStore?.toggleTimer(id) || { ok: false, error: 'Todo storage is unavailable.' });
  ipcMain.handle('island:delete-todo', (_event, id) => todoStore?.delete(id) || { ok: false, error: 'Todo storage is unavailable.' });
  ipcMain.handle('island:clear-completed-todos', () => todoStore?.clearCompleted() || { ok: true });
  ipcMain.handle('island:export-todos-to-notion', () => exportTodosToNotion());
}

function startAgentMonitor() {
  agentMonitor = new AgentProcessMonitor();
  agentMonitor.on('agents', (agents) => {
    activeAgents = taskTracker.mergeAgents(agents);
    apiServer.activeAgents = activeAgents;
    mainWindow?.webContents.send('island:agents', activeAgents);
    rebuildTrayMenu();
  });
  agentMonitor.on('error', () => {});
  agentMonitor.start();
}

function hasRecentCodexEvent(state, acceptedTypes) {
  const cutoff = Date.now() - 4000;
  return (apiServer?.history || []).some((event) => (
    event.source === 'codex'
    && !event.context?.codexSessionMonitor
    && acceptedTypes.includes(event.type)
    && (!state.taskId || !event.taskId || event.taskId === state.taskId)
    && new Date(event.timestamp).getTime() >= cutoff
  ));
}

function startCodexSessionMonitor() {
  const codexHome = process.env.CODEX_HOME || path.join(app.getPath('home'), '.codex');
  codexSessionMonitor = new CodexSessionMonitor({ sessionsRoot: path.join(codexHome, 'sessions') });
  codexSessionMonitor.on('state', (state, meta) => {
    taskTracker.setExternalState('codex', state);
    syncAgentTaskStates();
    if (meta.initial || meta.transition === 'update') return;

    if (meta.transition === 'start' && !hasRecentCodexEvent(state, ['working', 'progress'])) {
      apiServer.publish({
        source: 'codex',
        type: 'working',
        title: state.title,
        message: state.message,
        taskId: state.taskId,
        ttl: 0,
        silent: true,
        systemNotify: false,
        context: { hookEventName: 'CodexDesktopTaskStarted', codexSessionMonitor: true, sessionId: state.sessionId }
      });
    }
    if (meta.transition === 'complete' && !hasRecentCodexEvent(state, ['success', 'error'])) {
      apiServer.publish({
        source: 'codex',
        type: 'success',
        title: 'Codex finished',
        message: 'The current Codex task has finished.',
        taskId: state.taskId,
        ttl: 6500,
        systemNotify: true,
        context: { hookEventName: 'CodexDesktopTaskComplete', codexSessionMonitor: true }
      });
    }
  });
  codexSessionMonitor.on('error', () => {});
  codexSessionMonitor.start();
}

async function runSmokeCapture() {
  if (!smokeCaptureArg) return false;
  const smokeClipboard = process.argv.includes('--smoke-clipboard');
  const smokeTodo = process.argv.includes('--smoke-todo');
  const smokeRepairs = process.argv.includes('--smoke-repairs');
  const smokePixelArg = process.argv.find((arg) => arg.startsWith('--smoke-pixel='));
  const smokePixel = smokePixelArg?.slice('--smoke-pixel='.length) || '';
  const smokePlacementArg = process.argv.find((arg) => arg.startsWith('--smoke-placement='));
  const smokePlacement = smokePlacementArg?.slice('--smoke-placement='.length) || '';
  const smokeSideExpanded = process.argv.includes('--smoke-side-expanded');
  const smokeFullCanvas = process.argv.includes('--smoke-full-canvas');
  const smokeWorkspace = smokeClipboard || smokeTodo || smokeRepairs || process.argv.includes('--smoke-workspace');
  const output = smokeCaptureArg.slice('--smoke-capture='.length);
  const outputPath = path.resolve(process.cwd(), output);
  if (mainWindow.webContents.isLoadingMainFrame()) {
    await new Promise((resolve) => mainWindow.webContents.once('did-finish-load', resolve));
  }
  const anchoredBounds = mainWindow.getBounds();
  const expectedBounds = targetBounds();
  if (anchoredBounds.x !== expectedBounds.x || anchoredBounds.y !== expectedBounds.y) {
    throw new Error(`Island is not anchored to the primary display: ${JSON.stringify(anchoredBounds)}`);
  }
  if (smokePlacement) {
    if (!['top', 'bottom', 'left', 'right', 'free'].includes(smokePlacement)) {
      throw new Error(`Unknown placement smoke mode: ${smokePlacement}`);
    }
    const display = screen.getPrimaryDisplay();
    settings.placement = smokePlacement === 'free'
      ? sanitizePlacement({ mode: 'free', x: display.bounds.x + 300, y: display.bounds.y + 180, displayId: display.id })
      : sanitizePlacement({ mode: smokePlacement, ratio: 0.5, displayId: display.id });
    positionIsland();
    sendPlacement();
    await new Promise((resolve) => setTimeout(resolve, 420));
    mainWindow.webContents.send('island:proximity', false);
    await new Promise((resolve) => setTimeout(resolve, 820));
    const placementState = await mainWindow.webContents.executeJavaScript(`(() => {
      const island = document.getElementById('island');
      const rect = island.getBoundingClientRect();
      return {
        mode: document.body.dataset.placement,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        hidden: island.classList.contains('is-auto-hidden')
      };
    })()`);
    const shouldBeVertical = smokePlacement === 'left' || smokePlacement === 'right';
    if (placementState.mode !== smokePlacement || !placementState.hidden
      || (shouldBeVertical && (placementState.width > 50 || placementState.height < 86))) {
      throw new Error(`Placement did not render correctly: ${JSON.stringify(placementState)}`);
    }
    mainWindow.webContents.send('island:proximity', true);
    await new Promise((resolve) => setTimeout(resolve, 420));
    const revealed = await mainWindow.webContents.executeJavaScript("!document.getElementById('island').classList.contains('is-auto-hidden')");
    if (!revealed) throw new Error('Proximity wake did not reveal the island');
    if (smokeSideExpanded) {
      await mainWindow.webContents.executeJavaScript("document.getElementById('island').dispatchEvent(new MouseEvent('mouseenter'))");
      await new Promise((resolve) => setTimeout(resolve, 440));
      const expandedState = await mainWindow.webContents.executeJavaScript(`(() => {
        const rect = document.getElementById('island').getBoundingClientRect();
        return { width: Math.round(rect.width), height: Math.round(rect.height) };
      })()`);
      if (!shouldBeVertical || expandedState.width < 260 || expandedState.height > 70) {
        throw new Error(`Side hover did not expand horizontally: ${JSON.stringify(expandedState)}`);
      }
    }
    const placementBounds = await mainWindow.webContents.executeJavaScript(`(() => {
      const rect = document.getElementById('island').getBoundingClientRect();
      return { x: Math.floor(rect.x), y: Math.floor(rect.y), width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
    })()`);
    const placementImage = await mainWindow.webContents.capturePage(placementBounds);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, placementImage.toPNG());
    console.log(`Placement ${smokePlacement} smoke capture: ${outputPath}`);
    isQuitting = true;
    app.quit();
    return true;
  }
  if (smokePixel) {
    if (!['working', 'resting', 'alert'].includes(smokePixel)) throw new Error(`Unknown pixel smoke state: ${smokePixel}`);
    activeAgents = taskTracker.mergeAgents([
      { id: 'codex', label: 'Codex', glyph: 'CX', processCount: 1, processIds: [], focusProcessNames: ['ChatGPT', 'codex'] }
    ]);
    apiServer.activeAgents = activeAgents;
    mainWindow.webContents.send('island:agents', activeAgents);
    const pixelEvents = {
    working: { source: 'codex', type: 'working', title: 'Codex is organizing code', message: 'The pixel agent is on the move', ttl: 0 },
    resting: { source: 'codex', type: 'success', title: 'Agent finished the task', message: 'The pixel agent is taking a break', ttl: 0 },
    alert: { source: 'system', type: 'notification', title: 'Needs your attention', message: 'The pixel agent is signaling you', ttl: 0 }
    };
    apiServer.publish({ ...pixelEvents[smokePixel], systemNotify: false });
    await new Promise((resolve) => setTimeout(resolve, 780));
    if (smokePixel !== 'alert') {
      await mainWindow.webContents.executeJavaScript("document.getElementById('dismissButton')?.click()");
      await new Promise((resolve) => setTimeout(resolve, 420));
    }
    const pixelState = await mainWindow.webContents.executeJavaScript('window.__agentIslandSmoke?.pixelState()');
    if (pixelState !== smokePixel) throw new Error(`Pixel state mismatch: expected ${smokePixel}, got ${pixelState}`);
    const expectedTaskStatus = smokePixel === 'working' ? 'working' : 'idle';
    if (activeAgents[0]?.taskState?.status !== expectedTaskStatus) {
      throw new Error(`Task state mismatch: expected ${expectedTaskStatus}, got ${activeAgents[0]?.taskState?.status}`);
    }
    const pixelBounds = await mainWindow.webContents.executeJavaScript(`(() => {
      const rect = document.getElementById('island').getBoundingClientRect();
      return { x: Math.floor(rect.x), y: Math.floor(rect.y), width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
    })()`);
    const pixelImage = await mainWindow.webContents.capturePage(pixelBounds);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, pixelImage.toPNG());
    console.log(`Pixel ${smokePixel} smoke capture: ${outputPath}`);
    isQuitting = true;
    app.quit();
    return true;
  }
  if (smokeWorkspace) {
    activeAgents = [
      { id: 'codex', label: 'Codex', glyph: 'CX', processCount: 1, processIds: [], focusProcessNames: ['ChatGPT', 'codex'] },
      { id: 'claude', label: 'Claude', glyph: 'CL', processCount: 2, processIds: [], focusProcessNames: ['WindowsTerminal', 'powershell', 'cmd'] }
    ];
    apiServer.activeAgents = activeAgents;
  }
  if (smokeClipboard) {
    clipboardHistory.addText('npm test && npm run build');
    clipboardHistory.addText('Turn the expanded view into work and clipboard pages');
    clipboardHistory.addText('Scroll down to switch pages and up to return');
  }
  if (smokeTodo) {
    todoStore = new TodoStore({ now: () => new Date('2026-07-15T08:00:00.000Z') });
    todoStore.on('changed', (items) => mainWindow?.webContents.send('island:todos-changed', items));
    const completed = todoStore.create('Fix notification deletion').item;
    todoStore.toggle(completed.id);
    const running = todoStore.create('Polish the todo timer animation').item;
    todoStore.toggleTimer(running.id);
    todoStore.create('Design the Notion sync entry point');
  }
  if (smokeRepairs) {
    apiServer.publish({
      source: 'system',
      sourceLabel: 'Outlook',
      sourceGlyph: 'OU',
      type: 'notification',
      title: 'Deletable notification test',
      message: 'This notification should show its own delete button.',
      systemNotify: false,
      context: { capturedFromWindows: true, appUserModelId: 'Microsoft.OutlookForWindows_8wekyb3d8bbwe!Microsoft.OutlookforWindows' }
    });
  }
  const smokeDecision = apiServer.ask({
    id: 'ui-smoke-decision',
    source: 'claude',
      title: 'Allow the pre-release checks?',
    message: 'npm test && npm run build',
      detail: 'The agent will run local tests and build the Windows package.',
    actions: [
        { id: 'allow', label: 'Allow', style: 'primary' },
        { id: 'deny', label: 'Deny', style: 'danger' }
    ],
    systemNotify: false,
    timeoutMs: 5000
  });
  await new Promise((resolve) => setTimeout(resolve, 900));
  if (process.argv.includes('--smoke-collapsed')) {
    await mainWindow.webContents.executeJavaScript('window.__agentIslandSmoke?.collapse()');
    await new Promise((resolve) => setTimeout(resolve, 720));
  }
  if (smokeWorkspace) {
    await mainWindow.webContents.executeJavaScript(`(() => {
      const island = document.getElementById('island');
      island.dispatchEvent(new MouseEvent('mouseenter'));
      island.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 620));
    const workspaceState = await mainWindow.webContents.executeJavaScript(`(() => {
      const island = document.getElementById('island');
      const list = document.getElementById('workList');
      const rect = island.getBoundingClientRect();
      return {
        open: island.classList.contains('is-workspace'),
        itemCount: list.children.length,
        width: rect.width,
        height: rect.height
      };
    })()`);
    if (!workspaceState.open || workspaceState.itemCount < 3 || workspaceState.width < 410 || workspaceState.height < 190) {
      throw new Error(`Workspace did not open correctly: ${JSON.stringify(workspaceState)}`);
    }
  }
  if (smokeRepairs) {
    const deletionState = await mainWindow.webContents.executeJavaScript(`(async () => {
      const row = document.querySelector('.work-item.notification');
      const button = row?.querySelector('.row-delete-button');
      if (!button) return { hadButton: false, removed: false };
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 260));
      return { hadButton: true, removed: !document.querySelector('.work-item.notification') };
    })()`);
    if (!deletionState.hadButton || !deletionState.removed || apiServer.history.some((event) => event.title === 'Deletable notification test')) {
      throw new Error(`Notification deletion failed: ${JSON.stringify(deletionState)}`);
    }
  }
  if (smokeTodo || smokeClipboard) {
    await mainWindow.webContents.executeJavaScript(`(() => {
      const list = document.getElementById('workList');
      list.scrollTop = list.scrollHeight;
      document.getElementById('workView').dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 470));
    const todoState = await mainWindow.webContents.executeJavaScript(`(() => ({
      active: document.getElementById('workspaceTrack').classList.contains('is-todo'),
      selected: document.getElementById('todoTab').getAttribute('aria-selected'),
      itemCount: document.getElementById('todoList').children.length,
      runningCount: document.querySelectorAll('.todo-timer-button.is-running').length,
      notionVisible: !document.getElementById('notionTodoButton').hidden
    }))()`);
    if (!todoState.active || todoState.selected !== 'true' || (smokeTodo && (todoState.itemCount < 3 || todoState.runningCount !== 1 || !todoState.notionVisible))) {
      throw new Error(`Todo page did not open correctly: ${JSON.stringify(todoState)}`);
    }
  }
  if (smokeClipboard) {
    await mainWindow.webContents.executeJavaScript(`(() => {
      const list = document.getElementById('todoList');
      list.scrollTop = list.scrollHeight;
      document.getElementById('workView').dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 520));
    const clipboardState = await mainWindow.webContents.executeJavaScript(`(() => ({
      active: document.getElementById('workspaceTrack').classList.contains('is-clipboard'),
      selected: document.getElementById('clipboardTab').getAttribute('aria-selected'),
      itemCount: document.getElementById('clipboardList').children.length,
      hint: document.getElementById('workspaceHint').textContent
    }))()`);
    if (!clipboardState.active || clipboardState.selected !== 'true' || clipboardState.itemCount < 3 || !clipboardState.hint.includes('todo')) {
      throw new Error(`Clipboard page did not open correctly: ${JSON.stringify(clipboardState)}`);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 180));
  const captureBounds = smokeFullCanvas
    ? { x: 0, y: 0, width: CANVAS_WINDOW.width, height: CANVAS_WINDOW.height }
    : await mainWindow.webContents.executeJavaScript(`(() => {
      const rect = document.getElementById('island').getBoundingClientRect();
      return { x: Math.floor(rect.x), y: Math.floor(rect.y), width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
    })()`);
  const image = await mainWindow.webContents.capturePage(captureBounds);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, image.toPNG());
  if (smokeRepairs) {
    mainWindow.webContents.send('island:external-blur');
    await new Promise((resolve) => setTimeout(resolve, 380));
    const blurState = await mainWindow.webContents.executeJavaScript(`(() => {
      const island = document.getElementById('island');
      return { open: island.classList.contains('is-workspace'), width: island.getBoundingClientRect().width };
    })()`);
    if (blurState.open || blurState.width > 396) throw new Error(`External blur did not collapse the island: ${JSON.stringify(blurState)}`);
  }
  if (process.argv.includes('--smoke-collapsed')) {
    const canvasBeforeHover = mainWindow.getBounds();
    await mainWindow.webContents.executeJavaScript("document.getElementById('island')?.dispatchEvent(new MouseEvent('mouseenter'))");
    await new Promise((resolve) => setTimeout(resolve, 460));
    const islandWidth = await mainWindow.webContents.executeJavaScript("document.getElementById('island').getBoundingClientRect().width");
    if (islandWidth < 380) throw new Error('Hover did not expand the island');
    const canvasAfterHover = mainWindow.getBounds();
    if (canvasBeforeHover.width !== canvasAfterHover.width || canvasBeforeHover.height !== canvasAfterHover.height) {
      throw new Error('Native window resized during the CSS animation');
    }
  }
  if (smokeWorkspace && !smokeRepairs) {
    await mainWindow.webContents.executeJavaScript("document.getElementById('workBackButton')?.click()");
    await new Promise((resolve) => setTimeout(resolve, 380));
  }
  await mainWindow.webContents.executeJavaScript("document.querySelector('.action-button.primary')?.click()");
  const smokeResult = await Promise.race([
    smokeDecision.result,
    new Promise((_, reject) => setTimeout(() => reject(new Error('UI decision click timed out')), 2000))
  ]);
  if (smokeResult.choice !== 'allow') throw new Error(`UI decision returned ${smokeResult.choice || smokeResult.status}`);
  console.log(`UI smoke capture: ${outputPath}`);
  isQuitting = true;
  app.quit();
  return true;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showIsland({ focus: true }));
  app.whenReady().then(async () => {
    loadSettings();
    createWindow();
    await showFirstRunPrivacyNotice();
    startClipboardHistory();
    startTodoStore();
    apiServer = new AgentIslandServer({ port: smokeCaptureArg ? 0 : settings.port });
    wireApiEvents();
    registerIpc();
    createTray();
    await apiServer.start();

    screen.on('display-metrics-changed', positionIsland);
    screen.on('display-added', positionIsland);
    screen.on('display-removed', positionIsland);

    if (!(await runSmokeCapture())) {
      startProximityMonitor();
      startAgentMonitor();
      startCodexSessionMonitor();
      startWindowsNotificationBridge();
      setTimeout(() => {
        apiServer.publish({
          source: 'system',
          type: 'success',
          title: 'Agent Island is ready',
          message: `Listening on 127.0.0.1:${settings.port}`,
          ttl: 4500,
          systemNotify: false
        });
      }, 450);
    }
  }).catch((error) => {
    console.error(error);
    app.quit();
  });
}

app.on('before-quit', () => { isQuitting = true; });
app.on('will-quit', () => {
  clearInterval(proximityTimer);
  clearInterval(dragTimer);
  clearInterval(snapAnimationTimer);
  windowsNotificationBridge?.stop();
  agentMonitor?.stop();
  codexSessionMonitor?.stop();
  clipboardHistory?.stop();
  apiServer?.stop();
});
app.on('window-all-closed', () => {});
