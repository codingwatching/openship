"use client";

import { useEffect, useState } from "react";

/**
 * Frameless title bar for the Electron desktop app. Adds `is-desktop` to
 * <html> (enabling the titlebar CSS in globals.css) and renders a full-width
 * strip across the very top that is the window-drag region — so you can move
 * the window by dragging anywhere along the top, like VS Code / Spotify. No-op
 * in a normal browser (web / SaaS).
 */
export function DesktopChrome() {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const desktop = Boolean(
      (window as { desktop?: { isDesktop?: boolean } }).desktop?.isDesktop,
    );
    setIsDesktop(desktop);
    if (!desktop) return;
    const root = document.documentElement;
    root.classList.add("is-desktop");
    return () => root.classList.remove("is-desktop");
  }, []);
  if (!isDesktop) return null;
  return <div className="app-titlebar" aria-hidden />;
}
