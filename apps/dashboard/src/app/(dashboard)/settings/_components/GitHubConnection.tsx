"use client";

import { Github, ExternalLink, Unplug, RefreshCw, Download, Terminal, CheckCircle2, Cloud } from "lucide-react";
import { useGitHub } from "@/context/GitHubContext";
import { useCloud } from "@/context/CloudContext";
import { useModal } from "@/context/ModalContext";
import { SettingsSection } from "./SettingsSection";

export function GitHubConnection() {
  const {
    connected,
    connecting,
    loading,
    mode,
    sources,
    userLogin,
    accounts,
    connect,
    disconnect,
    installUrl,
  } = useGitHub();

  // Self-hosted needs an active Openship Cloud connection to use the
  // GitHub App at all — the App private key lives in openship.io and
  // self-hosted instances proxy through it. PAT + gh CLI escape hatches
  // don't require cloud.
  const { connected: cloudConnected, startConnect: startCloudConnect } = useCloud();

  const { showModal, hideModal } = useModal();

  const promptDisconnect = (
    source: "oauth" | "cli" | "all",
    label: string,
    body: string,
  ) => {
    const modalId = showModal({
      title: `Disconnect ${label}`,
      message: body,
      buttons: [
        { label: "Cancel", variant: "secondary", onClick: () => hideModal(modalId) },
        {
          label: "Disconnect",
          variant: "danger",
          onClick: async () => {
            hideModal(modalId);
            await disconnect(source);
          },
        },
      ],
    });
  };

  // ─── cli mode: dual-source panel ────────────────────────────────────────
  if (mode === "cli" && sources) {
    return (
      <SettingsSection
        icon={Github}
        title="GitHub"
        description="Choose how Openship authenticates with GitHub on this machine"
        iconBg="bg-foreground/5"
        iconColor="text-foreground"
      >
        <div className="space-y-3">
          {/* Openship App / OAuth */}
          <SourceCard
            heading="Openship GitHub App"
            sub={
              cloudConnected
                ? "OAuth + App installation. Recommended - supports private repos, webhooks, and short-lived install tokens."
                : "Requires Openship Cloud — the GitHub App is owned by openship.io. Connect cloud first."
            }
            connected={sources.oauth.connected}
            active={sources.active === "oauth"}
            login={sources.oauth.login}
            avatarUrl={sources.oauth.avatarUrl}
            // When NOT cloud-connected, redirect the user to "Connect
            // Openship Cloud" instead of trying to open an install URL
            // that the local instance can't actually mint tokens against.
            onConnect={cloudConnected ? () => connect("oauth") : startCloudConnect}
            connecting={connecting && !sources.oauth.connected}
            onDisconnect={() =>
              promptDisconnect(
                "oauth",
                "Openship GitHub App",
                "This removes the Openship OAuth account row. The GitHub App installation stays until you uninstall it on GitHub.",
              )
            }
            installUrl={installUrl}
            requiresCloud={!cloudConnected}
          />

          {/* Local gh CLI */}
          <SourceCard
            heading="Local gh CLI"
            sub={
              sources.cli.suppressed
                ? "Suppressed - Openship is ignoring `gh auth token` until you reconnect."
                : "Uses your machine's `gh auth login`. Quickest for desktop / self-host, no Openship App install required."
            }
            connected={sources.cli.available}
            active={sources.active === "cli"}
            login={sources.cli.login}
            avatarUrl={sources.cli.avatarUrl}
            onConnect={() => connect("cli")}
            connecting={connecting && !sources.cli.available}
            onDisconnect={() =>
              promptDisconnect(
                "cli",
                "gh CLI",
                "Openship will stop using `gh auth token` even if it's logged in. Your gh config on this machine is left untouched.",
              )
            }
            isCli
          />

          {/* Active hint */}
          {sources.active && (
            <p className="text-[11px] text-muted-foreground/70 pt-1">
              Currently using <span className="font-medium text-foreground/90">{sources.active === "oauth" ? "Openship App" : "gh CLI"}</span> for repo access and clone tokens.
            </p>
          )}
        </div>
      </SettingsSection>
    );
  }

  // ─── Other modes: single-source legacy layout ───────────────────────────
  const hasInstallations = accounts.length > 0;

  return (
    <SettingsSection
      icon={Github}
      title={connected && userLogin ? `GitHub · @${userLogin}` : "GitHub"}
      description={
        connected
          ? hasInstallations
            ? `Connected · ${accounts.length} account${accounts.length > 1 ? "s" : ""}`
            : "Connected · No installations yet"
          : "Connect your GitHub account to deploy repositories"
      }
      iconBg="bg-foreground/5"
      iconColor="text-foreground"
    >
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <div className="size-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          Checking connection…
        </div>
      ) : connected ? (
        <div className="space-y-4">
          {hasInstallations && (
            <div className="space-y-2">
              {accounts.map((acct) => (
                <div
                  key={acct.login}
                  className="flex items-center gap-3 px-3 py-2 bg-muted/30 rounded-lg border border-border/40"
                >
                  {acct.avatar_url ? (
                    <img
                      src={acct.avatar_url}
                      alt={acct.login}
                      className="size-7 rounded-full"
                    />
                  ) : (
                    <div className="size-7 rounded-full bg-muted flex items-center justify-center">
                      <Github className="size-3.5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {acct.login}
                    </p>
                  </div>
                  <span className="text-[10px] font-medium text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">
                    {acct.type === "Organization" ? "Org" : "User"}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {installUrl && (
              <a
                href={installUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-foreground bg-muted/40 hover:bg-muted/60 rounded-lg border border-border/50 transition-colors"
              >
                <Download className="size-3.5" />
                {hasInstallations ? "Add account" : "Install GitHub App"}
              </a>
            )}
            <a
              href="https://github.com/settings/installations"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted/60 rounded-lg border border-border/50 transition-colors"
            >
              Manage on GitHub
              <ExternalLink className="size-3" />
            </a>
            <button
              onClick={() =>
                promptDisconnect(
                  "all",
                  "GitHub",
                  "Are you sure you want to disconnect your GitHub account? You can reconnect anytime.",
                )
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 hover:text-red-700 bg-red-500/5 hover:bg-red-500/10 rounded-lg border border-red-500/15 hover:border-red-500/25 transition-colors"
            >
              <Unplug className="size-3.5" />
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Link your GitHub account to import repositories, enable auto-deploy
            on push, and manage branches directly from the dashboard.
          </p>
          <button
            onClick={() => connect()}
            disabled={connecting}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-foreground text-background hover:bg-foreground/90 rounded-xl transition-colors disabled:opacity-50"
          >
            {connecting ? (
              <>
                <RefreshCw className="size-4 animate-spin" />
                Connecting…
              </>
            ) : (
              <>
                <Github className="size-4" />
                Connect GitHub
              </>
            )}
          </button>
        </div>
      )}
    </SettingsSection>
  );
}

/**
 * Single source row inside the cli-mode dual panel. Keeps the layout DRY
 * for the OAuth (Openship App) and gh CLI variants - they only differ in
 * heading copy, icon, and which connect/disconnect actions fire.
 */
function SourceCard(props: {
  heading: string;
  sub: string;
  connected: boolean;
  active: boolean;
  login?: string;
  avatarUrl?: string;
  onConnect: () => void;
  connecting: boolean;
  onDisconnect: () => void;
  installUrl?: string | null;
  isCli?: boolean;
  /**
   * True when this is the Openship App card AND the user hasn't
   * connected to Openship Cloud yet. Swaps the connect button copy +
   * icon so the user understands they need cloud first, and points
   * `onConnect` at the cloud-connect flow instead of GitHub.
   */
  requiresCloud?: boolean;
}) {
  const { heading, sub, connected, active, login, avatarUrl, onConnect, connecting, onDisconnect, installUrl, isCli, requiresCloud } = props;
  return (
    <div
      className={`rounded-xl border p-3.5 transition-colors ${
        active ? "border-primary/30 bg-primary/[0.03]" : "border-border/50 bg-muted/15"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="size-9 rounded-lg bg-foreground/[0.04] border border-border/40 flex items-center justify-center shrink-0">
          {isCli ? <Terminal className="size-4 text-foreground/70" /> : <Github className="size-4 text-foreground/70" />}
        </div>
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-foreground">{heading}</p>
            {connected && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-2.5" />
                Connected
              </span>
            )}
            {active && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
                Active
              </span>
            )}
          </div>
          <p className="text-[12px] text-muted-foreground/80 leading-relaxed">{sub}</p>

          {connected && login && (
            <div className="flex items-center gap-2 mt-2 px-2.5 py-1.5 rounded-lg bg-muted/30 border border-border/40 w-fit">
              {avatarUrl ? (
                <img src={avatarUrl} alt={login} className="size-5 rounded-full" />
              ) : (
                <Github className="size-3.5 text-muted-foreground" />
              )}
              <span className="text-[12px] font-medium text-foreground">@{login}</span>
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap pt-1">
            {connected ? (
              <>
                {installUrl && (
                  <a
                    href={installUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium text-foreground bg-foreground/[0.06] hover:bg-foreground/[0.1] rounded-lg transition-colors"
                  >
                    <Download className="size-3" />
                    Manage installations
                  </a>
                )}
                <button
                  onClick={onDisconnect}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium text-red-600 hover:text-red-700 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors"
                >
                  <Unplug className="size-3" />
                  Disconnect
                </button>
              </>
            ) : (
              <button
                onClick={onConnect}
                disabled={connecting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium bg-foreground text-background hover:bg-foreground/90 rounded-lg transition-colors disabled:opacity-50"
              >
                {connecting ? (
                  <RefreshCw className="size-3 animate-spin" />
                ) : requiresCloud ? (
                  <Cloud className="size-3" />
                ) : isCli ? (
                  <Terminal className="size-3" />
                ) : (
                  <Github className="size-3" />
                )}
                {requiresCloud
                  ? "Connect Openship Cloud"
                  : isCli
                    ? "Use gh CLI"
                    : "Connect Openship App"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
