import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  availableMonitors,
  cursorPosition,
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
} from "@tauri-apps/api/window";
import {
  freeformBounds,
  modeHint,
  nextMode,
  rectFromDrag,
  simplifyFreeform,
  sizeLabel,
  toPhysical,
  windowUnderCursor,
  type Point,
  type Selection,
  type SnipMode,
  type WindowHit,
} from "./snipping";
import "./overlay.css";

type Props = {
  initialMode: SnipMode;
  scale: number;
  origin: Point;
  onDone: () => void;
};

type Drag =
  | { kind: "rect"; start: Point; current: Point }
  | { kind: "freeform"; points: Point[] };

const MODE_LABEL: Record<SnipMode, string> = {
  rectangle: "Rectangle",
  window: "Window",
  fullscreen: "Full screen",
  freeform: "Freeform",
};

export function Overlay({ initialMode, scale, origin: monitorOrigin, onDone }: Props) {
  const [mode, setMode] = useState<SnipMode>(initialMode);
  const [windows, setWindows] = useState<WindowHit[]>([]);
  const [hover, setHover] = useState<WindowHit | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  const [saving, setSaving] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (mode !== "window") return;
    let alive = true;
    invoke<WindowHit[]>("list_windows")
      .then((list) => {
        if (alive) setWindows(list);
      })
      .catch(() => {
        if (alive) setWindows([]);
      });
    return () => {
      alive = false;
    };
  }, [mode]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onDone();
        return;
      }
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        setMode((current) => nextMode(current, 1));
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        setMode((current) => nextMode(current, -1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  function localPoint(event: React.PointerEvent): Point {
    return { x: event.clientX, y: event.clientY };
  }

  function onPointerDown(event: React.PointerEvent) {
    if (saving || event.button !== 0) return;
    if ((event.target as HTMLElement).closest(".snip-toolbar")) return;
    const point = localPoint(event);
    surface.current?.setPointerCapture(event.pointerId);
    if (mode === "freeform") {
      setDrag({ kind: "freeform", points: [point] });
      return;
    }
    if (mode === "rectangle") {
      setDrag({ kind: "rect", start: point, current: point });
    }
  }

  function onPointerMove(event: React.PointerEvent) {
    const point = localPoint(event);
    if (mode === "window") {
      setHover(windowUnderCursor(windows, point, scale, monitorOrigin));
    }
    setDrag((current) => {
      if (!current) return current;
      if (current.kind === "rect") return { ...current, current: point };
      return { kind: "freeform", points: [...current.points, point] };
    });
  }

  async function commit(selection: Selection) {
    if (saving) return;
    setSaving(true);
    try {
      await invoke("capture_selection", {
        selection: toPhysical(selection, scale, monitorOrigin),
        offsetMinutes: -new Date().getTimezoneOffset(),
      });
    } catch {
      // The overlay must close either way. A failed save is reported from the main window.
    } finally {
      onDone();
    }
  }

  function onPointerUp(event: React.PointerEvent) {
    if (!drag) {
      if (mode === "fullscreen" && !(event.target as HTMLElement).closest(".snip-toolbar")) {
        void commit({ kind: "rect", x: 0, y: 0, width: size.width, height: size.height });
      }
      if (mode === "window" && hover) {
        void commit({
          kind: "rect",
          x: hover.x,
          y: hover.y,
          width: hover.width,
          height: hover.height,
        });
      }
      return;
    }
    const finished = drag;
    setDrag(null);
    if (finished.kind === "rect") {
      const rect = rectFromDrag(finished.start, finished.current);
      if (rect) void commit(rect);
      return;
    }
    const points = simplifyFreeform(finished.points);
    if (freeformBounds(points)) void commit({ kind: "freeform", points });
  }

  const liveRect =
    drag?.kind === "rect" ? rectFromDrag(drag.start, drag.current) : drag ? freeformBounds(drag.points) : null;
  const highlight =
    mode === "window"
      ? hover && toOverlayRect(hover, scale, monitorOrigin)
      : mode === "fullscreen"
        ? { x: 0, y: 0, width: size.width, height: size.height }
        : liveRect;

  const path =
    drag?.kind === "freeform" && drag.points.length > 1
      ? drag.points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ")
      : "";

  return (
    <div
      ref={surface}
      className={`snip-overlay mode-${mode}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <svg className="snip-dim" width={size.width} height={size.height} aria-hidden="true">
        <defs>
          <mask id="snip-hole">
            <rect width="100%" height="100%" fill="white" />
            {highlight && "width" in highlight && (
              <rect
                x={highlight.x}
                y={highlight.y}
                width={highlight.width}
                height={highlight.height}
                fill="black"
              />
            )}
            {drag?.kind === "freeform" && path && (
              <path d={`${path} Z`} fill="black" />
            )}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.45)" mask="url(#snip-hole)" />
        {highlight && "width" in highlight && (
          <rect
            className="snip-frame"
            x={highlight.x}
            y={highlight.y}
            width={highlight.width}
            height={highlight.height}
          />
        )}
        {path && <path className="snip-lasso" d={path} />}
      </svg>

      <div
        className="snip-toolbar"
        role="toolbar"
        aria-label="Snipping mode"
        style={{ left: 16, top: 16 }}
      >
        {(Object.keys(MODE_LABEL) as SnipMode[]).map((item) => (
          <button
            key={item}
            type="button"
            className={item === mode ? "on" : ""}
            aria-pressed={item === mode}
            title={MODE_LABEL[item]}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setMode(item)}
          >
            <ModeIcon mode={item} />
            <span>{MODE_LABEL[item]}</span>
          </button>
        ))}
        <button
          type="button"
          className="cancel"
          title="Cancel (Esc)"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onDone}
        >
          Cancel
        </button>
      </div>

      <p className="snip-hint">{saving ? "Saving…" : modeHint(mode)}</p>
      {liveRect && (
        <span
          className="snip-size"
          style={{ left: liveRect.x, top: Math.max(8, liveRect.y - 28) }}
        >
          {sizeLabel(liveRect.width, liveRect.height)}
        </span>
      )}
    </div>
  );
}

function ModeIcon({ mode }: { mode: SnipMode }) {
  if (mode === "rectangle") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2.5" y="3.5" width="11" height="9" />
      </svg>
    );
  }
  if (mode === "window") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2.5" y="3.5" width="11" height="9" />
        <path d="M2.5 6.5h11" />
      </svg>
    );
  }
  if (mode === "fullscreen") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8c2-4 3 4 5 0s3 4 5 0" />
    </svg>
  );
}

function toOverlayRect(hit: WindowHit, scale: number, origin: Point) {
  return {
    x: (hit.x - origin.x) / scale,
    y: (hit.y - origin.y) / scale,
    width: hit.width / scale,
    height: hit.height / scale,
  };
}

/** Cover the monitor under the cursor before the dim paints, so other displays stay usable. */
export async function coverCursorMonitor(): Promise<{ scale: number; origin: Point }> {
  const point = await cursorPosition();
  const monitors = await availableMonitors();
  const monitor =
    monitors.find(
      (item) =>
        point.x >= item.position.x &&
        point.y >= item.position.y &&
        point.x < item.position.x + item.size.width &&
        point.y < item.position.y + item.size.height,
    ) ?? monitors[0];
  if (!monitor) return { scale: 1, origin: { x: 0, y: 0 } };
  const position = monitor.position.toLogical(monitor.scaleFactor);
  const monitorSize = monitor.size.toLogical(monitor.scaleFactor);
  const win = getCurrentWindow();
  await win.setPosition(new LogicalPosition(position.x, position.y));
  await win.setSize(new LogicalSize(monitorSize.width, monitorSize.height));
  return { scale: monitor.scaleFactor, origin: { x: monitor.position.x, y: monitor.position.y } };
}
