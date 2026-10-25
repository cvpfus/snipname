import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";
import type { SnipMode } from "./snipping";

type Shot = { path: string; name: string };
type Row = Shot & {
  status: "idle" | "reading" | "named" | "done" | "error";
  proposed?: string;
  reason?: string;
  error?: string;
  copied?: boolean;
};
type ShotSaved = { path: string; name: string; copied: boolean };
type ShotNamed = { from: string; to: string; name: string; reason: string };
type ShotFailed = { path: string; error: string };

const SNIP_SHORTCUT = "PrintScreen";
const MODES: { id: SnipMode; label: string }[] = [
  { id: "rectangle", label: "Rectangle" },
  { id: "window", label: "Window" },
  { id: "fullscreen", label: "Full screen" },
  { id: "freeform", label: "Freeform" },
];
type OllamaStatus = { ok: boolean; message: string; models: string[] };

export default function App() {
  const [dir, setDir] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [model, setModel] = useState("gemma3:4b");
  const [models, setModels] = useState<string[]>([]);
  const [ollamaUrl, setOllamaUrl] = useState("http://127.0.0.1:11434");
  const [status, setStatus] = useState<string | null>(null);
  const [log, setLog] = useState<string | null>(null);
  const [mode, setMode] = useState<SnipMode>("rectangle");
  const [delay, setDelay] = useState(0);
  const [counting, setCounting] = useState<number | null>(null);
  const [shortcutOn, setShortcutOn] = useState(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    invoke<string>("default_screenshots_dir")
      .then(setDir)
      .catch((e) => setLog(String(e)));
  }, []);

  useEffect(() => {
    void pingOllama();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ollamaUrl]);

  useEffect(() => {
    void invoke("remember_settings", { ollamaUrl, model });
  }, [ollamaUrl, model]);

  useEffect(() => {
    const saved = listen<ShotSaved>("shot-saved", (event) => {
      setRows((current) => [
        {
          path: event.payload.path,
          name: event.payload.name,
          status: "reading",
          copied: event.payload.copied,
        },
        ...current.filter((row) => row.path !== event.payload.path),
      ]);
    });
    const named = listen<ShotNamed>("shot-named", (event) => {
      setRows((current) =>
        current.map((row) =>
          row.path === event.payload.from
            ? {
                ...row,
                path: event.payload.to,
                name: event.payload.to.split(/[/\\]/).pop() ?? event.payload.name,
                proposed: event.payload.name,
                reason: event.payload.reason,
                status: "done",
              }
            : row,
        ),
      );
    });
    const failed = listen<ShotFailed>("shot-name-failed", (event) => {
      setRows((current) =>
        current.map((row) =>
          row.path === event.payload.path
            ? { ...row, status: "error", error: event.payload.error }
            : row,
        ),
      );
    });
    return () => {
      void saved.then((stop) => stop());
      void named.then((stop) => stop());
      void failed.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    let alive = true;
    register(SNIP_SHORTCUT, (event) => {
      if (event.state === "Pressed") void startSnip(modeRef.current);
    })
      .then(() => {
        if (alive) setShortcutOn(true);
      })
      .catch(() => {
        if (alive) setShortcutOn(false);
      });
    return () => {
      alive = false;
      void unregister(SNIP_SHORTCUT).catch(() => undefined);
    };
  }, []);

  async function startSnip(nextMode: SnipMode) {
    if (counting !== null) return;
    if (delay > 0) {
      for (let left = delay; left > 0; left -= 1) {
        setCounting(left);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      setCounting(null);
    }
    try {
      await invoke("open_overlay", { mode: nextMode });
    } catch (error) {
      setLog(String(error));
    }
  }

  async function pickFolder() {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: dir || undefined,
      title: "Choose Screenshots folder",
    });
    if (typeof selected === "string") setDir(selected);
  }

  async function pingOllama() {
    setChecking(true);
    setLog(null);
    try {
      const s = await invoke<OllamaStatus>("check_ollama", { ollamaUrl });
      setModels(s.models);
      setStatus(s.message);
      if (s.models.length) {
        if (!s.models.includes(model)) setModel(s.models[0]!);
      } else if (s.ok) {
        setStatus(`${s.message} · run: ollama pull gemma3:4b`);
      }
      if (!s.ok) setLog(s.message);
    } catch (e) {
      setModels([]);
      setStatus(null);
      setLog(String(e));
    } finally {
      setChecking(false);
    }
  }

  async function refresh() {
    setLog(null);
    const list = await invoke<Shot[]>("list_unnamed", { dir });
    setRows(list.map((s) => ({ ...s, status: "idle" })));
  }

  async function run(dry: boolean) {
    setBusy(true);
    setLog(null);
    try {
      const next = [...rows];
      for (let i = 0; i < next.length; i++) {
        const row = next[i]!;
        next[i] = { ...row, status: "reading", error: undefined };
        setRows([...next]);
        try {
          const named = await invoke<{ name: string; reason: string }>("name_screenshot", {
            path: row.path,
            ollamaUrl,
            model,
          });
          next[i] = {
            ...row,
            status: "named",
            proposed: named.name,
            reason: named.reason,
          };
          setRows([...next]);
          if (!dry) {
            const dest = await invoke<string>("rename_shot_command", {
              from: row.path,
              toName: named.name,
            });
            next[i] = {
              ...next[i]!,
              status: "done",
              path: dest,
              name: dest.split(/[/\\]/).pop() ?? named.name,
            };
            setRows([...next]);
          }
        } catch (e) {
          next[i] = { ...row, status: "error", error: String(e) };
          setRows([...next]);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="wrap">
      <header>
        <h1>Snipname</h1>
        <p>
          Snip like Windows, then let local Gemma name the file. The save finishes before the
          rename, so the next snip never waits.
        </p>
      </header>

      <section className="snip">
        <div className="modes" role="radiogroup" aria-label="Snipping mode">
          {MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={mode === item.id}
              className={mode === item.id ? "on" : ""}
              onClick={() => setMode(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label>
          Delay
          <select
            value={delay}
            onChange={(event) => setDelay(Number(event.target.value))}
            aria-label="Delay"
          >
            <option value={0}>No delay</option>
            <option value={3}>3 seconds</option>
            <option value={5}>5 seconds</option>
            <option value={10}>10 seconds</option>
          </select>
        </label>
        <button
          className="primary new"
          type="button"
          disabled={counting !== null}
          onClick={() => void startSnip(mode)}
        >
          {counting !== null ? `Snipping in ${counting}…` : "New"}
        </button>
        <p className="hint">
          {shortcutOn
            ? "Print Screen opens the overlay. The snip is copied and saved immediately; Gemma renames it after."
            : "Print Screen is already taken. Use New — the snip still saves immediately, and Gemma renames it after."}
        </p>
      </section>

      <section className="bar">
        <label>
          Screenshots folder
          <div className="row">
            <input value={dir} readOnly placeholder="Pick a folder…" />
            <button type="button" onClick={() => void pickFolder()}>
              Browse…
            </button>
          </div>
        </label>
        <label>
          Ollama URL
          <div className="row">
            <input value={ollamaUrl} onChange={(e) => setOllamaUrl(e.target.value)} />
            <button type="button" disabled={checking || busy} onClick={() => void pingOllama()}>
              {checking ? "Checking…" : "Check Ollama"}
            </button>
          </div>
        </label>
        <label>
          Model
          {models.length > 0 ? (
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gemma3:4b — pull a model, then Check Ollama"
            />
          )}
        </label>
        {status && (
          <p className={models.length ? "ok" : "err"}>
            {status}
            {models.length > 0 && (
              <span className="models"> · {models.join(", ")}</span>
            )}
          </p>
        )}
        <div className="actions">
          <button disabled={busy || !dir} onClick={() => void refresh()}>
            Scan
          </button>
          <button disabled={busy || rows.length === 0} onClick={() => void run(true)}>
            Dry run
          </button>
          <button
            className="primary"
            disabled={busy || rows.length === 0}
            onClick={() => void run(false)}
          >
            Rename
          </button>
        </div>
      </section>

      {log && <p className="err">{log}</p>}

      <ul className="list">
        {rows.length === 0 && (
          <li className="empty">No snips yet. Press New, or Scan for older unnamed files.</li>
        )}
        {rows.map((r) => (
          <li key={r.path}>
            <div>
              <strong>{r.name}</strong>
              {r.proposed && (
                <span className="arrow">
                  → {r.proposed}
                  {r.status === "done" ? " ✓" : ""}
                </span>
              )}
              {r.copied && r.status === "reading" && (
                <p className="reason">Copied. Naming in the background…</p>
              )}
              {r.reason && <p className="reason">{r.reason}</p>}
              {r.error && <p className="err">{r.error}</p>}
            </div>
            <span className="status">{r.status}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
