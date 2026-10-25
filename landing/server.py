#!/usr/bin/env python3
"""Serve the landing page and proxy the latest Windows artifact as a file download."""

import json
import os
import subprocess
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = "cvpfus/snipname"
WORKFLOW = "build-windows.yml"
ARTIFACT = "snipname-windows"
SETUP_NAME = "snipname_0.1.0_x64-setup.exe"


def github(path: str):
    """Call the GitHub API through gh so the landing server uses the same login as this checkout."""
    proc = subprocess.run(
        ["gh", "api", path],
        check=False,
        capture_output=True,
        text=True,
        timeout=60,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or "gh api failed")
    if not proc.stdout:
        return b""
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return proc.stdout.encode()


def latest():
    runs = github(
        f"/repos/{REPO}/actions/workflows/{WORKFLOW}/runs?status=success&per_page=5"
    )
    for run in runs.get("workflow_runs", []):
        arts = github(f"/repos/{REPO}/actions/runs/{run['id']}/artifacts")
        for art in arts.get("artifacts", []):
            if art["name"] == ARTIFACT and not art.get("expired"):
                return run, art
    raise RuntimeError("no snipname-windows artifact")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_HEAD(self):
        self._route(head=True)

    def do_GET(self):
        self._route(head=False)

    def _route(self, head: bool):
        path = self.path.split("?", 1)[0]
        if path == "/api/latest":
            self.serve_meta(head)
            return
        if path in ("/download/snipname-windows.zip", "/download/latest.zip"):
            self.serve_zip(head)
            return
        if path in ("/download/setup.exe", f"/download/{SETUP_NAME}"):
            self.serve_setup(head)
            return
        if path == "/og.png":
            self.path = "/og.svg"
        if head:
            super().do_HEAD()
        else:
            super().do_GET()

    def _send(self, status: int, body: bytes, content_type: str, disposition: str | None, head: bool):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        if disposition:
            self.send_header("Content-Disposition", disposition)
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def serve_meta(self, head: bool = False):
        try:
            run, art = latest()
            body = {
                "ok": True,
                "sha": run.get("head_sha", "")[:7],
                "builtAt": run.get("created_at") or art.get("created_at"),
                "expiresAt": art.get("expires_at"),
                "size": art.get("size_in_bytes"),
                "runUrl": run.get("html_url"),
                "setupUrl": f"/download/{SETUP_NAME}",
                "zipUrl": "/download/snipname-windows.zip",
                "setupName": SETUP_NAME,
            }
            self._send(200, json.dumps(body).encode(), "application/json", None, head)
        except Exception as exc:
            raw = json.dumps({"ok": False, "error": str(exc)}).encode()
            self._send(502, raw, "application/json", None, head)

    def serve_zip(self, head: bool = False):
        try:
            _, art = latest()
            fetched = github(f"/repos/{REPO}/actions/artifacts/{art['id']}/zip")
            data = fetched if isinstance(fetched, bytes) else b""
            if not data.startswith(b"PK"):
                raise RuntimeError("artifact download was not a zip")
        except Exception:
            staged = ROOT / "files" / "snipname-windows.zip"
            if not staged.is_file():
                msg = b"Could not fetch the latest artifact.\n"
                self._send(502, msg, "text/plain; charset=utf-8", None, head)
                return
            data = staged.read_bytes()
        self._send(
            200,
            data,
            "application/zip",
            'attachment; filename="snipname-windows.zip"',
            head,
        )

    def serve_setup(self, head: bool = False):
        setup = ROOT / "files" / SETUP_NAME
        if not setup.is_file():
            self._send(
                404,
                b"Installer is not staged on this server.\n",
                "text/plain; charset=utf-8",
                None,
                head,
            )
            return
        self._send(
            200,
            setup.read_bytes(),
            "application/octet-stream",
            f'attachment; filename="{SETUP_NAME}"',
            head,
        )


def main():
    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"listening on {port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
