import Link from "next/link";
import { Navbar, Footer } from "@/components/landing";
// apps/web has multiple root layouts (one per route group), so a global
// not-found renders WITHOUT any of them — it must supply its own document
// shell + styles, then compose the marketing chrome like the legal pages do.
import "./globals.css";

export default function NotFound() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>Page not found — Openship</title>
        <link rel="icon" href="/favicon.ico" sizes="any" />
      </head>
      <body className="min-h-screen antialiased">
        <Navbar />
        <main className="legal-root">
          <section className="legal-hero">
            <div className="legal-container" style={{ textAlign: "center" }}>
              <p className="legal-eyebrow">404</p>
              <h1 className="legal-title">
                Page not
                <br />
                <span className="legal-title-soft">found.</span>
              </h1>
              <p className="legal-meta" style={{ maxWidth: "460px", margin: "0 auto" }}>
                The page you&apos;re looking for doesn&apos;t exist or has moved.
              </p>
              <div style={{ marginTop: "32px" }}>
                <Link
                  href="/"
                  className="inline-block rounded-full px-6 py-2.5 text-[14px] font-medium transition-all"
                  style={{ background: "var(--th-btn-bg)", color: "var(--th-btn-text)" }}
                >
                  Back home
                </Link>
              </div>
            </div>
          </section>
        </main>
        <Footer />
      </body>
    </html>
  );
}
