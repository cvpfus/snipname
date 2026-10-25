import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Overlay, coverCursorMonitor } from "./overlay";
import type { SnipMode } from "./snipping";
import "./overlay.css";

function modeFromUrl(): SnipMode {
  const value = new URLSearchParams(window.location.search).get("mode") ?? "";
  return isMode(value) ? value : "rectangle";
}

export function CaptureRoot() {
  const [mode, setMode] = useState<SnipMode>(modeFromUrl);
  const [ready, setReady] = useState(false);
  const [scale, setScale] = useState(1);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    const root = document.getElementById("root");
    if (root) root.style.background = "transparent";
    let alive = true;
    coverCursorMonitor()
      .then((covered) => {
        if (!alive) return;
        setScale(covered.scale);
        setOrigin(covered.origin);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setReady(true);
      });
    void invoke<string>("current_snip_mode").then((value) => {
      if (alive && isMode(value)) setMode(value);
    });
    const unlisten = listen<string>("overlay-mode", (event) => {
      if (isMode(event.payload)) setMode(event.payload);
    });
    return () => {
      alive = false;
      void unlisten.then((stop) => stop());
    };
  }, []);

  if (!ready) return null;

  return (
    <Overlay
      initialMode={mode}
      scale={scale}
      origin={origin}
      onDone={() => {
        void getCurrentWindow().hide();
        void invoke("show_main");
      }}
    />
  );
}

function isMode(value: string): value is SnipMode {
  return value === "rectangle" || value === "window" || value === "fullscreen" || value === "freeform";
}
