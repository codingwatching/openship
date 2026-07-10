import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdtemp,
  rm as fsRm,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { TRANSFER_EXCLUDES, PACKAGE_ROOT_ONLY_EXCLUDES } from "@repo/core";
import { getTarCreateArgs, getTarCreateEnv } from "../archive";
import type { LogEntry, SshConfig } from "../types";
import {
  emitBufferedLines,
  flushBufferedLines,
  hasLocalCommand,
  logEntry,
  sq,
} from "./local-shell";
import { reconcileKnownHosts } from "./ssh-support";

const execFileAsync = promisify(execFile);

/** Names that double as real source folders — anchored to the sync root, not
 *  matched at any depth (see stacks.ts PACKAGE_ROOT_ONLY_EXCLUDES). */
const ROOT_ONLY_EXCLUDES = new Set<string>(PACKAGE_ROOT_ONLY_EXCLUDES);

/**
 * Push rsync filter args for a source transfer.
 *
 *  - Explicit caller excludes (e.g. artifact transfers) → that list, anchoring
 *    the ambiguous output names to the sync root.
 *  - Otherwise, if the source has a `.gitignore`, let GIT decide: rsync's
 *    per-directory `:- .gitignore` merge applies real git semantics (nested
 *    files, negations, anchoring), so a committed `build/` route ships and an
 *    ignored `dist/` doesn't — no hardcoded name list involved. Floor rules
 *    added first (first match wins): `.git` (never in .gitignore) and
 *    `node_modules` (insurance if a repo forgot to ignore it).
 *  - No `.gitignore` → fall back to the curated anchored list.
 */
function pushRsyncFilters(args: string[], localPath: string, explicit?: string[]): void {
  if (explicit) {
    for (const ex of explicit) {
      args.push("--exclude", ROOT_ONLY_EXCLUDES.has(ex) ? `/${ex}` : ex);
    }
    return;
  }
  if (existsSync(join(localPath, ".gitignore"))) {
    args.push("--exclude", ".git", "--exclude", "node_modules", "--filter", ":- .gitignore");
    return;
  }
  for (const ex of TRANSFER_EXCLUDES) {
    args.push("--exclude", ROOT_ONLY_EXCLUDES.has(ex) ? `/${ex}` : ex);
  }
}

/**
 * Total bytes under `path` - header decoration only, NOT load-bearing.
 *
 * Uses bare `du -sk` (portable across GNU + BSD); the GNU `--exclude=` flag
 * isn't supported on macOS so we skip excludes here. That means the
 * estimate over-reports when the source dir has excluded children
 * (node_modules etc.), but the byte-flowing heartbeat below is what
 * actually shows progress - this number is just a "you're about to ship
 * roughly X" preface.
 */
/**
 * Detect whether the local `rsync` binary is rsync 3.0 or newer.
 *
 * macOS ships rsync 2.6.9 (released 2006). The 3.0 line (2008) added
 * `--skip-compress`, faster algorithms, and a different protocol. Devs
 * who haven't `brew install rsync` are running the 2.6.9 vintage and
 * crash on the newer flags.
 *
 * Cached once per process - `rsync --version` is cheap but the result
 * is stable for the lifetime of the API server. Returns false on any
 * detection failure (timeout, parse error, missing binary) - safer to
 * use the 2.x-compatible flag set than to risk a deploy-breaking error.
 */
let _modernRsyncCache: Promise<boolean> | null = null;
async function isModernRsync(): Promise<boolean> {
  if (_modernRsyncCache) return _modernRsyncCache;
  _modernRsyncCache = (async () => {
    try {
      const { stdout } = await execFileAsync("rsync", ["--version"], {
        timeout: 5_000,
      });
      // Line shape: "rsync  version 3.2.7  protocol version 31"
      // We just need the leading "version X.Y" token.
      const match = stdout.match(/version\s+(\d+)\.(\d+)/i);
      if (!match) return false;
      const major = Number.parseInt(match[1], 10);
      return Number.isFinite(major) && major >= 3;
    } catch {
      return false;
    }
  })();
  return _modernRsyncCache;
}

async function estimateLocalSize(path: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("du", ["-sk", path]);
    const kb = Number.parseInt(stdout.trim().split(/\s+/)[0] ?? "", 10);
    return Number.isFinite(kb) ? kb * 1024 : null;
  } catch {
    return null;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

type TransferOptions = { excludes?: string[]; includes?: string[] };
type LogCallback = (log: LogEntry) => void;

export interface RemoteTransferDeps {
  config: SshConfig;
  hasRemoteCommand(command: string): Promise<boolean>;
  ensureRemoteDir(path: string): Promise<void>;
  pipeLocal(
    localCmd: string,
    remoteCmd: string,
    onLog?: LogCallback,
    onBytes?: (bytes: number) => void,
  ): Promise<{ code: number }>;
}

export async function canUseRemoteRsync(
  deps: RemoteTransferDeps,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (deps.config.privateKey && deps.config.privateKeyPassphrase && !deps.config.sshAgent) {
    return { ok: false, reason: "encrypted SSH keys without an agent are not supported by non-interactive rsync" };
  }

  const [localRsync, localSsh, localSshpass, remoteRsync] = await Promise.all([
    hasLocalCommand("rsync"),
    hasLocalCommand("ssh"),
    deps.config.password ? hasLocalCommand("sshpass") : Promise.resolve(true),
    deps.hasRemoteCommand("rsync"),
  ]);

  if (!localRsync) {
    return { ok: false, reason: "local rsync is not installed" };
  }

  if (!localSsh) {
    return { ok: false, reason: "local ssh is not installed" };
  }

  if (!localSshpass) {
    return { ok: false, reason: "local sshpass is not installed for password-based rsync" };
  }

  if (!remoteRsync) {
    return { ok: false, reason: "remote rsync is not installed" };
  }

  return { ok: true };
}

export async function transferRemoteDirectoryWithRsync(
  localPath: string,
  remotePath: string,
  deps: RemoteTransferDeps,
  onLog?: LogCallback,
  options?: TransferOptions,
): Promise<void> {
  await reconcileKnownHosts(deps.config);
  await deps.ensureRemoteDir(remotePath);

  // macOS ships rsync 2.6.9 (from 2006) and rejects rsync-3.0+ flags
  // like `--skip-compress`. We detect once per process whether the
  // local rsync is "modern enough" and only add the flag when safe.
  const modernRsync = await isModernRsync();
  await withTemporaryPrivateKey(deps.config, async (keyPath) => {
    const args = [
      "-az",
      "--partial",
      "--progress",
      "--stats",
      // --whole-file skips rsync's per-block delta algorithm and sends
      // each file as one stream. Our target dirs are always fresh -
      // the deploy pipeline `rm -rf`'s them before transfer - so the
      // delta scan has nothing to compare against and is pure overhead
      // (each file pays a checksum/metadata roundtrip for zero gain).
      // 20–40% faster on first-time transfers of build artifacts.
      // Supported in rsync since 2.4, safe on every install.
      "--whole-file",
    ];
    if (modernRsync) {
      // --skip-compress tells rsync NOT to gzip already-compressed
      // binary formats. Without this, `-z` wastes CPU gzipping
      // PNG/JPG/etc which are already entropy-maxed - that CPU stall
      // throttles the wire (the big PNG dips at ~150 KB/s mid-file).
      // Text-like assets (JS/CSS/HTML/JSON/SVG) still get -z and see
      // real ~3-5× wire savings.
      args.push(
        "--skip-compress=" +
          "png/jpg/jpeg/gif/webp/avif/bmp/ico/" +
          "woff/woff2/ttf/otf/eot/" +
          "mp4/webm/mov/mp3/m4a/ogg/oga/ogv/" +
          "zip/gz/tgz/bz2/xz/7z/rar/" +
          "wasm/pdf",
      );
    }
    args.push("-e", buildRsyncSshCommand(deps.config, keyPath));

    const target = formatRsyncTarget(deps.config, remotePath);

    if (options?.includes?.length) {
      args.push(...options.includes, target);
      onLog?.(logEntry(`Using rsync with live progress (${options.includes.length} selected paths)...`));
      const { code } = await runRsync(deps.config, args, onLog, localPath);
      if (code !== 0) {
        throw new Error("rsync transfer failed");
      }
      return;
    }

    pushRsyncFilters(args, localPath, options?.excludes);

    args.push(`${localPath}/`, target);
    onLog?.(logEntry("Using rsync with live progress for remote transfer..."));

    const { code } = await runRsync(deps.config, args, onLog);
    if (code !== 0) {
      throw new Error("rsync transfer failed");
    }
  });
}

export async function transferRemoteDirectoryWithTar(
  localPath: string,
  remotePath: string,
  deps: RemoteTransferDeps,
  onLog?: LogCallback,
  options?: TransferOptions,
): Promise<void> {
  const excludes = options?.excludes ?? [...TRANSFER_EXCLUDES];
  const tarArgs = getTarCreateArgs(localPath, {
    excludes,
    includes: options?.includes,
  });

  // Best-effort upfront size - gives a "Streaming 142 MB…" header and a
  // denominator for the percentage. NOT required for progress to fire -
  // the byte counter below works without it. Null is acceptable; we
  // degrade to wire-bytes-only.
  const totalBytes = await estimateLocalSize(localPath);

  if (totalBytes !== null && totalBytes > 0) {
    onLog?.(logEntry(`Streaming ~${formatBytes(totalBytes)} of source as tar over the existing SSH connection...`));
  } else {
    onLog?.(logEntry("Streaming source as tar over the existing SSH connection..."));
  }

  const tarCmd = `tar ${tarArgs.map(sq).join(" ")}`;
  const startedAt = Date.now();

  // Heartbeat - count bytes flowing through the pipe, print every 3s.
  // Compressed wire bytes, not source bytes - so when totalBytes (source)
  // is set, the displayed percentage is "wire vs source" and tends to be
  // a slight under-read (tar -z compresses ~30-60% for typical builds).
  // Still useful: shows the transfer is alive AND advancing.
  let bytesSent = 0;
  let lastReportedAt = Date.now();
  const heartbeat = setInterval(() => {
    const now = Date.now();
    const elapsed = (now - startedAt) / 1000;
    const sinceLast = (now - lastReportedAt) / 1000;
    if (sinceLast < 2.5) return;
    lastReportedAt = now;
    const mbps = elapsed > 0 ? bytesSent / 1024 / 1024 / elapsed : 0;
    if (totalBytes && totalBytes > 0) {
      // Heuristic ceiling - wire bytes can plausibly reach ~total when
      // the data is incompressible; cap the displayed percent so we
      // don't show "120%" on text-heavy trees that compressed below 50%.
      const ratio = Math.min(bytesSent / totalBytes, 1);
      const pct = Math.floor(ratio * 100);
      onLog?.(
        logEntry(
          `  ~${pct}% · ${formatBytes(bytesSent)} sent · ${mbps.toFixed(1)} MB/s · ${elapsed.toFixed(0)}s elapsed`,
        ),
      );
    } else {
      onLog?.(
        logEntry(
          `  ${formatBytes(bytesSent)} sent · ${mbps.toFixed(1)} MB/s · ${elapsed.toFixed(0)}s elapsed`,
        ),
      );
    }
  }, 3_000);
  // Don't let the heartbeat keep the process alive on test/CLI shutdowns.
  heartbeat.unref();

  try {
    const { code } = await deps.pipeLocal(
      tarCmd,
      `mkdir -p ${sq(remotePath)} && tar xzf - -C ${sq(remotePath)}`,
      onLog,
      (bytes) => {
        bytesSent += bytes;
      },
    );
    if (code !== 0) {
      throw new Error("Failed to transfer files to remote server");
    }
  } finally {
    clearInterval(heartbeat);
  }

  const elapsed = Math.max(1, Date.now() - startedAt);
  const mbps = bytesSent / 1024 / 1024 / (elapsed / 1000);
  onLog?.(
    logEntry(
      `Transferred ${formatBytes(bytesSent)} (wire) in ${(elapsed / 1000).toFixed(1)}s · ${mbps.toFixed(1)} MB/s`,
    ),
  );
}

function formatRsyncTarget(config: SshConfig, remotePath: string): string {
  const host = config.host.includes(":") ? `[${config.host}]` : config.host;
  const user = config.username ?? "root";
  const normalized = remotePath.endsWith("/") ? remotePath : `${remotePath}/`;
  return `${user}@${host}:${sq(normalized)}`;
}

function buildRsyncSshCommand(config: SshConfig, keyPath?: string): string {
  const args = config.password
    ? [
        "sshpass",
        "-e",
        "ssh",
        "-p",
        String(config.port ?? 22),
        "-o",
        "NumberOfPasswordPrompts=1",
        "-o",
        "PreferredAuthentications=password,keyboard-interactive",
        "-o",
        "PubkeyAuthentication=no",
        "-o",
        "StrictHostKeyChecking=accept-new",
      ]
    : [
        "ssh",
        "-p",
        String(config.port ?? 22),
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
      ];

  if (config.sshAgent) {
    args.push("-A");
  }

  if (keyPath) {
    args.push("-i", keyPath, "-o", "IdentitiesOnly=yes");
  }

  return args.map(sq).join(" ");
}

async function withTemporaryPrivateKey<T>(
  config: SshConfig,
  fn: (keyPath?: string) => Promise<T>,
): Promise<T> {
  if (!config.privateKey || config.sshAgent) {
    return fn();
  }

  const tempDir = await mkdtemp(join(tmpdir(), "openship-rsync-key-"));
  const keyPath = join(tempDir, "id_rsa");

  try {
    await fsWriteFile(keyPath, config.privateKey);
    await chmod(keyPath, 0o600);
    return await fn(keyPath);
  } finally {
    await fsRm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function runRsync(
  config: SshConfig,
  args: string[],
  onLog?: LogCallback,
  cwd?: string,
): Promise<{ code: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("rsync", args, {
      cwd,
      env: {
        ...getTarCreateEnv(),
        ...(config.password ? { SSHPASS: config.password } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutState = { partial: "" };
    const stderrState = { partial: "" };

    proc.stdout.on("data", (chunk: Buffer) => {
      emitBufferedLines(chunk, stdoutState, (line) => onLog?.(logEntry(line)));
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      emitBufferedLines(chunk, stderrState, (line) => onLog?.(logEntry(line)));
    });

    proc.on("error", (err) => {
      reject(new Error(`rsync failed to start: ${err.message}`));
    });

    proc.on("close", (code) => {
      flushBufferedLines(stdoutState, (line) => onLog?.(logEntry(line)));
      flushBufferedLines(stderrState, (line) => onLog?.(logEntry(line)));
      resolve({ code: code ?? 1 });
    });
  });
}