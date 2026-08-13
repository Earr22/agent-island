const EDGE_MODES = new Set(['top', 'bottom', 'left', 'right']);
const PLACEMENT_MODES = new Set([...EDGE_MODES, 'free']);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sanitizePlacement(value = {}) {
  const mode = PLACEMENT_MODES.has(value.mode) ? value.mode : 'top';
  const ratio = Number.isFinite(Number(value.ratio)) ? clamp(Number(value.ratio), 0.04, 0.96) : 0.5;
  const x = value.x !== null && value.x !== undefined && Number.isFinite(Number(value.x)) ? Math.round(Number(value.x)) : null;
  const y = value.y !== null && value.y !== undefined && Number.isFinite(Number(value.y)) ? Math.round(Number(value.y)) : null;
  const displayId = value.displayId === undefined || value.displayId === null ? '' : String(value.displayId);
  return { mode, ratio, x, y, displayId };
}

function areaOf(display) {
  return display?.bounds || display || { x: 0, y: 0, width: 1920, height: 1080 };
}

function targetBounds({ placement, display, canvas = { width: 440, height: 276 }, edgeOffset = 4 } = {}) {
  const current = sanitizePlacement(placement);
  const area = areaOf(display);
  const centerX = area.x + area.width * current.ratio;
  const centerY = area.y + area.height * current.ratio;
  let x = Math.round(area.x + (area.width - canvas.width) / 2);
  let y = Math.round(area.y + edgeOffset);

  if (current.mode === 'bottom') {
    x = clamp(Math.round(centerX - canvas.width / 2), area.x, area.x + area.width - canvas.width);
    y = Math.round(area.y + area.height - canvas.height - edgeOffset);
  } else if (current.mode === 'top') {
    x = clamp(Math.round(centerX - canvas.width / 2), area.x, area.x + area.width - canvas.width);
  } else if (current.mode === 'left') {
    x = Math.round(area.x + edgeOffset);
    y = clamp(Math.round(centerY - canvas.height / 2), area.y, area.y + area.height - canvas.height);
  } else if (current.mode === 'right') {
    x = Math.round(area.x + area.width - canvas.width - edgeOffset);
    y = clamp(Math.round(centerY - canvas.height / 2), area.y, area.y + area.height - canvas.height);
  } else {
    x = current.x ?? x;
    y = current.y ?? y;
  }

  return { x, y, width: canvas.width, height: canvas.height };
}

function visualBounds(windowBounds, mode, layoutSize, padding = 2) {
  const placementMode = PLACEMENT_MODES.has(mode) ? mode : 'top';
  const width = Math.max(1, Math.round(layoutSize?.width || 146));
  const height = Math.max(1, Math.round(layoutSize?.height || 38));
  let x = windowBounds.x + Math.round((windowBounds.width - width) / 2);
  let y = windowBounds.y + padding;

  if (placementMode === 'bottom') y = windowBounds.y + windowBounds.height - height - padding;
  if (placementMode === 'left') {
    x = windowBounds.x + padding;
    y = windowBounds.y + Math.round((windowBounds.height - height) / 2);
  }
  if (placementMode === 'right') {
    x = windowBounds.x + windowBounds.width - width - padding;
    y = windowBounds.y + Math.round((windowBounds.height - height) / 2);
  }
  return { x, y, width, height };
}

function freeBoundsForVisual(visual, canvas = { width: 440, height: 276 }, padding = 2) {
  return {
    x: Math.round(visual.x - (canvas.width - visual.width) / 2),
    y: Math.round(visual.y - padding),
    width: canvas.width,
    height: canvas.height
  };
}

function clampFreeBoundsForLayout(windowBounds, display, layoutSize, canvas = { width: 440, height: 276 }, padding = 2, margin = 6) {
  const area = areaOf(display);
  const width = Math.max(1, Math.min(canvas.width, Math.round(layoutSize?.width || 146)));
  const height = Math.max(1, Math.min(canvas.height, Math.round(layoutSize?.height || 38)));
  const offsetX = Math.round((canvas.width - width) / 2);
  const currentVisualX = windowBounds.x + offsetX;
  const currentVisualY = windowBounds.y + padding;
  const minVisualX = area.x + margin;
  const minVisualY = area.y + margin;
  const maxVisualX = Math.max(minVisualX, area.x + area.width - margin - width);
  const maxVisualY = Math.max(minVisualY, area.y + area.height - margin - height);
  return {
    x: Math.round(clamp(currentVisualX, minVisualX, maxVisualX) - offsetX),
    y: Math.round(clamp(currentVisualY, minVisualY, maxVisualY) - padding),
    width: canvas.width,
    height: canvas.height
  };
}

function nearestSnapEdge(point, display, threshold = 56) {
  const area = areaOf(display);
  const distances = {
    top: Math.abs(point.y - area.y),
    bottom: Math.abs(area.y + area.height - point.y),
    left: Math.abs(point.x - area.x),
    right: Math.abs(area.x + area.width - point.x)
  };
  const [edge, distance] = Object.entries(distances).sort((a, b) => a[1] - b[1])[0];
  return distance <= threshold ? edge : '';
}

function ratioForEdge(edge, point, display) {
  const area = areaOf(display);
  const raw = edge === 'top' || edge === 'bottom'
    ? (point.x - area.x) / Math.max(1, area.width)
    : (point.y - area.y) / Math.max(1, area.height);
  return clamp(raw, 0.04, 0.96);
}

function pointInRect(point, rect, margin = 0) {
  return point.x >= rect.x - margin
    && point.x <= rect.x + rect.width + margin
    && point.y >= rect.y - margin
    && point.y <= rect.y + rect.height + margin;
}

module.exports = {
  EDGE_MODES,
  sanitizePlacement,
  targetBounds,
  visualBounds,
  freeBoundsForVisual,
  clampFreeBoundsForLayout,
  nearestSnapEdge,
  ratioForEdge,
  pointInRect
};
