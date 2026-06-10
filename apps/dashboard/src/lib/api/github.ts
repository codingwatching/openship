import { api } from "./client";
import { endpoints } from "./endpoints";

/* ------------------------------------------------------------------ */
/*  GitHub Integration API                                            */
/* ------------------------------------------------------------------ */

export const githubApi = {
  /** Dashboard home - user info, orgs, recent repos */
  getUserHome: () => api.get<any>(endpoints.github.userHome),

  /** Repos for a specific GitHub org */
  getOrgRepos: (owner: string) =>
    api.get<any>(endpoints.github.orgRepos(owner)),

  /** Repos for a specific GitHub user */
  getUserRepos: (owner: string) =>
    api.get<any>(endpoints.github.userRepos, { params: { owner } }),

  /** Check GitHub connection status */
  getStatus: () => api.get<any>(endpoints.github.status),

  /**
   * Start a GitHub connection. Pass `source` from the dashboard's
   * dual-source settings panel:
   *   - "oauth" → force the Openship App install flow (even if gh CLI
   *     is already authenticated). Used by the "Connect Openship App"
   *     button so it never short-circuits on a pre-existing cli token.
   *   - "cli"   → only consider the gh CLI source.
   *   - omit    → server picks based on installation auth mode.
   */
  connect: (source?: "oauth" | "cli") =>
    api.post<any>(endpoints.github.connect, source ? { source } : undefined),

  /** Poll device flow status */
  pollConnect: () => api.get<any>(endpoints.github.connectPoll),

  /**
   * Disconnect a GitHub source.
   *   - "oauth" → remove the Openship App / OAuth account row
   *   - "cli"   → suppress the gh CLI fallback (host config untouched)
   *   - "all"   → both (default - preserves the old behavior)
   */
  disconnect: (source: "oauth" | "cli" | "all" = "all") =>
    api.post<{ success: boolean; source: string }>(endpoints.github.disconnect, { source }),
};
