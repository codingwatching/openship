/**
 * @module clone-auth
 *
 * Single source of truth for git clone credential resolution.
 *
 * The deploy pipeline asks ONE question - "what token should we use to clone
 * this repo for this deployment?" - and expects one answer back. This module
 * is that answer. Everywhere else in the codebase that needs a clone token
 * goes through `resolveCloneToken()` here; the priority chain lives in one
 * function so policy changes don't drift across call sites.
 *
 * ─── Resolution chain (highest priority first) ─────────────────────────────
 *
 *   1. **Project token**     - `project.clone_token_encrypted`
 *                              Per-project override. Highest priority because
 *                              the user explicitly scoped a credential to this
 *                              project (Fine-Grained PAT for one repo, etc).
 *
 *   2. **User global token** - `user_settings.clone_token_encrypted`
 *                              ONLY when `clone_token_as_default = true`.
 *                              Users who set a global PAT but didn't tick
 *                              "use as default" can still hit the App
 *                              installation path; the flag exists so a stored
 *                              token doesn't silently shadow the App.
 *
 *   3. **App installation**  - short-lived, repo-scoped GitHub App token.
 *                              Only attempted when the API runs in `app`
 *                              auth mode AND the owner has an installation.
 *
 *   4. **Mode default**      - the existing `resolveToken` chain
 *                              (OAuth / gh CLI / static PAT). Used when no
 *                              App is configured.
 *
 *   5. **null**              - caller is expected to throw an actionable
 *                              error. We don't throw here because preflight
 *                              already validates required tokens upstream.
 *
 * The function returns both the token AND a `source` tag indicating where
 * it came from, so callers (logging, debugging, audit trails) can see which
 * step in the chain matched.
 */

import { repos } from "@repo/db";
import { AppError, type BuildStrategy } from "@repo/core";
import { decrypt } from "../../lib/encryption";
import {
  getInstallationToken,
  resolveGitHubAuthMode,
  resolveToken,
} from "./github.auth";

export type CloneTokenSource =
  | "project"
  | "user-global"
  | "app-installation"
  | "mode-default"
  | "none";

export interface CloneTokenResult {
  token: string | null;
  source: CloneTokenSource;
}

export interface ResolveCloneTokenOpts {
  /** Project ID - used to look up per-project override. */
  projectId: string;
  /** User ID - used for App installation lookup and user_settings read. */
  userId: string;
  /** Git owner (org/user). Required for App installation token resolution. */
  owner?: string | null;
}

/**
 * Resolve the clone token for a project's deployment.
 *
 * Side-effect free - only DB reads + decrypt. Idempotent. Safe to call
 * multiple times during a deploy without consequence (no token rotation
 * happens here).
 *
 * The result's `token` is `null` ONLY when every step of the chain returned
 * nothing. Callers should treat that as "no credential available" and throw
 * an actionable error (which preflight should have caught earlier).
 */
export async function resolveCloneToken(
  opts: ResolveCloneTokenOpts,
): Promise<CloneTokenResult> {
  // ── Step 1: per-project override ───────────────────────────────────────
  const projectToken = await readProjectToken(opts.projectId);
  if (projectToken) {
    return { token: projectToken, source: "project" };
  }

  // ── Step 2: user-global token (only when marked as default) ────────────
  const userToken = await readUserGlobalToken(opts.userId);
  if (userToken) {
    return { token: userToken, source: "user-global" };
  }

  // ── Step 3: GitHub App installation token (App-scoped modes) ───────────
  // "app" = local-signed (cloud-mode SaaS holds the App key)
  // "cloud-app" = cloud-minted (self-hosted proxies through openship.io)
  // In both, getInstallationToken returns a short-lived, repo-scoped token.
  const mode = await resolveGitHubAuthMode(opts.userId);
  if ((mode === "app" || mode === "cloud-app") && opts.owner) {
    const installationToken = await getInstallationToken(opts.userId, opts.owner).catch(
      () => null,
    );
    if (installationToken) {
      return { token: installationToken, source: "app-installation" };
    }
  }

  // ── Step 4: mode default (OAuth / gh CLI / static PAT) ─────────────────
  const modeDefault = await resolveToken({
    userId: opts.userId,
    owner: opts.owner ?? undefined,
  }).catch(() => null);
  if (modeDefault) {
    return { token: modeDefault, source: "mode-default" };
  }

  // ── Step 5: nothing matched ────────────────────────────────────────────
  return { token: null, source: "none" };
}

/**
 * Resolve a git credential for use during clone, enforcing the remote-build
 * safety policy on top of `resolveCloneToken`.
 *
 * - **`buildStrategy="local"`** - token never leaves the API process. Any
 *   source in the chain is safe; we just unwrap and return.
 *
 * - **`buildStrategy="server"`** - token gets shipped to a remote worker.
 *   In App mode (SaaS) we ENFORCE that the resolved credential came from a
 *   user-supplied token (project / global) or a short-lived App installation
 *   token - any fallback to broad OAuth is rejected with 403 because that
 *   token would otherwise leak downstream. Non-App modes preserve current
 *   behavior; the preflight check already warns operators about the trade-off.
 *
 * Lives next to `resolveCloneToken` (rather than in build.service.ts) because
 * it's pure github-auth policy - the build engine just calls this and either
 * gets a token or a 403.
 */
export async function resolveBuildGitToken(opts: {
  userId: string;
  projectId: string;
  owner?: string | null;
  buildStrategy: BuildStrategy;
}): Promise<string | null> {
  const owner = opts.owner ?? undefined;
  const mode = await resolveGitHubAuthMode(opts.userId);

  const result = await resolveCloneToken({
    projectId: opts.projectId,
    userId: opts.userId,
    owner,
  });

  if (opts.buildStrategy === "local") {
    return result.token;
  }

  // App-scoped modes (local-signed or cloud-proxied) BOTH need to reject
  // any broad-OAuth fallback for remote builds — that token would ride
  // off to a worker and leak full repo-list scope. Only short-lived
  // install tokens or user-supplied PATs are safe to ship.
  if (mode === "app" || mode === "cloud-app") {
    if (
      result.source === "project" ||
      result.source === "user-global" ||
      result.source === "app-installation"
    ) {
      return result.token;
    }
    if (!owner) {
      throw new AppError(
        "Cannot resolve a clone token without a repository owner.",
        403,
        "GITHUB_APP_OWNER_REQUIRED",
      );
    }
    throw new AppError(
      `Cannot access ${owner} with the GitHub App. Install or reconnect the GitHub App for this owner, or set a clone token in project / settings, then deploy again.`,
      403,
      "GITHUB_APP_INSTALLATION_REQUIRED",
    );
  }

  return result.token;
}

/**
 * Read the per-project clone token. Decrypts on demand; never caches plaintext.
 * Returns null when there's no project, no token set, or decrypt fails.
 */
async function readProjectToken(projectId: string): Promise<string | null> {
  const project = await repos.project.findById(projectId).catch(() => null);
  if (!project?.cloneTokenEncrypted) return null;
  try {
    return decrypt(project.cloneTokenEncrypted);
  } catch {
    return null;
  }
}

/**
 * Read the user-global clone token. Honors the `cloneTokenAsDefault` flag:
 * a token that's set but not marked as default is silently skipped (the
 * App installation path takes over). Decrypts on demand; never caches.
 */
async function readUserGlobalToken(userId: string): Promise<string | null> {
  const settings = await repos.settings.findByUser(userId).catch(() => null);
  if (!settings?.cloneTokenEncrypted) return null;
  if (!settings.cloneTokenAsDefault) return null;
  try {
    return decrypt(settings.cloneTokenEncrypted);
  } catch {
    return null;
  }
}
