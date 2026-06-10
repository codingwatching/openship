"use client";

import { Terminal } from "lucide-react";
import { ServerTerminalTabs } from "@/components/terminal/ServerTerminalTabs";

interface TerminalTabProps {
  serverId: string;
  serverName?: string;
  /** Drives the WS lifecycle - only open while the tab is active so we
   *  don't keep PTYs alive in the background. */
  enabled: boolean;
}

export function TerminalTab({ serverId, serverName, enabled }: TerminalTabProps) {
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-border/50 bg-card">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border/50 px-5 py-4">
          <div className="flex size-9 items-center justify-center rounded-xl bg-zinc-500/10">
            <Terminal className="size-[18px] text-zinc-500" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-semibold text-foreground">
              Terminal {serverName ? <span className="text-muted-foreground">· {serverName}</span> : null}
            </h2>
            <p className="text-xs text-muted-foreground">
              Live SSH shells over WebSocket. Up to 3 concurrent — copy on select.
            </p>
          </div>
        </div>

        {/* Multi-shell tabs surface — fixed height so xterm has something to fit
            against. Could be made resizable later. */}
        <div className="h-[60vh] min-h-[480px] w-full">
          <ServerTerminalTabs serverId={serverId} enabled={enabled} />
        </div>
      </div>
    </div>
  );
}
