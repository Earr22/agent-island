const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agentIsland', {
  resize: (size) => ipcRenderer.invoke('island:resize', size),
  setInteractive: (interactive) => ipcRenderer.invoke('island:set-interactive', interactive),
  setAutoHidden: (hidden) => ipcRenderer.invoke('island:set-auto-hidden', hidden),
  startDrag: () => ipcRenderer.invoke('island:drag-start'),
  endDrag: () => ipcRenderer.invoke('island:drag-end'),
  resolveSnap: (accept) => ipcRenderer.invoke('island:resolve-snap', accept),
  respond: (id, choice) => ipcRenderer.invoke('island:respond', { id, choice }),
  hide: () => ipcRenderer.invoke('island:hide'),
  getState: () => ipcRenderer.invoke('island:get-state'),
  getWorkItems: () => ipcRenderer.invoke('island:get-work-items'),
  activateTarget: (target) => ipcRenderer.invoke('island:activate-target', target),
  deleteHistoryEvent: (id) => ipcRenderer.invoke('island:delete-history-event', id),
  getClipboardItems: () => ipcRenderer.invoke('island:get-clipboard-items'),
  restoreClipboardItem: (id) => ipcRenderer.invoke('island:restore-clipboard-item', id),
  clearClipboardHistory: () => ipcRenderer.invoke('island:clear-clipboard-history'),
  getTodos: () => ipcRenderer.invoke('island:get-todos'),
  createTodo: (title) => ipcRenderer.invoke('island:create-todo', title),
  toggleTodo: (id) => ipcRenderer.invoke('island:toggle-todo', id),
  toggleTodoTimer: (id) => ipcRenderer.invoke('island:toggle-todo-timer', id),
  deleteTodo: (id) => ipcRenderer.invoke('island:delete-todo', id),
  clearCompletedTodos: () => ipcRenderer.invoke('island:clear-completed-todos'),
  exportTodosToNotion: () => ipcRenderer.invoke('island:export-todos-to-notion'),
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('island:event', listener);
    return () => ipcRenderer.removeListener('island:event', listener);
  },
  onDecisionResolved: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('island:decision-resolved', listener);
    return () => ipcRenderer.removeListener('island:decision-resolved', listener);
  },
  onAgents: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('island:agents', listener);
    return () => ipcRenderer.removeListener('island:agents', listener);
  },
  onClipboardChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('island:clipboard-changed', listener);
    return () => ipcRenderer.removeListener('island:clipboard-changed', listener);
  },
  onTodosChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('island:todos-changed', listener);
    return () => ipcRenderer.removeListener('island:todos-changed', listener);
  },
  onEventDeleted: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('island:event-deleted', listener);
    return () => ipcRenderer.removeListener('island:event-deleted', listener);
  },
  onExternalBlur: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('island:external-blur', listener);
    return () => ipcRenderer.removeListener('island:external-blur', listener);
  },
  onPlacement: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('island:placement', listener);
    return () => ipcRenderer.removeListener('island:placement', listener);
  },
  onProximity: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('island:proximity', listener);
    return () => ipcRenderer.removeListener('island:proximity', listener);
  },
  onSnapOffer: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('island:snap-offer', listener);
    return () => ipcRenderer.removeListener('island:snap-offer', listener);
  },
  onDragging: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('island:dragging', listener);
    return () => ipcRenderer.removeListener('island:dragging', listener);
  }
});
