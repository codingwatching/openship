import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/ui/PageContainer";

/**
 * 404 for authenticated in-dashboard misses (e.g. a bad `notFound()` route).
 * Renders inside (dashboard)/layout.tsx, so it keeps the real sidebar chrome —
 * the body just fills the content area. Arbitrary unmatched URLs still hit the
 * global app/not-found.tsx (branded, no sidebar).
 */
export default function DashboardNotFound() {
  return (
    <PageContainer>
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">Page not found</h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          This page doesn&apos;t exist. Check the URL, or head back to your dashboard.
        </p>
        <Button asChild className="mt-6">
          <Link href="/">Back to dashboard</Link>
        </Button>
      </div>
    </PageContainer>
  );
}
