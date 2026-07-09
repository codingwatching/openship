/**
 * In-app updater for the packaged desktop app.
 *
 * Cycle: checkForUpdate() (GitHub latest release vs app.getVersion()) →
 * downloadUpdate() (streams the platform installer with progress) →
 * installUpdate() (seamless self-replace + relaunch).
 *
 * No code signing needed: we download the installer and swap the app
 * ourselves (not Squirrel.Mac, which requires signing). A detached script
 * does the swap because a running app can't overwrite its own bundle.
 */

import { app, net, shell } from "electron";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const RELEASES_API = "https://api.github.com/repos/oblien/openship/releases/latest";

export interface UpdateAsset {
  name: string;
  url: string;
  size: number;
}
export interface UpdateInfo {
  available: true;
  version: string;
  notes: string;
  asset: UpdateAsset;
}
export type UpdateCheck = UpdateInfo | { available: false };

/** Installer asset name published by the release pipeline for this platform. */
function assetNameForPlatform(): string {
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "Openship-arm64.dmg" : "Openship-x64.dmg";
  }
  if (process.platform === "win32") return "Openship-Setup.exe";
  return "Openship.AppImage";
}

/** X.Y.Z compare, prerelease suffix ignored (the /latest endpoint is stable). */
function semverGt(a: string, b: string): boolean {
  const parse = (v: string) =>
    v.split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

/**
 * Ask GitHub for the latest release; return update info if it's newer than
 * the running version and has an installer for this platform. Never throws —
 * a failed check (offline, rate-limited) resolves to "no update".
 */
export async function checkForUpdate(): Promise<UpdateCheck> {
  try {
    const res = await net.fetch(RELEASES_API, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Openship-Desktop",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { available: false };
    const data = (await res.json()) as {
      tag_name?: string;
      body?: string;
      assets?: Array<{ name: string; browser_download_url: string; size: number }>;
    };
    const latest = (data.tag_name ?? "").replace(/^v/, "");
    if (!latest || !semverGt(latest, app.getVersion())) {
      return { available: false };
    }
    const wantName = assetNameForPlatform();
    const asset = (data.assets ?? []).find((a) => a.name === wantName);
    if (!asset) return { available: false };
    return {
      available: true,
      version: latest,
      notes: data.body ?? "",
      asset: { name: asset.name, url: asset.browser_download_url, size: asset.size },
    };
  } catch {
    return { available: false };
  }
}

/** Download the asset to a temp file, reporting 0..1 progress. Returns the path. */
export async function downloadUpdate(
  asset: UpdateAsset,
  onProgress: (fraction: number) => void,
): Promise<string> {
  const dir = join(app.getPath("temp"), "openship-update");
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, asset.name);

  const res = await net.fetch(asset.url, {
    headers: { "User-Agent": "Openship-Desktop" },
  });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: HTTP ${res.status}`);
  }

  const total = Number(res.headers.get("content-length")) || asset.size || 0;
  const file = createWriteStream(dest);
  const reader = res.body.getReader();
  let received = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!file.write(Buffer.from(value))) {
        await new Promise<void>((r) => file.once("drain", r));
      }
      received += value.length;
      if (total > 0) onProgress(Math.min(1, received / total));
    }
  } finally {
    file.end();
  }
  await new Promise<void>((r, j) => {
    file.on("finish", () => r());
    file.on("error", j);
  });
  return dest;
}

/**
 * Apply the downloaded installer and relaunch on the new version. Quits the
 * app as its last step (the swap must happen while we're NOT running).
 */
export function installUpdate(file: string): void {
  try {
    if (process.platform === "darwin") return installMac(file);
    if (process.platform === "win32") return installWindows(file);
    return installLinux(file);
  } catch (err) {
    console.error("[updater] seamless install failed, opening installer:", err);
    fallbackOpen(file);
  }
}

/** Last resort: hand the installer to the OS and quit; user finishes it. */
function fallbackOpen(file: string): void {
  void shell.openPath(file);
  app.quit();
}

/** Spawn a detached script that waits for us to exit, then runs `body`. */
function runDetachedAfterExit(scriptBody: string, ext: "sh" | "cmd"): void {
  const dir = join(app.getPath("temp"), "openship-update");
  mkdirSync(dir, { recursive: true });
  const scriptPath = join(dir, `apply-update.${ext}`);
  writeFileSync(scriptPath, scriptBody, { mode: 0o755 });
  if (ext === "sh") chmodSync(scriptPath, 0o755);
  const child =
    ext === "sh"
      ? spawn("/bin/bash", [scriptPath], { detached: true, stdio: "ignore" })
      : spawn("cmd.exe", ["/c", scriptPath], { detached: true, stdio: "ignore" });
  child.unref();
  app.quit();
}

function installMac(dmg: string): void {
  // The running app bundle: <exe>/../../.. → …/Openship.app
  const installedApp = resolve(app.getPath("exe"), "..", "..", "..");
  if (!installedApp.endsWith(".app")) {
    return fallbackOpen(dmg);
  }

  const staged = join(app.getPath("temp"), "openship-update", "Openship.app");

  // Mount, copy the new .app out, unmount — all before we quit.
  const attach = spawnSync(
    "hdiutil",
    ["attach", "-nobrowse", "-readonly", "-noverify", dmg],
    { encoding: "utf8" },
  );
  if (attach.status !== 0) return fallbackOpen(dmg);
  const mount = (attach.stdout.match(/\/Volumes\/[^\n]*/g) ?? []).pop()?.trim();
  if (!mount) return fallbackOpen(dmg);

  try {
    const appInDmg = join(mount, "Openship.app");
    if (!existsSync(appInDmg)) return fallbackOpen(dmg);
    spawnSync("rm", ["-rf", staged]);
    const copy = spawnSync("ditto", [appInDmg, staged], { encoding: "utf8" });
    if (copy.status !== 0) return fallbackOpen(dmg);
  } finally {
    spawnSync("hdiutil", ["detach", mount, "-quiet"]);
  }

  // Wait for us to exit, swap the bundle, relaunch.
  runDetachedAfterExit(
    [
      "#!/bin/bash",
      `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.4; done`,
      `rm -rf "${installedApp}"`,
      `ditto "${staged}" "${installedApp}"`,
      `open "${installedApp}"`,
      `rm -rf "${staged}"`,
      "",
    ].join("\n"),
    "sh",
  );
}

function installWindows(setupExe: string): void {
  // The Squirrel installer handles updating a running app; just launch it.
  void shell.openPath(setupExe);
  app.quit();
}

function installLinux(appImage: string): void {
  const current = process.env.APPIMAGE;
  if (!current) return fallbackOpen(appImage);
  runDetachedAfterExit(
    [
      "#!/bin/bash",
      `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.4; done`,
      `cp -f "${appImage}" "${current}"`,
      `chmod +x "${current}"`,
      `"${current}" &`,
      "",
    ].join("\n"),
    "sh",
  );
}
