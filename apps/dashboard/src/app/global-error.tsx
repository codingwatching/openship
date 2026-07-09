"use client";

/**
 * Root global-error boundary. Next prerenders `/_global-error` at build time;
 * its DEFAULT page crashes during static export on Next 16 ("useContext" of
 * null). Providing a minimal custom one (own <html>/<body>, no providers or
 * context) avoids that and gives a real last-resort error screen.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#ffffff",
          color: "#0f0f0f",
        }}
      >
        <div style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 8px" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, opacity: 0.7, margin: "0 0 20px" }}>
            The app hit an unexpected error. Try again, and if it keeps happening,
            restart Openship.
          </p>
          {error?.digest && (
            <p style={{ fontSize: 12, opacity: 0.4, fontFamily: "monospace", margin: "0 0 20px" }}>
              {error.digest}
            </p>
          )}
          <button
            onClick={() => reset()}
            style={{
              border: "1px solid rgba(0,0,0,0.16)",
              background: "rgba(0,0,0,0.05)",
              color: "#0f0f0f",
              borderRadius: 999,
              padding: "8px 20px",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
