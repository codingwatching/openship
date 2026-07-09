import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider, ThemeScript } from "@/components/theme-provider";
import { ToastProvider } from "@/components/toast";
import { ToastProvider as ContextToastProvider } from "@/context/ToastContext";
import { I18nProvider } from "@/components/i18n-provider";
import { AuthProvider } from "@/context/AuthContext";
import { NetworkErrorHandler } from "@/components/network-error-handler";
import { ModalProvider } from "@/context/ModalContext";
import { DesktopChrome } from "@/components/desktop-chrome";

/**
 * Render every route on-demand, never at build time. The dashboard resolves its
 * deploy/auth mode from the API (`GET /health/env`) and reads request `headers()`
 * on render — neither is available during `next build` (the API isn't running in
 * the Docker builder), and the deploy-info resolver correctly refuses to guess.
 * Forcing dynamic here skips static prerendering app-wide so the image builds
 * without a live API; nothing in this auth-gated dashboard is statically cacheable
 * anyway. Do NOT remove — it's what lets the container build succeed.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Openship",
  description: "Manage your deployments, domains, and infrastructure.",
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
    other: [
      { url: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
  },
  manifest: '/site.webmanifest',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Desktop runs the API on a dynamic free port. Mirror the server-side
  // OPENSHIP_LOCAL_API_URL into the browser so the client bundle's API base
  // (a module-load constant that can't read a runtime env) targets it. Read
  // per-request thanks to `force-dynamic` above.
  const localApiOrigin = process.env.OPENSHIP_LOCAL_API_URL;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
        {localApiOrigin ? (
          <script
            dangerouslySetInnerHTML={{
              __html: `window.__OPENSHIP_API_ORIGIN__=${JSON.stringify(localApiOrigin)}`,
            }}
          />
        ) : null}
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>
            <I18nProvider>
              <ToastProvider>
                <ContextToastProvider>
                  <ModalProvider>
                    <DesktopChrome />
                    <NetworkErrorHandler />
                    {children}
                  </ModalProvider>
                </ContextToastProvider>
              </ToastProvider>
            </I18nProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
