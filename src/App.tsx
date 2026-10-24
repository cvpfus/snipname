import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { nameScreenshot } from "./lib/ollama";
import { slugify } from "./lib/slug";
import "./App.css";

type Shot = { path: string; name: string };
type Row = Shot & {
  status: "idle" | "reading" | "named" | "done" | "error";
  proposed?: string;
  reason?: string;
  error?: string;
};

export default function App() {
  const [dir, setDir] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState("gemma3:4b");
  const [log, setLog] = useState<string | null>(null);

  useEffect(() => {
    invoke<string>("default_screenshots_dir")
      .then(setDir)
      .catch((e) => setLog(String(e)));
  }, []);

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
          const b64 = await invoke<string>("read_image_b64", { path: row.path });
          const named = await nameScreenshot(b64, { model });
          const stem = slugify(named.name);
          next[i] = { ...row, status: "named", proposed: stem, reason: named.reason };
          setRows([...next]);
          if (!dry) {
            const dest = await invoke<string>("rename_shot", {
              from: row.path,
              toName: stem,
            });
            next[i] = {
              ...next[i]!,
              status: "done",
              path: dest,
              name: dest.split(/[/\\]/).pop() ?? stem,
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
        <p>Rename “Cuplikan layar …” from what’s on the screen — Gemma runs locally via Ollama.</p>
      </header>

      <section className="bar">
        <label>
          Screenshots folder
          <input value={dir} onChange={(e) => setDir(e.target.value)} />
        </label>
        <label>
          Model
          <input value={model} onChange={(e) => setModel(e.target.value)} />
        </label>
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
