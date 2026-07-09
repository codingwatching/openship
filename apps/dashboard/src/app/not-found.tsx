import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";

/**
 * Global 404. Renders inside the root layout (Theme/i18n/Toast/Modal), so it
 * reuses the branded AuthShell chrome. The real dashboard sidebar can't be used
 * here — it needs the session-gated DashboardProviders — so authenticated
 * in-dashboard 404s get the sidebar via (dashboard)/not-found.tsx instead.
 */
export default function NotFound() {
  return (
    <AuthShell>
      <div className="text-center">
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or has moved.
        </p>
        <Button asChild className="mt-6">
          <Link href="/">Back to dashboard</Link>
        </Button>
      </div>
    </AuthShell>
  );
}
