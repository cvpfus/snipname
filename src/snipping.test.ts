import assert from "node:assert/strict";
import test from "node:test";
import {
  freeformBounds,
  nextMode,
  rectFromDrag,
  simplifyFreeform,
  toPhysical,
  windowUnderCursor,
  type WindowHit,
} from "./snipping.ts";

test("a snip on a secondary monitor keeps the desktop origin", () => {
  assert.deepEqual(
    toPhysical({ kind: "rect", x: 10, y: 20, width: 30, height: 40 }, 2, { x: 1920, y: 0 }),
    { kind: "rect", x: 1940, y: 40, width: 60, height: 80 },
  );
});

test("mode cycles the Windows toolbar order", () => {
  assert.equal(nextMode("rectangle", 1), "window");
  assert.equal(nextMode("freeform", 1), "rectangle");
  assert.equal(nextMode("rectangle", -1), "freeform");
});

test("drag from the bottom-right still produces a positive rect", () => {
  const rect = rectFromDrag({ x: 80, y: 90 }, { x: 20, y: 30 });
  assert.deepEqual(rect, { kind: "rect", x: 20, y: 30, width: 60, height: 60 });
  assert.equal(rectFromDrag({ x: 0, y: 0 }, { x: 2, y: 40 }), null);
});

test("freeform drops points closer than 2px and rejects a dot", () => {
  const simplified = simplifyFreeform([
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 8, y: 0 },
    { x: 8, y: 12 },
  ]);
  assert.deepEqual(simplified, [
    { x: 0, y: 0 },
    { x: 8, y: 0 },
    { x: 8, y: 12 },
  ]);
  assert.equal(freeformBounds([{ x: 1, y: 1 }, { x: 2, y: 2 }]), null);
});

test("window hit prefers the first, topmost window", () => {
  const windows: WindowHit[] = [
    { id: 1, title: "Dialog", appName: "App", x: 40, y: 40, width: 100, height: 80 },
    { id: 2, title: "Behind", appName: "App", x: 0, y: 0, width: 400, height: 300 },
  ];
  assert.equal(windowUnderCursor(windows, { x: 50, y: 50 })?.id, 1);
  assert.equal(windowUnderCursor(windows, { x: 10, y: 10 })?.id, 2);
  assert.equal(windowUnderCursor(windows, { x: 500, y: 10 }), null);
  assert.equal(
    windowUnderCursor(windows, { x: 25, y: 25 }, 2, { x: 0, y: 0 })?.id,
    1,
  );
});
