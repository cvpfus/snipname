import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";

type Shot = { path: string; name: string };
type Row = Shot & {
  status: "idle" | "reading" | "named" | "done" | "error";
  proposed?: string;
  reason?: string;
  error?: string;
};
type OllamaStatus = { ok: boolean; message: string; models: string[] };

export default function App() {
  const [dir, setDir] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState("gemma3:4b");
  const [ollamaUrl, setOllamaUrl] = useState("http://127.0.0.1:11434");
  const [status, setStatus] = useState<string | null>(null);
  const [log, setLog] = useState<string | null>(null);

  useEffect(() => {
    invoke<string>("default_screenshots_dir")
      .then(setDir)
      .catch((e) => setLog(String(e)));
  }, []);

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
    setLog(null);
    try {
      const s = await invoke<OllamaStatus>("check_ollama", { ollamaUrl });
      setStatus(s.message);
      if (s.models.length && !s.models.some((m) => m.startsWith(model.split(":")[0]!))) {
        setStatus(`${s.message} · tip: pull your model with ollama pull ${model}`);
      }
      if (!s.ok) setLog(s.message);
    } catch (e) {
      setStatus(null);
      setLog(String(e));
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
            const dest = await invoke<string>("rename_shot", {
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
          Rename “Cuplikan layar …” from what’s on the screen — Gemma runs locally via Ollama
          (called from the app, no CORS setup).
        </p>
      </header>

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
          <input value={ollamaUrl} onChange={(e) => setOllamaUrl(e.target.value)} />
        </label>
        <label>
          Model
          <input value={model} onChange={(e) => setModel(e.target.value)} />
        </label>
        <div className="actions">
          <button disabled={busy} onClick={() => void pingOllama()}>
            Check Ollama
          </button>
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
        {status && <p className="ok">{status}</p>}
      </section>

      {log && <p className="err">{log}</p>}

      <ul className="list">
        {rows.length === 0 && <li className="empty">No unnamed screenshots yet. Hit Scan.</li>}
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
