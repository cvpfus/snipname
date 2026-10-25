export type SnipMode = "rectangle" | "window" | "fullscreen" | "freeform";

export const SNIP_MODES: SnipMode[] = [
  "rectangle",
  "window",
  "fullscreen",
  "freeform",
];

export type Point = { x: number; y: number };

export type Selection =
  | { kind: "rect"; x: number; y: number; width: number; height: number }
  | { kind: "freeform"; points: Point[] };

export type WindowHit = {
  id: number;
  title: string;
  appName: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

const MIN_DRAG = 4;

export function toPhysical(
  selection: Selection,
  scale: number,
  origin: Point = { x: 0, y: 0 },
): Selection {
  const px = (value: number, shift: number) => Math.round(value * scale + shift);
  if (selection.kind === "rect") {
    return {
      kind: "rect",
      x: px(selection.x, origin.x),
      y: px(selection.y, origin.y),
      width: Math.round(selection.width * scale),
      height: Math.round(selection.height * scale),
    };
  }
  return {
    kind: "freeform",
    points: selection.points.map((point) => ({
      x: px(point.x, origin.x),
      y: px(point.y, origin.y),
    })),
  };
}

export function nextMode(mode: SnipMode, direction: 1 | -1): SnipMode {
  const index = SNIP_MODES.indexOf(mode);
  return SNIP_MODES[(index + direction + SNIP_MODES.length) % SNIP_MODES.length]!;
}

/** Rectangle from any drag direction. A click that barely moves is not a snip. */
export function rectFromDrag(
  start: Point,
  end: Point,
): Extract<Selection, { kind: "rect" }> | null {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  if (width < MIN_DRAG || height < MIN_DRAG) return null;
  return { kind: "rect", x, y, width, height };
}

export function simplifyFreeform(points: Point[]): Point[] {
  if (points.length < 2) return points;
  const out: Point[] = [points[0]!];
  for (const point of points.slice(1)) {
    const last = out[out.length - 1]!;
    if (Math.hypot(point.x - last.x, point.y - last.y) >= 2) out.push(point);
  }
  return out;
}

export function freeformBounds(points: Point[]): Extract<Selection, { kind: "rect" }> | null {
  if (points.length < 3) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(...xs) - x;
  const height = Math.max(...ys) - y;
  if (width < MIN_DRAG || height < MIN_DRAG) return null;
  return { kind: "rect", x, y, width, height };
}

/** Topmost window whose bounds contain the cursor. Overlay windows are excluded by the caller. */
export function windowUnderCursor(
  windows: WindowHit[],
  point: Point,
  scale = 1,
  origin: Point = { x: 0, y: 0 },
): WindowHit | null {
  const x = point.x * scale + origin.x;
  const y = point.y * scale + origin.y;
  for (const win of windows) {
    if (
      x >= win.x &&
      y >= win.y &&
      x < win.x + win.width &&
      y < win.y + win.height
    ) {
      return win;
    }
  }
  return null;
}

export function sizeLabel(width: number, height: number): string {
  return `${Math.round(width)} × ${Math.round(height)}`;
}

export function modeHint(mode: SnipMode): string {
  switch (mode) {
    case "rectangle":
      return "Drag to select an area";
    case "window":
      return "Click a window to capture it";
    case "fullscreen":
      return "Click to capture the whole screen";
    case "freeform":
      return "Draw around the area you want";
  }
}
