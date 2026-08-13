const island = document.getElementById('island');
const idleView = document.getElementById('idleView');
const eventView = document.getElementById('eventView');
const workView = document.getElementById('workView');
const workList = document.getElementById('workList');
const workCount = document.getElementById('workCount');
const workEmpty = document.getElementById('workEmpty');
const workBackButton = document.getElementById('workBackButton');
const workspaceTabs = document.getElementById('workspaceTabs');
const workTab = document.getElementById('workTab');
const todoTab = document.getElementById('todoTab');
const clipboardTab = document.getElementById('clipboardTab');
const workspaceTrack = document.getElementById('workspaceTrack');
const todoList = document.getElementById('todoList');
const todoEmpty = document.getElementById('todoEmpty');
const todoComposer = document.getElementById('todoComposer');
const todoInput = document.getElementById('todoInput');
const addTodoButton = document.getElementById('addTodoButton');
const notionTodoButton = document.getElementById('notionTodoButton');
const todoToast = document.getElementById('todoToast');
const clipboardList = document.getElementById('clipboardList');
const clipboardEmpty = document.getElementById('clipboardEmpty');
const clearClipboardButton = document.getElementById('clearClipboardButton');
const workspaceHint = document.getElementById('workspaceHint');
const brandName = document.getElementById('brandName');
const idleAgents = document.getElementById('idleAgents');
const idleTodoTimer = document.getElementById('idleTodoTimer');
const clock = document.getElementById('clock');
const sourceGlyph = document.getElementById('sourceGlyph');
const sourceLabel = document.getElementById('sourceLabel');
const statusLabel = document.getElementById('statusLabel');
const queueCount = document.getElementById('queueCount');
const eventTitle = document.getElementById('eventTitle');
const eventMessage = document.getElementById('eventMessage');
const eventDetail = document.getElementById('eventDetail');
const statusIcon = document.getElementById('statusIcon');
const progressWrap = document.getElementById('progressWrap');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const actions = document.getElementById('actions');
const dismissButton = document.getElementById('dismissButton');
const footerText = document.getElementById('footerText');
const pixelAgents = [...document.querySelectorAll('[data-pixel-agent]')];
const dragHandle = document.getElementById('dragHandle');
const snapOffer = document.getElementById('snapOffer');
const snapOfferText = document.getElementById('snapOfferText');
const acceptSnapButton = document.getElementById('acceptSnapButton');
const declineSnapButton = document.getElementById('declineSnapButton');

const TYPE_INFO = {
  working: {
    label: 'Working',
    icon: '<svg viewBox="0 0 20 20"><path d="M10 3a7 7 0 1 1-7 7"/><path d="M3 5v5h5"/></svg>',
    className: 'is-spinning'
  },
  progress: {
    label: 'In progress',
    icon: '<svg viewBox="0 0 20 20"><path d="M10 3a7 7 0 1 1-7 7"/><path d="M3 5v5h5"/></svg>',
    className: 'is-spinning'
  },
  success: {
    label: 'Completed',
    icon: '<svg viewBox="0 0 20 20"><path d="M4 10.5l3.5 3.5L16 5.5"/></svg>',
    className: ''
  },
  error: {
    label: 'Needs attention',
    icon: '<svg viewBox="0 0 20 20"><path d="M10 3l7 13H3L10 3z"/><path d="M10 7v4M10 14h.01"/></svg>',
    className: ''
  },
  warning: {
    label: 'Waiting',
    icon: '<svg viewBox="0 0 20 20"><path d="M10 3l7 13H3L10 3z"/><path d="M10 7v4M10 14h.01"/></svg>',
    className: 'is-pulsing'
  },
  decision: {
    label: 'Decision needed',
    icon: '<svg viewBox="0 0 20 20"><path d="M7.5 7a2.7 2.7 0 1 1 3.9 2.4c-.9.5-1.4 1-1.4 2.1M10 15h.01"/><circle cx="10" cy="10" r="7"/></svg>',
    className: 'is-pulsing'
  },
  notification: {
    label: 'Notification',
    icon: '<svg viewBox="0 0 20 20"><path d="M5.5 8a4.5 4.5 0 0 1 9 0c0 5 2 5 2 6H3.5c0-1 2-1 2-6zM8 16h4"/></svg>',
    className: ''
  }
};

const ACCENTS = {
  error: '#ff7888',
  warning: '#ffc56c',
  decision: '#ffbf63',
  success: '#79e1bd'
};

const IDLE_COLLAPSED = { width: 146, height: 38 };
const IDLE_EXPANDED = { width: 282, height: 54 };
const SIDE_IDLE_COLLAPSED = { width: 40, height: 92 };
const SIDE_IDLE_EXPANDED = { width: 276, height: 56 };
const WORKSPACE_PAGES = ['work', 'todo', 'clipboard'];

let currentEvent = null;
let dismissTimer = null;
let peekTimer = null;
let collapseTimer = null;
let queuedEvents = [];
let expanded = false;
let pinned = false;
let hovered = false;
let workspaceOpen = false;
let workItems = [];
let todos = [];
let clipboardItems = [];
let workspacePage = 'work';
let todoSnapshotAt = Date.now();
let currentAgents = [];
let todoToastTimer = null;
let wheelAccumulator = 0;
let wheelResetTimer = null;
let lastWheelSwitch = 0;
let basePixelState = 'resting';
let placementMode = 'top';
let autoHideEnabled = true;
let autoHidden = false;
let proximityNear = true;
let autoHideTimer = null;
let dragging = false;
let snapOfferEdge = '';

const PIXEL_ALERT_TYPES = new Set(['notification', 'decision', 'warning', 'error']);

function updatePixelAgents() {
  let state = basePixelState;
  if (currentEvent && PIXEL_ALERT_TYPES.has(currentEvent.type)) state = 'alert';
  else if (currentEvent && ['working', 'progress'].includes(currentEvent.type)) state = 'working';
  else if (currentEvent?.type === 'success') state = 'resting';

  if (island.dataset.pixelState === state) return;
  island.dataset.pixelState = state;
  const labels = {
    working: 'Agent is working',
    resting: 'Agent is resting',
    alert: 'Agent needs your attention'
  };
  for (const pixelAgent of pixelAgents) {
    pixelAgent.dataset.state = state;
    pixelAgent.setAttribute('aria-label', labels[state]);
  }
}

function updateClock() {
  clock.textContent = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
}

function setWindowSize(size, { instant = false, duration = 320 } = {}) {
  island.style.setProperty('--layout-duration', `${instant ? 1 : duration}ms`);
  island.style.setProperty('--island-width', `${size.width}px`);
  island.style.setProperty('--island-height', `${size.height}px`);
  window.agentIsland.resize(size);
}

function collapsedEventSize(event) {
  const titleWidth = Math.min(64, [...(event.title || '')].length) * 6.2;
  const width = Math.max(198, Math.min(event.type === 'decision' ? 268 : 254, 98 + titleWidth));
  return { width: Math.round(width), height: 40 };
}

function expandedEventSize(event) {
  if (event.type === 'decision') return { width: 396, height: event.detail ? 118 : 106 };
  if (event.progress !== null || event.type === 'progress') return { width: 370, height: 88 };
  if (event.detail) return { width: 384, height: 94 };
  return { width: 346, height: 70 };
}

function currentWindowSize() {
  if (!snapOffer.hidden) return { width: 310, height: 58 };
  if (workspaceOpen) {
    const activeItems = workspacePage === 'clipboard' ? clipboardItems : (workspacePage === 'todo' ? todos : workItems);
    const visibleRows = Math.max(1, Math.min(4, activeItems.length || 1));
    const composerHeight = workspacePage === 'todo' && !todoComposer.hidden ? 35 : 0;
    return { width: 420, height: Math.min(246, 78 + visibleRows * 42 + composerHeight) };
  }
  if (!currentEvent) {
    const isSide = placementMode === 'left' || placementMode === 'right';
    if (isSide) return expanded ? SIDE_IDLE_EXPANDED : SIDE_IDLE_COLLAPSED;
    const activeTodo = todos.find((item) => item.timerRunning);
    if (activeTodo) {
      const width = Math.max(198, Math.min(expanded ? 330 : 286, 132 + [...activeTodo.title].length * 6));
      return { width, height: expanded ? 54 : 38 };
    }
    return expanded ? IDLE_EXPANDED : IDLE_COLLAPSED;
  }
  return expanded ? expandedEventSize(currentEvent) : collapsedEventSize(currentEvent);
}

function applyMode({ instant = false, duration = 320 } = {}) {
  const isSideIdle = (placementMode === 'left' || placementMode === 'right') && !currentEvent && !workspaceOpen;
  island.classList.toggle('is-expanded', expanded);
  island.classList.toggle('is-pinned', pinned);
  island.classList.toggle('is-workspace', workspaceOpen);
  island.classList.toggle('is-side-idle', isSideIdle);
  setWindowSize(currentWindowSize(), { instant, duration });
}

function autoHideBlocked() {
  return dragging || Boolean(snapOfferEdge) || workspaceOpen || pinned || currentEvent?.type === 'decision';
}

function setAutoHidden(hidden) {
  const next = Boolean(hidden && autoHideEnabled && !autoHideBlocked());
  if (autoHidden === next) return;
  autoHidden = next;
  island.classList.toggle('is-auto-hidden', next);
  window.agentIsland.setAutoHidden(next);
}

function revealIsland() {
  clearTimeout(autoHideTimer);
  setAutoHidden(false);
}

function scheduleAutoHide(delay = 900) {
  clearTimeout(autoHideTimer);
  if (!autoHideEnabled || proximityNear || autoHideBlocked()) return;
  autoHideTimer = setTimeout(() => setAutoHidden(true), delay);
}

function applyPlacement(payload = {}, { instant = false } = {}) {
  placementMode = ['top', 'bottom', 'left', 'right', 'free'].includes(payload.mode) ? payload.mode : 'top';
  autoHideEnabled = payload.autoHide !== false;
  document.body.dataset.placement = placementMode;
  if (!autoHideEnabled) setAutoHidden(false);
  applyMode({ instant, duration: instant ? 1 : 300 });
}

function clearInteractionTimers() {
  clearTimeout(peekTimer);
  clearTimeout(collapseTimer);
}

function expandIsland({ pin = false, instant = false } = {}) {
  revealIsland();
  clearTimeout(collapseTimer);
  expanded = true;
  if (pin) pinned = true;
  applyMode({ instant, duration: 340 });
}

function collapseIsland({ force = false, instant = false } = {}) {
  if (!force && (pinned || hovered)) return;
  if (force && workspaceOpen) {
    workspaceOpen = false;
    restorePrimaryView();
  }
  expanded = false;
  if (force) pinned = false;
  applyMode({ instant, duration: 300 });
}

function startPeek(event) {
  clearInteractionTimers();
  revealIsland();
  pinned = false;
  expanded = true;
  applyMode({ duration: 360 });
  if (event.type !== 'decision') {
    peekTimer = setTimeout(() => {
      collapseIsland();
      scheduleAutoHide(850);
    }, 2700);
  }
}

function setAccent(event) {
  const accent = ACCENTS[event.type] || event.sourceColor || '#8fa8ff';
  island.style.setProperty('--accent', accent);
  island.style.setProperty('--accent-soft', `color-mix(in srgb, ${accent} 18%, transparent)`);
}

function setQueueBadge() {
  if (queuedEvents.length > 0) {
    queueCount.hidden = false;
    queueCount.textContent = `+${queuedEvents.length}`;
  } else {
    queueCount.hidden = true;
  }
}

function restorePrimaryView() {
  workView.hidden = true;
  if (currentEvent) {
    idleView.hidden = true;
    eventView.hidden = false;
  } else {
    eventView.hidden = true;
    idleView.hidden = false;
  }
}

function updateWorkspaceChrome() {
  const showingTodo = workspacePage === 'todo';
  const showingClipboard = workspacePage === 'clipboard';
  workspaceTabs.classList.toggle('is-todo', showingTodo);
  workspaceTabs.classList.toggle('is-clipboard', showingClipboard);
  workspaceTrack.classList.toggle('is-todo', showingTodo);
  workspaceTrack.classList.toggle('is-clipboard', showingClipboard);
  workTab.classList.toggle('is-active', workspacePage === 'work');
  todoTab.classList.toggle('is-active', showingTodo);
  clipboardTab.classList.toggle('is-active', showingClipboard);
  workTab.setAttribute('aria-selected', String(workspacePage === 'work'));
  todoTab.setAttribute('aria-selected', String(showingTodo));
  clipboardTab.setAttribute('aria-selected', String(showingClipboard));
  clearClipboardButton.hidden = !showingClipboard || clipboardItems.length === 0;
  addTodoButton.hidden = !showingTodo;
  notionTodoButton.hidden = !showingTodo || todos.length === 0;
  const activeItems = showingClipboard ? clipboardItems : (showingTodo ? todos : workItems);
  workCount.textContent = String(activeItems.length);
  workspaceHint.textContent = showingClipboard
    ? 'Scroll up to return to todos'
    : (showingTodo ? 'Scroll to switch pages · Click the circle to complete' : 'Scroll down for todos');
}

function setWorkspacePage(page, { instant = false } = {}) {
  if (!WORKSPACE_PAGES.includes(page)) return;
  workspacePage = page;
  wheelAccumulator = 0;
  updateWorkspaceChrome();
  applyMode({ instant, duration: instant ? 1 : 340 });
}

function makeWorkItem(item) {
  const row = document.createElement('div');
  row.className = `work-item ${item.kind || ''} ${item.target ? 'is-clickable' : 'is-disabled'}`.trim();
  row.setAttribute('role', 'listitem');
  if (item.target) row.tabIndex = 0;

  const glyph = document.createElement('span');
  glyph.className = `work-glyph ${item.accent || 'generic'}`;
  glyph.textContent = item.glyph || 'AI';

  const copy = document.createElement('span');
  copy.className = 'work-copy';
  const title = document.createElement('strong');
  title.textContent = item.title || 'Task';
  const subtitle = document.createElement('small');
  subtitle.textContent = item.subtitle || 'Click to return to the app';
  copy.append(title, subtitle);

  const status = document.createElement('span');
  status.className = 'work-status';
  status.textContent = item.status || '';

  const arrow = document.createElement('span');
  arrow.className = 'work-arrow';
  arrow.innerHTML = '<svg viewBox="0 0 20 20"><path d="M7 5l5 5-5 5"/></svg>';
  row.append(glyph, copy, status);

  if (item.deletable && item.eventId) {
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'row-delete-button';
    deleteButton.title = 'Delete this notification';
    deleteButton.setAttribute('aria-label', 'Delete this notification');
    deleteButton.innerHTML = '<svg viewBox="0 0 20 20"><path d="M5.5 6.5h9M8 6.5V4.8h4v1.7M7 8.5l.5 6.7h5l.5-6.7"/></svg>';
    deleteButton.addEventListener('click', async (event) => {
      event.stopPropagation();
      deleteButton.disabled = true;
      const result = await window.agentIsland.deleteHistoryEvent(item.eventId);
      if (result?.ok) await refreshWorkItems();
      else deleteButton.disabled = false;
    });
    row.appendChild(deleteButton);
  }
  row.appendChild(arrow);

  if (!item.target) {
    return row;
  }

  const activate = async (event) => {
    event.stopPropagation();
    if (event.target.closest('.row-delete-button') || row.classList.contains('is-opening')) return;
    row.classList.add('is-opening');
    status.textContent = 'Opening';
    const result = await window.agentIsland.activateTarget(item.target);
    if (result?.ok) {
      status.textContent = 'Opened';
      setTimeout(() => closeWorkspace({ collapse: true }), 120);
    } else {
      row.classList.remove('is-opening');
      status.textContent = 'Could not open';
      subtitle.textContent = result?.error || 'The matching application window was not found';
    }
  };
  row.addEventListener('click', activate);
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') activate(event);
  });
  return row;
}

function renderWorkItems(items = []) {
  workItems = items;
  workList.replaceChildren(...items.map(makeWorkItem));
  workEmpty.hidden = items.length > 0;
  updateWorkspaceChrome();
  if (workspaceOpen && workspacePage === 'work') applyMode({ duration: 300 });
}

async function refreshWorkItems() {
  const items = await window.agentIsland.getWorkItems();
  if (workspaceOpen) renderWorkItems(items || []);
  return items || [];
}

function relativeClipboardTime(value) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  if (elapsed < 60000) return 'Just now';
  if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)} min ago`;
  if (elapsed < 86400000) return `${Math.floor(elapsed / 3600000)} hr ago`;
  return new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric' }).format(new Date(value));
}

function makeClipboardItem(item) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'work-item clipboard-item';
  button.setAttribute('role', 'listitem');

  const glyph = document.createElement('span');
  glyph.className = `work-glyph ${item.type === 'image' ? 'clipboard-image' : 'clipboard-text'}`;
  if (item.type === 'image' && item.thumbnail) {
    const image = document.createElement('img');
    image.src = item.thumbnail;
    image.alt = '';
    glyph.appendChild(image);
  } else {
    glyph.textContent = 'TXT';
  }

  const copy = document.createElement('span');
  copy.className = 'work-copy';
  const title = document.createElement('strong');
  title.textContent = item.type === 'image' ? `Image ${item.width} × ${item.height}` : item.preview;
  const subtitle = document.createElement('small');
  subtitle.textContent = item.type === 'image'
    ? `${item.sizeLabel} · Click to copy the image again`
    : `${item.characters} characters${item.lines > 1 ? ` · ${item.lines} lines` : ''} · ${item.sizeLabel}`;
  copy.append(title, subtitle);

  const status = document.createElement('span');
  status.className = 'work-status';
  status.textContent = relativeClipboardTime(item.createdAt);

  const arrow = document.createElement('span');
  arrow.className = 'work-arrow';
  arrow.innerHTML = '<svg viewBox="0 0 20 20"><rect x="7" y="5" width="8" height="10" rx="2"/><path d="M5 12H4.5A1.5 1.5 0 0 1 3 10.5v-6A1.5 1.5 0 0 1 4.5 3h6A1.5 1.5 0 0 1 12 4.5V5"/></svg>';
  button.append(glyph, copy, status, arrow);

  button.addEventListener('click', async (event) => {
    event.stopPropagation();
    if (button.classList.contains('is-opening')) return;
    button.classList.add('is-opening');
    status.textContent = 'Copying';
    const result = await window.agentIsland.restoreClipboardItem(item.id);
    if (!result?.ok) {
      button.classList.remove('is-opening');
      status.textContent = 'Copy failed';
      subtitle.textContent = result?.error || 'Could not write to the system clipboard';
      return;
    }
    button.classList.remove('is-opening');
    button.classList.add('is-copied');
    status.textContent = 'Copied';
    setTimeout(() => closeWorkspace({ collapse: true }), 260);
  });
  return button;
}

function renderClipboardItems(items = []) {
  clipboardItems = items;
  clipboardList.replaceChildren(...items.map(makeClipboardItem));
  clipboardEmpty.hidden = items.length > 0;
  updateWorkspaceChrome();
  if (workspaceOpen && workspacePage === 'clipboard') applyMode({ duration: 300 });
}

async function refreshClipboardItems() {
  const items = await window.agentIsland.getClipboardItems();
  renderClipboardItems(items || []);
  return items || [];
}

function formatTodoDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function todoElapsed(item) {
  return item.elapsedMs + (item.timerRunning ? Math.max(0, Date.now() - todoSnapshotAt) : 0);
}

function todoDate(value) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value));
}

function showTodoToast(message, { error = false } = {}) {
  clearTimeout(todoToastTimer);
  todoToast.textContent = message;
  todoToast.classList.toggle('is-error', error);
  todoToast.hidden = false;
  todoToastTimer = setTimeout(() => { todoToast.hidden = true; }, 3200);
}

function makeTodoItem(item) {
  const row = document.createElement('div');
  row.className = `work-item todo-item ${item.completed ? 'is-completed' : ''}`.trim();
  row.dataset.todoId = item.id;
  row.setAttribute('role', 'listitem');
  row.title = `Created: ${new Date(item.createdAt).toLocaleString('en-US')}\nUpdated: ${new Date(item.updatedAt).toLocaleString('en-US')}`;

  const check = document.createElement('button');
  check.type = 'button';
  check.className = 'todo-check';
  check.title = item.completed ? 'Mark as incomplete' : 'Mark as completed';
  check.setAttribute('aria-label', check.title);
  check.innerHTML = '<svg viewBox="0 0 20 20"><path d="M5 10.5l3 3L15 6.5"/></svg>';
  check.addEventListener('click', async (event) => {
    event.stopPropagation();
    check.disabled = true;
    const result = await window.agentIsland.toggleTodo(item.id);
    if (!result?.ok) showTodoToast(result?.error || 'Could not update the todo', { error: true });
    await refreshTodos();
  });

  const copy = document.createElement('span');
  copy.className = 'work-copy';
  const title = document.createElement('strong');
  title.textContent = item.title;
  const subtitle = document.createElement('small');
  subtitle.textContent = `Created ${todoDate(item.createdAt)} · Updated ${todoDate(item.updatedAt)}`;
  copy.append(title, subtitle);

  const timer = document.createElement('button');
  timer.type = 'button';
  timer.className = `todo-timer-button ${item.timerRunning ? 'is-running' : ''}`.trim();
  timer.textContent = formatTodoDuration(todoElapsed(item));
  timer.title = item.completed ? 'Completed' : (item.timerRunning ? 'Pause timer' : 'Start timer');
  timer.addEventListener('click', async (event) => {
    event.stopPropagation();
    if (item.completed) return;
    timer.disabled = true;
    const result = await window.agentIsland.toggleTodoTimer(item.id);
    if (!result?.ok) showTodoToast(result?.error || 'Could not update the timer', { error: true });
    await refreshTodos();
  });

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'row-delete-button';
  remove.title = 'Delete todo';
  remove.setAttribute('aria-label', 'Delete todo');
  remove.innerHTML = '<svg viewBox="0 0 20 20"><path d="M5.5 6.5h9M8 6.5V4.8h4v1.7M7 8.5l.5 6.7h5l.5-6.7"/></svg>';
  remove.addEventListener('click', async (event) => {
    event.stopPropagation();
    remove.disabled = true;
    const result = await window.agentIsland.deleteTodo(item.id);
    if (!result?.ok) showTodoToast(result?.error || 'Could not delete the todo', { error: true });
    await refreshTodos();
  });

  row.append(check, copy, timer, remove);
  return row;
}

function updateIdlePresentation() {
  updatePixelAgents();
  const activeTodo = todos.find((item) => item.timerRunning);
  island.classList.toggle('has-todo-timer', Boolean(activeTodo));
  if (activeTodo) {
    brandName.textContent = activeTodo.title;
    brandName.dataset.shortLabel = 'Timer';
    idleTodoTimer.hidden = false;
    idleTodoTimer.textContent = formatTodoDuration(todoElapsed(activeTodo));
    idleAgents.hidden = true;
    return;
  }
  idleTodoTimer.hidden = true;
  const taskStates = currentAgents.map((agent) => agent.taskState?.status || 'idle');
  brandName.textContent = taskStates.includes('waiting')
    ? 'Waiting'
    : (taskStates.includes('working') ? 'Working' : 'Idle');
  brandName.dataset.shortLabel = taskStates.includes('waiting')
    ? 'Alert'
    : (taskStates.includes('working') ? 'Work' : 'Idle');
  idleAgents.hidden = currentAgents.length === 0;
}

function updateTodoTimers() {
  if (!todos.some((item) => item.timerRunning)) return;
  for (const item of todos) {
    const timer = todoList.querySelector(`[data-todo-id="${item.id}"] .todo-timer-button`);
    if (timer) timer.textContent = formatTodoDuration(todoElapsed(item));
  }
  updateIdlePresentation();
}

function renderTodos(items = []) {
  todos = items;
  todoSnapshotAt = Date.now();
  todoList.replaceChildren(...items.map(makeTodoItem));
  todoEmpty.hidden = items.length > 0 || !todoComposer.hidden;
  updateWorkspaceChrome();
  updateIdlePresentation();
  if (workspaceOpen && workspacePage === 'todo') applyMode({ duration: 300 });
  else if (!currentEvent) applyMode({ duration: 260 });
}

async function refreshTodos() {
  const items = await window.agentIsland.getTodos();
  renderTodos(items || []);
  return items || [];
}

async function openWorkspace({ instant = false } = {}) {
  clearInteractionTimers();
  clearTimeout(dismissTimer);
  revealIsland();
  workspaceOpen = true;
  expanded = true;
  pinned = true;
  idleView.hidden = true;
  eventView.hidden = true;
  workView.hidden = false;
  setWorkspacePage('work', { instant: true });
  applyMode({ instant, duration: 380 });
  const [nextWorkItems, nextTodos, nextClipboardItems] = await Promise.all([
    window.agentIsland.getWorkItems(),
    window.agentIsland.getTodos(),
    window.agentIsland.getClipboardItems()
  ]);
  renderWorkItems(nextWorkItems || []);
  renderTodos(nextTodos || []);
  renderClipboardItems(nextClipboardItems || []);
}

function closeWorkspace({ collapse = false } = {}) {
  workspaceOpen = false;
  restorePrimaryView();
  if (collapse) {
    pinned = false;
    expanded = false;
    applyMode({ duration: 300 });
    if (!hovered) scheduleAutoHide(650);
  } else {
    pinned = true;
    expanded = true;
    applyMode({ duration: 320 });
  }
}

function goIdle() {
  clearTimeout(dismissTimer);
  clearInteractionTimers();
  currentEvent = null;
  workspaceOpen = false;
  expanded = false;
  pinned = false;
  island.classList.add('is-idle');
  island.dataset.type = 'idle';
  eventView.hidden = true;
  workView.hidden = true;
  idleView.hidden = false;
  updateIdlePresentation();
  applyMode({ duration: 300 });
  if (!hovered) scheduleAutoHide(850);

  if (queuedEvents.length > 0) {
    const next = queuedEvents.shift();
    setTimeout(() => showEvent(next), 320);
  }
}

function scheduleDismiss(event) {
  clearTimeout(dismissTimer);
  if (event.ttl <= 0 || event.type === 'decision') return;
  const tryDismiss = () => {
    if (!currentEvent || currentEvent.id !== event.id) return;
    if (hovered || pinned) dismissTimer = setTimeout(tryDismiss, 1800);
    else goIdle();
  };
  dismissTimer = setTimeout(tryDismiss, event.ttl);
}

function makeActionButton(event, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `action-button ${action.style || 'secondary'}`;
  button.textContent = action.label;
  button.title = action.hint || action.label;
  button.addEventListener('click', async (clickEvent) => {
    clickEvent.stopPropagation();
    pinned = true;
    expanded = true;
    applyMode();
    [...actions.children].forEach((item) => { item.disabled = true; });
    button.classList.add('is-selected');
    const result = await window.agentIsland.respond(event.id, action.id);
    if (!result?.ok) {
      [...actions.children].forEach((item) => { item.disabled = false; });
      button.classList.remove('is-selected');
      eventDetail.hidden = false;
      eventDetail.textContent = result?.error || 'The choice could not be submitted.';
      return;
    }
    statusLabel.textContent = 'Answered';
    eventMessage.textContent = `Your choice: ${action.label}`;
    statusIcon.className = 'status-icon';
    statusIcon.innerHTML = TYPE_INFO.success.icon;
    setTimeout(goIdle, 900);
  });
  return button;
}

function renderActions(event) {
  actions.replaceChildren();
  if (event.type !== 'decision' || !event.actions?.length) {
    actions.hidden = true;
    return;
  }
  event.actions.forEach((action) => actions.appendChild(makeActionButton(event, action)));
  actions.hidden = false;
}

function showEvent(event) {
  revealIsland();
  if (workspaceOpen && event.type !== 'decision') {
    refreshWorkItems();
    return;
  }
  if (workspaceOpen && event.type === 'decision') closeWorkspace();

  if (currentEvent?.type === 'decision' && currentEvent.id !== event.id) {
    queuedEvents.push(event);
    setQueueBadge();
    return;
  }
  if (currentEvent?.context?.capturedFromWindows && event.context?.capturedFromWindows && currentEvent.id !== event.id) {
    queuedEvents.push(event);
    setQueueBadge();
    return;
  }

  clearTimeout(dismissTimer);
  currentEvent = event;
  updatePixelAgents();
  const typeInfo = TYPE_INFO[event.type] || TYPE_INFO.notification;
  setAccent(event);

  island.classList.remove('is-idle');
  island.dataset.type = event.type;
  workView.hidden = true;
  idleView.hidden = true;
  eventView.hidden = false;
  sourceGlyph.title = `${event.sourceLabel || 'Agent'} · ${event.sourceGlyph || 'AI'}`;
  sourceGlyph.setAttribute('aria-label', sourceGlyph.title);
  sourceLabel.textContent = event.sourceLabel || 'Agent';
  statusLabel.textContent = typeInfo.label;
  eventTitle.textContent = event.title || 'Status update';
  eventMessage.textContent = event.message || '';
  eventMessage.hidden = !event.message;
  eventDetail.textContent = event.detail || '';
  eventDetail.hidden = !event.detail;
  footerText.textContent = event.taskId ? `Task ${event.taskId.slice(0, 8)}` : 'Local connection';

  statusIcon.className = `status-icon ${typeInfo.className}`.trim();
  statusIcon.innerHTML = typeInfo.icon;

  if (event.progress !== null) {
    const progress = Math.round(event.progress);
    progressWrap.hidden = false;
    progressText.textContent = `${progress}%`;
    requestAnimationFrame(() => { progressBar.style.width = `${progress}%`; });
  } else {
    progressWrap.hidden = true;
    progressBar.style.width = '0%';
  }

  renderActions(event);
  setQueueBadge();
  startPeek(event);
  scheduleDismiss(event);
}

island.addEventListener('mouseenter', () => {
  hovered = true;
  proximityNear = true;
  revealIsland();
  window.agentIsland.setInteractive(true);
  clearTimeout(collapseTimer);
  expandIsland();
});

island.addEventListener('mouseleave', () => {
  hovered = false;
  if (!pinned) collapseTimer = setTimeout(() => {
    collapseIsland();
    scheduleAutoHide(780);
  }, 240);
});

island.addEventListener('click', (event) => {
  if (event.target.closest('button')) return;
  clearInteractionTimers();
  if (workspaceOpen) return;
  if (!expanded) {
    expandIsland({ pin: true });
  } else {
    openWorkspace();
  }
});

async function finishDrag(pointerId) {
  if (!dragging) return;
  dragging = false;
  island.classList.remove('is-dragging');
  try {
    if (pointerId !== undefined && dragHandle.hasPointerCapture(pointerId)) dragHandle.releasePointerCapture(pointerId);
  } catch {}
  await window.agentIsland.endDrag();
  scheduleAutoHide(1100);
}

dragHandle.addEventListener('pointerdown', async (event) => {
  if (event.button !== 0 || dragging) return;
  event.preventDefault();
  event.stopPropagation();
  revealIsland();
  clearInteractionTimers();
  dragging = true;
  island.classList.add('is-dragging');
  dragHandle.setPointerCapture(event.pointerId);
  const started = await window.agentIsland.startDrag();
  if (!started) await finishDrag(event.pointerId);
});
dragHandle.addEventListener('pointerup', (event) => finishDrag(event.pointerId));
dragHandle.addEventListener('pointercancel', (event) => finishDrag(event.pointerId));
dragHandle.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
});

function showSnapOffer({ edge } = {}) {
  if (!['top', 'bottom', 'left', 'right'].includes(edge)) return;
  const edgeLabels = { top: 'top', bottom: 'bottom', left: 'left', right: 'right' };
  revealIsland();
  snapOfferEdge = edge;
  snapOfferText.textContent = `Snap to the ${edgeLabels[edge]} edge?`;
  snapOffer.hidden = false;
  pinned = true;
  expanded = true;
  applyMode({ duration: 260 });
}

async function resolveCurrentSnap(accept) {
  if (!snapOfferEdge) return;
  acceptSnapButton.disabled = true;
  declineSnapButton.disabled = true;
  const result = await window.agentIsland.resolveSnap(accept);
  acceptSnapButton.disabled = false;
  declineSnapButton.disabled = false;
  snapOfferEdge = '';
  snapOffer.hidden = true;
  pinned = false;
  expanded = false;
  if (result?.placement) applyPlacement(result.placement);
  else applyMode({ duration: 300 });
  scheduleAutoHide(1000);
}

acceptSnapButton.addEventListener('click', (event) => {
  event.stopPropagation();
  resolveCurrentSnap(true);
});
declineSnapButton.addEventListener('click', (event) => {
  event.stopPropagation();
  resolveCurrentSnap(false);
});

workBackButton.addEventListener('click', (event) => {
  event.stopPropagation();
  closeWorkspace();
});

workTab.addEventListener('click', (event) => {
  event.stopPropagation();
  setWorkspacePage('work');
});

todoTab.addEventListener('click', (event) => {
  event.stopPropagation();
  setWorkspacePage('todo');
});

clipboardTab.addEventListener('click', (event) => {
  event.stopPropagation();
  setWorkspacePage('clipboard');
});

addTodoButton.addEventListener('click', (event) => {
  event.stopPropagation();
  todoComposer.hidden = !todoComposer.hidden;
  todoEmpty.hidden = todos.length > 0 || !todoComposer.hidden;
  applyMode({ duration: 280 });
  if (!todoComposer.hidden) requestAnimationFrame(() => todoInput.focus());
});

todoComposer.addEventListener('submit', async (event) => {
  event.preventDefault();
  event.stopPropagation();
  const title = todoInput.value.trim();
  if (!title) return;
  const result = await window.agentIsland.createTodo(title);
  if (!result?.ok) {
    showTodoToast(result?.error || 'Could not create the todo', { error: true });
    return;
  }
  todoInput.value = '';
  todoComposer.hidden = true;
  await refreshTodos();
});

notionTodoButton.addEventListener('click', async (event) => {
  event.stopPropagation();
  notionTodoButton.disabled = true;
  const result = await window.agentIsland.exportTodosToNotion();
  notionTodoButton.disabled = false;
  if (result?.ok) showTodoToast(result.message || 'Sent to Notion');
  else showTodoToast(result?.error || 'Could not send to Notion', { error: true });
});

clearClipboardButton.addEventListener('click', async (event) => {
  event.stopPropagation();
  clearClipboardButton.disabled = true;
  const result = await window.agentIsland.clearClipboardHistory();
  clearClipboardButton.disabled = false;
  if (result?.ok) renderClipboardItems([]);
});

workView.addEventListener('wheel', (event) => {
  if (!workspaceOpen) return;
  const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
  const delta = horizontal ? event.deltaX : event.deltaY;
  if (Math.abs(delta) < 1) return;

  const activeList = workspacePage === 'clipboard' ? clipboardList : (workspacePage === 'todo' ? todoList : workList);
  const atTop = activeList.scrollTop <= 1;
  const atBottom = activeList.scrollTop + activeList.clientHeight >= activeList.scrollHeight - 1;
  const currentIndex = WORKSPACE_PAGES.indexOf(workspacePage);
  const wantsNext = delta > 0 && currentIndex < WORKSPACE_PAGES.length - 1 && (horizontal || atBottom);
  const wantsPrevious = delta < 0 && currentIndex > 0 && (horizontal || atTop);
  if (!wantsNext && !wantsPrevious) {
    wheelAccumulator = 0;
    return;
  }

  event.preventDefault();
  wheelAccumulator += delta;
  clearTimeout(wheelResetTimer);
  wheelResetTimer = setTimeout(() => { wheelAccumulator = 0; }, 150);
  if (Math.abs(wheelAccumulator) < 28 || Date.now() - lastWheelSwitch < 360) return;
  lastWheelSwitch = Date.now();
  setWorkspacePage(WORKSPACE_PAGES[currentIndex + (wantsNext ? 1 : -1)]);
}, { passive: false });

dismissButton.addEventListener('click', (event) => {
  event.stopPropagation();
  if (currentEvent?.type === 'decision') collapseIsland({ force: true });
  else goIdle();
});

function renderAgents(agents = []) {
  currentAgents = agents;
  const taskStates = agents.map((agent) => agent.taskState?.status || 'idle');
  basePixelState = taskStates.includes('waiting') ? 'alert' : (taskStates.includes('working') ? 'working' : 'resting');
  idleAgents.replaceChildren();
  for (const agent of agents.slice(0, 4)) {
    const badge = document.createElement('span');
    const taskStatus = agent.taskState?.status || 'idle';
    badge.className = `mini-agent ${agent.id || 'generic'} task-${taskStatus}`;
    badge.textContent = agent.glyph || 'AI';
    badge.title = `${agent.label} · ${agent.taskState?.label || 'Idle'} · ${agent.processCount} processes`;
    idleAgents.appendChild(badge);
  }
  updateIdlePresentation();
  if (workspaceOpen) refreshWorkItems();
  if (!currentEvent) applyMode({ duration: 260 });
}

document.addEventListener('keydown', (event) => {
  if (workspaceOpen && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = Math.max(0, Math.min(WORKSPACE_PAGES.length - 1, WORKSPACE_PAGES.indexOf(workspacePage) + direction));
    setWorkspacePage(WORKSPACE_PAGES[nextIndex]);
    return;
  }
  if (event.key !== 'Escape') return;
  if (snapOfferEdge) {
    resolveCurrentSnap(false);
    return;
  }
  if (workspaceOpen && !todoComposer.hidden) {
    todoComposer.hidden = true;
    todoInput.value = '';
    todoEmpty.hidden = todos.length > 0;
    applyMode({ duration: 260 });
    return;
  }
  if (workspaceOpen) closeWorkspace();
  else collapseIsland({ force: true });
});

window.agentIsland.onEvent(showEvent);
window.agentIsland.onAgents(renderAgents);
window.agentIsland.onClipboardChanged(renderClipboardItems);
window.agentIsland.onTodosChanged(renderTodos);
window.agentIsland.onEventDeleted((eventId) => {
  queuedEvents = queuedEvents.filter((event) => event.id !== eventId);
  if (currentEvent?.id === eventId) {
    currentEvent = null;
    if (!workspaceOpen) goIdle();
  }
  if (workspaceOpen) refreshWorkItems();
});
window.agentIsland.onExternalBlur(() => {
  if (dragging || snapOfferEdge) return;
  hovered = false;
  if (workspaceOpen || pinned || expanded) collapseIsland({ force: true });
  scheduleAutoHide(450);
});
window.agentIsland.onPlacement((placement) => applyPlacement(placement));
window.agentIsland.onProximity((near) => {
  proximityNear = Boolean(near);
  if (proximityNear) revealIsland();
  else scheduleAutoHide(700);
});
window.agentIsland.onSnapOffer(showSnapOffer);
window.agentIsland.onDragging((active) => {
  dragging = Boolean(active);
  island.classList.toggle('is-dragging', dragging);
  if (dragging) revealIsland();
});
window.agentIsland.onDecisionResolved((decision) => {
  if (!currentEvent || decision.id !== currentEvent.id || decision.status === 'answered') return;
  eventMessage.textContent = decision.status === 'expired' ? 'The request expired' : `Status: ${decision.status}`;
  [...actions.children].forEach((item) => { item.disabled = true; });
  setTimeout(goIdle, 1100);
});

updateClock();
setInterval(updateClock, 30000);
setInterval(updateTodoTimers, 1000);
window.agentIsland.getState().then((state) => {
  footerText.textContent = state?.api?.address ? state.api.address.replace('http://', '') : 'Local connection';
  applyPlacement(state?.settings?.placement || state?.settings || {}, { instant: true });
  renderAgents(state?.activeAgents || []);
});
refreshTodos();
window.__agentIslandSmoke = {
  collapse: () => collapseIsland({ force: true }),
  expand: () => expandIsland({ pin: true, instant: true }),
  openWorkspace: () => openWorkspace({ instant: true }),
  closeWorkspace: () => closeWorkspace(),
  setWorkspacePage: (page) => setWorkspacePage(page, { instant: true }),
  pixelState: () => island.dataset.pixelState,
  applyPlacement: (placement) => applyPlacement(placement, { instant: true }),
  setAutoHidden: (hidden) => setAutoHidden(hidden)
};
applyMode({ instant: true });
