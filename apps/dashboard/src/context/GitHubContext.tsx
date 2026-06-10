"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { githubApi } from "@/lib/api";
import { endpoints } from "@/lib/api/endpoints";
import { getApiBaseUrl } from "@/lib/api/client";
import { openAuthWindow } from "@/utils/authWindow";
import { usePlatform } from "@/context/PlatformContext";

/* ── Types ────────────────────────────────────────────────────────── */

export interface GitHubAccount {
  login: string;
  avatar_url: string;
  type: "User" | "Organization";
  name?: string;
}

export interface GitHubRepo {
  id: number;
  full_name: string;
  name: string;
  description: string;
  private: boolean;
  stars: number;
  stargazers_count?: number;
  forks: number;
  forks_count?: number;
  language: string;
  updated_at: string;
  default_branch: string;
  owner: { login: string; avatar_url: string } | string;
  html_url?: string;
}

export type GitHubMode = "cloud" | "desktop" | "cli" | "token";

/**
 * Per-source snapshot from the API. Only populated in cli mode. Lets the
 * settings UI render the Openship App and gh CLI panels independently with
 * their own connect/disconnect buttons.
 */
export interface GitHubSources {
  oauth: { connected: boolean; login?: string; avatarUrl?: string };
  cli: { available: boolean; suppressed: boolean; login?: string; avatarUrl?: string };
  active: "oauth" | "cli" | null;
}

interface GitHubContextValue {
  /* Connection */
  connected: boolean;
  connecting: boolean;
  loading: boolean;
  mode: GitHubMode;
  sources: GitHubSources | null;
  /**
   * Initiate a GitHub connection. `source` discriminates which dual-source
   * card was clicked in cli mode — "oauth" forces the Openship App install
   * flow even when gh CLI is already authenticated. Omit on legacy modes.
   */
  connect: (source?: "oauth" | "cli") => Promise<void>;
  disconnect: (source?: "oauth" | "cli" | "all") => Promise<void>;

  /* CLI / Device flow */
  cliAction: CliAction | null;

  /* Data */
  accounts: GitHubAccount[];
  userLogin: string;
  selectedOwner: string;
  setSelectedOwner: (owner: string) => void;
  repos: GitHubRepo[];
  loadingRepos: boolean;

  /* Actions */
  refresh: () => Promise<void>;
  fetchReposForOwner: (owner: string) => Promise<void>;

  /* App mode */
  installUrl: string | null;
}

export type CliAction =
  | { type: "terminal"; command: string; message: string }
  | { type: "device_flow"; userCode: string; verificationUri: string; expiresIn: number; interval: number };

const GitHubContext = createContext<GitHubContextValue | undefined>(undefined);

export function useGitHub() {
  const ctx = useContext(GitHubContext);
  if (!ctx) throw new Error("useGitHub must be used within GitHubProvider");
  return ctx;
}

/* ── Provider ─────────────────────────────────────────────────────── */

interface GitHubProviderProps {
  children: React.ReactNode;
  initialData?: any;
}

export function GitHubProvider({ children, initialData }: GitHubProviderProps) {
  const { setSelfHosted } = usePlatform();
  const [connected, setConnected] = useState(!!initialData?.status?.connected);
  const [connecting, setConnecting] = useState(false);
  const [loading, setLoading] = useState(!initialData);
  
  // Resolve the initial mode correctly.
  // - "app"       (cloud-mode SaaS holds App creds)        → "cloud"
  // - "cloud-app" (self-hosted proxies through openship.io) → "cloud"
  //   Same UX: managed by Openship Cloud, installations list, install URL.
  //   The distinction matters server-side (where the JWT gets signed) but
  //   the dashboard renders identically.
  const initialMode = initialData?.mode === "app" || initialData?.mode === "cloud-app" ? "cloud" :
                      initialData?.mode === "cli" ? "cli" :
                      initialData?.mode === "token" ? "token" :
                      initialData?.mode === "oauth" ? "desktop" :
                      (initialData?.mode || "cloud");

  const [mode, setMode] = useState<GitHubMode>(initialMode as GitHubMode);
  const [sources, setSources] = useState<GitHubSources | null>(initialData?.sources ?? null);
  const [cliAction, setCliAction] = useState<CliAction | null>(null);
  const [accounts, setAccounts] = useState<GitHubAccount[]>(initialData?.accounts || []);
  const [userLogin, setUserLogin] = useState(initialData?.status?.login || "");
  const [selectedOwner, setSelectedOwnerState] = useState(initialData?.status?.login || "");
  const [repos, setRepos] = useState<GitHubRepo[]>(initialData?.repos || []);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [installUrl, setInstallUrl] = useState<string | null>(initialData?.installUrl || null);
  const initRef = useRef(false);

  /* ── Fetch connection info ──────────────────────────────────── */
  const refresh = useCallback(async () => {
    try {
      const res = await githubApi.getUserHome();
      if (res?.mode) {
        // Map backend mode to frontend mode type. "app" + "cloud-app"
        // both render as "cloud" — distinction is server-side only.
        const m = res.mode as string;
        if (m === "app" || m === "cloud-app") setMode("cloud");
        else if (m === "cli") setMode("cli");
        else if (m === "token") setMode("token");
        else if (m === "oauth") setMode("desktop");
        else setMode(m as GitHubMode);
      }
      if (res?.selfHosted !== undefined) setSelfHosted(res.selfHosted);
      if (res?.installUrl) setInstallUrl(res.installUrl);
      else setInstallUrl(null);
      setSources(res?.sources ?? null);
      if (res?.status?.connected) {
        setConnected(true);
        setCliAction(null);
        setAccounts(res.accounts ?? []);
        setUserLogin(res.status.login);
        if (!selectedOwner) setSelectedOwnerState(res.status.login);
        setRepos(res.repos ?? []);
      } else {
        setConnected(false);
        setAccounts([]);
        setRepos([]);
      }
    } catch {
      setConnected(false);
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── On mount ───────────────────────────────────────────────── */
  useEffect(() => {
    // If we have SSR initialData, don't double fetch!
    if (initialData) return;

    if (initRef.current) return;
    initRef.current = true;
    refresh();
  }, [refresh, initialData]);

  /* ── Connect GitHub ─────────────────────────────────────────── */
  const connect = useCallback(async (source?: "oauth" | "cli") => {
    setConnecting(true);
    setCliAction(null);

    const finishRedirectFlow = () => {
      setConnecting(false);
      void refresh();

      // The popup can close before cookies/DB writes are visible to the
      // dashboard request, so do a couple of quiet follow-up checks.
      window.setTimeout(() => void refresh(), 750);
      window.setTimeout(() => void refresh(), 2000);
    };

    try {
      const res = await githubApi.connect(source);

      // Already connected - just refresh
      if (res?.connected) {
        setConnecting(false);
        refresh();
        return;
      }

      switch (res?.flow) {
        case "redirect": {
          // Prefer a backend-provided URL when the next step is known
          // (for example, GitHub App installation after OAuth).
          const redirectUrl = res.url ?? `${getApiBaseUrl()}${endpoints.github.connectRedirect}`;
          const handle = openAuthWindow(redirectUrl);
          handle.onClose(finishRedirectFlow);
          return;
        }

        case "device_code":
          // Show verification code inline
          setCliAction({
            type: "device_flow",
            userCode: res.userCode,
            verificationUri: res.verificationUri,
            expiresIn: res.expiresIn,
            interval: res.interval,
          });
          setConnecting(false);
          return;

        case "terminal":
          // Show terminal instruction
          setCliAction({ type: "terminal", command: res.command, message: res.message });
          setConnecting(false);
          return;

        default:
          setConnecting(false);
      }
    } catch {
      setConnecting(false);
    }
  }, [refresh]);

  /* ── Disconnect GitHub ──────────────────────────────────────── */
  const disconnect = useCallback(
    async (source: "oauth" | "cli" | "all" = "all") => {
      try {
        await githubApi.disconnect(source);
        // In cli mode with both sources, refresh the per-source snapshot -
        // the user may still have the other source connected. In all other
        // cases this resolves to fully disconnected.
        if (mode === "cli" && source !== "all") {
          await refresh();
        } else {
          setConnected(false);
          setAccounts([]);
          setRepos([]);
          setUserLogin("");
          setSelectedOwnerState("");
          setCliAction(null);
          setSources(null);
        }
      } catch {
        /* silent */
      }
    },
    [mode, refresh],
  );

  /* ── Device flow polling ────────────────────────────────────── */
  useEffect(() => {
    if (cliAction?.type !== "device_flow") return;

    const interval = (cliAction.interval || 5) * 1000;
    const timer = setInterval(async () => {
      try {
        const res = await githubApi.pollConnect();
        if (res?.status === "complete") {
          setCliAction(null);
          refresh();
        } else if (res?.status === "error") {
          setCliAction(null);
        }
      } catch { /* keep polling */ }
    }, interval);

    return () => clearInterval(timer);
  }, [cliAction, refresh]);

  /* ── Fetch repos for an owner ───────────────────────────────── */
  const fetchReposForOwner = useCallback(
    async (owner: string) => {
      if (!owner || !connected) return;
      setLoadingRepos(true);
      try {
        // Backend is mode-aware - handles cloud (installation) vs desktop (OAuth) 
        const res = await githubApi.getUserRepos(owner);
        if (res && !res.error) {
          const list = Array.isArray(res) ? res : res.data ?? res.repos ?? [];
          setRepos(list);
        } else {
          setRepos([]);
        }
      } catch {
        setRepos([]);
      } finally {
        setLoadingRepos(false);
      }
    },
    [connected]
  );

  /* ── Owner change → fetch repos ─────────────────────────────── */
  const setSelectedOwner = useCallback(
    (owner: string) => {
      setSelectedOwnerState(owner);
      if (owner && owner !== selectedOwner) {
        fetchReposForOwner(owner);
      }
    },
    [selectedOwner, fetchReposForOwner]
  );

  return (
    <GitHubContext.Provider
      value={{
        connected,
        connecting,
        loading,
        mode,
        sources,
        connect,
        disconnect,
        cliAction,
        accounts,
        userLogin,
        selectedOwner,
        setSelectedOwner,
        repos,
        loadingRepos,
        refresh,
        fetchReposForOwner,
        installUrl,
      }}
    >
      {children}
    </GitHubContext.Provider>
  );
}
