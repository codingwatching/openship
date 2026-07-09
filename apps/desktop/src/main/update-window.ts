/**
 * The in-app "update available" window: a small frameless BrowserWindow with
 * its own HTML (notify → progress bar → done). Self-contained — it talks to
 * the main process through the SAME preload bridge (`window.desktop.updates`),
 * so no dashboard/web changes are needed.
 */

import { BrowserWindow } from "electron";
import { join } from "node:path";
import type { UpdateInfo } from "./updater";

function buildHtml(info: UpdateInfo): string {
  // Values are injected as a JSON blob and written via textContent in the
  // script, so release-note contents can't inject markup.
  const payload = JSON.stringify({ version: info.version, notes: info.notes });
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    :root{color-scheme:dark}
    html,body{margin:0;height:100%;background:#0f0f0f;color:#fafafa;
      font-family:system-ui,-apple-system,sans-serif}
    .wrap{display:flex;flex-direction:column;height:100vh;padding:22px 22px 18px;box-sizing:border-box}
    h1{font-size:16px;font-weight:600;margin:0 0 4px}
    .sub{font-size:13px;opacity:.6;margin:0 0 14px}
    pre{flex:1;overflow:auto;white-space:pre-wrap;word-break:break-word;
      font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;
      line-height:1.5;opacity:.8;margin:0;padding:12px;border-radius:10px;
      background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08)}
    .bar{display:none;height:8px;border-radius:999px;background:rgba(255,255,255,.12);
      overflow:hidden;margin:14px 0 6px}
    .fill{height:100%;width:0;background:#fafafa;transition:width .15s ease}
    .status{display:none;font-size:12px;opacity:.6;margin:0}
    .row{display:flex;gap:10px;justify-content:flex-end;margin-top:14px}
    button{border-radius:999px;padding:8px 18px;font-size:13px;font-weight:500;
      cursor:pointer;border:1px solid transparent}
    .later{background:transparent;color:#fafafa;border-color:rgba(255,255,255,.16)}
    .go{background:#fafafa;color:#000}
    button:disabled{opacity:.5;cursor:default}
  </style></head><body><div class="wrap">
    <h1 id="title">Update available</h1>
    <p class="sub" id="sub"></p>
    <pre id="notes"></pre>
    <div class="bar" id="bar"><div class="fill" id="fill"></div></div>
    <p class="status" id="status">Downloading…</p>
    <div class="row" id="actions">
      <button class="later" id="later">Later</button>
      <button class="go" id="go">Update now</button>
    </div>
  </div><script>
    const INFO = ${payload};
    const u = window.desktop && window.desktop.updates;
    document.getElementById("sub").textContent =
      "Openship " + INFO.version + " is ready to install.";
    document.getElementById("notes").textContent = (INFO.notes || "").trim() ||
      "A new version is available.";
    const bar = document.getElementById("bar");
    const fill = document.getElementById("fill");
    const status = document.getElementById("status");
    const actions = document.getElementById("actions");
    document.getElementById("later").onclick = () => u && u.dismiss();
    document.getElementById("go").onclick = () => {
      actions.style.display = "none";
      bar.style.display = "block";
      status.style.display = "block";
      if (!u) return;
      u.onProgress((f) => { fill.style.width = Math.round(f * 100) + "%"; });
      u.onDone(() => { status.textContent = "Installing — the app will restart…"; });
      u.onError((msg) => {
        status.textContent = "Update failed: " + (msg || "unknown error");
        actions.style.display = "flex";
        bar.style.display = "none";
      });
      u.start();
    };
  </script></body></html>`;
}

let updateWin: BrowserWindow | null = null;

/** Open (or focus) the update window. Returns it so the caller can push progress. */
export function openUpdateWindow(
  parent: BrowserWindow | null,
  info: UpdateInfo,
): BrowserWindow {
  if (updateWin && !updateWin.isDestroyed()) {
    updateWin.focus();
    return updateWin;
  }
  updateWin = new BrowserWindow({
    width: 460,
    height: 380,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "Openship Update",
    parent: parent ?? undefined,
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  updateWin.once("ready-to-show", () => updateWin?.show());
  updateWin.on("closed", () => {
    updateWin = null;
  });
  void updateWin.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(buildHtml(info))}`,
  );
  return updateWin;
}

export function getUpdateWindow(): BrowserWindow | null {
  return updateWin && !updateWin.isDestroyed() ? updateWin : null;
}

export function closeUpdateWindow(): void {
  if (updateWin && !updateWin.isDestroyed()) updateWin.close();
  updateWin = null;
}
