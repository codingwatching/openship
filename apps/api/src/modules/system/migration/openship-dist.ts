/**
 * Resolves the path to the pre-built Openship release dist that the
 * migration wizard streams to the operator's remote server.
 *
 * Mirrors the webmail pattern (apps/email/scripts/build-release.ts
 * produces apps/email/dist/, resolveWebmailDistDir() finds it).
 *
 * Resolution order:
 *
 *   1. OPENSHIP_RELEASE_DIST_PATH env override (highest priority).
 *      For Docker images, custom CI bundles, air-gapped installs.
 *   2. <repoRoot>/apps/api/release-dist/ — the dev path produced by
 *      `bun run --cwd apps/api build-release`.
 *   3. <dataDir>/openship-dist/v<version>/ — production cache. On a
 *      miss, downloads the matching GitHub release tarball and
 *      extracts it here. `<dataDir>` is OPENSHIP_DATA_DIR or
 *      ~/.openship.
 *
 * If all three slots fail, throws OpenshipReleaseDistMissingError so
 * the controller can surface a clean 412 (precondition failed) to the
 * wizard instead of an opaque 500. The download error (if any) is
 * attached as the `cause` so the operator sees both the network
 * failure and the env-override escape hatch.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAndExtractRelease } from "./lib/release-download";

const __dirname = (() => {
  try {
    return resolve(fileURLToPath(import.meta.url), "..");
  } catch {
    // CJS fallback (tests, scripts) — walk back up from cwd.
    return resolve(process.cwd(), "apps/api/src/modules/system/migration");
  }
})();

/** apps/api/ directory — used for repo-local dist + package.json read. */
const API_ROOT = resolve(__dirname, "../../../..");

/** GitHub repo for release downloads. */
const RELEASE_REPO = "oblien/openship";

/**
 * Read the API's own version from package.json. Embedded at first call
 * and cached. Tsup bundles wouldn't include package.json next to the
 * output, so the dev path reads from the source tree; in a bundled
 * dist this only matters if the binary is run before being installed
 * via the release flow, which already has its own version baked in.
 */
let cachedVersion: string | undefined;
function readApiVersion(): string {
  if (cachedVersion) return cachedVersion;
  const pkgPath = join(API_ROOT, "package.json");
  try {
    const raw = readFileSync(pkgPath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.length > 0) {
      cachedVersion = parsed.version;
      return cachedVersion;
    }
    throw new Error(`package.json at ${pkgPath} has no version field`);
  } catch (err) {
    throw new Error(
      `Cannot read Openship API version from ${pkgPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/** Root for downloaded release caches. */
function computeDataDir(): string {
  return process.env.OPENSHIP_DATA_DIR ?? join(homedir(), ".openship");
}

/** apps/api/src/modules/system/migration/ → up to apps/api/release-dist/ */
function computeRepoLocalDistPath(): string {
  return join(API_ROOT, "release-dist");
}

export class OpenshipReleaseDistMissingError extends Error {
  readonly code = "OPENSHIP_RELEASE_DIST_MISSING" as const;
  constructor(distPath: string, options?: { cause?: unknown }) {
    super(
      `Openship release dist not found at ${distPath}. ` +
        `Build it first with \`bun run --cwd apps/api build-release\`, ` +
        `or set OPENSHIP_RELEASE_DIST_PATH to point at an existing bundle.`,
      options,
    );
    this.name = "OpenshipReleaseDistMissingError";
  }
}

/**
 * Locate the release dist using the three-slot resolution order
 * (env override → repo-local dev path → cached download). Throws a
 * typed error if all slots fail.
 *
 * Note: async because the cache-miss path performs a network download.
 * The env-override and repo-local-hit branches are still effectively
 * synchronous (they return on the same microtask tick).
 */
export async function resolveOpenshipDistDir(): Promise<string> {
  // Slot 1: explicit env override.
  const override = process.env.OPENSHIP_RELEASE_DIST_PATH;
  if (override) {
    const resolved = resolve(override);
    if (existsSync(resolved)) return resolved;
    throw new OpenshipReleaseDistMissingError(resolved);
  }

  // Slot 2: repo-local dev path.
  const repoLocal = computeRepoLocalDistPath();
  if (existsSync(repoLocal)) return repoLocal;

  // Slot 3: <dataDir>/openship-dist/v<version>/ — download on miss.
  const version = readApiVersion();
  const tag = `v${version}`;
  const cacheDir = join(computeDataDir(), "openship-dist");
  const cachedTarget = join(cacheDir, tag);
  if (existsSync(cachedTarget)) return cachedTarget;

  try {
    const result = await fetchAndExtractRelease({
      repo: RELEASE_REPO,
      asset: `openship-${tag}-linux-amd64.tar.gz`,
      tag,
      cacheDir,
    });
    return result.path;
  } catch (err) {
    throw new OpenshipReleaseDistMissingError(cachedTarget, { cause: err });
  }
}

/**
 * Non-throwing variant for the preflight endpoint — used to surface
 * "release dist missing" as a structured precondition the operator
 * can fix before clicking Deploy. Returns null when missing.
 *
 * Only checks the env override and the repo-local dev path so the
 * preflight stays fast and side-effect-free. The cache directory is
 * intentionally skipped: a cache-miss check would trigger a network
 * download, which is the wizard's job, not preflight's.
 */
export function resolveOpenshipDistDirOrNull(): string | null {
  const override = process.env.OPENSHIP_RELEASE_DIST_PATH;
  if (override) {
    const resolved = resolve(override);
    return existsSync(resolved) ? resolved : null;
  }

  const repoLocal = computeRepoLocalDistPath();
  if (existsSync(repoLocal)) return repoLocal;

  // Check whether the cached version is already extracted; if so,
  // surface it. Don't trigger a download.
  try {
    const version = readApiVersion();
    const cached = join(computeDataDir(), "openship-dist", `v${version}`);
    return existsSync(cached) ? cached : null;
  } catch {
    return null;
  }
}
