import { Hono } from "hono";
import { rateLimiter } from "../../middleware/rate-limiter";
import { cloudSessionAuth } from "./cloud-session-auth";
import * as saas from "./cloud-saas.controller";

/** SaaS-only cloud routes. */
export const cloudSaasRoutes = new Hono();

cloudSaasRoutes.get("/desktop-handoff", saas.desktopHandoff);
cloudSaasRoutes.get("/connect-handoff", saas.connectHandoff);
cloudSaasRoutes.use("/exchange-code", rateLimiter);
cloudSaasRoutes.post("/exchange-code", saas.exchangeCode);

cloudSaasRoutes.use("/token", cloudSessionAuth);
cloudSaasRoutes.post("/token", saas.getToken);

cloudSaasRoutes.use("/account", cloudSessionAuth);
cloudSaasRoutes.get("/account", saas.account);

cloudSaasRoutes.use("/preflight", cloudSessionAuth);
cloudSaasRoutes.post("/preflight", saas.preflight);

cloudSaasRoutes.use("/edge-proxy", cloudSessionAuth);
cloudSaasRoutes.post("/edge-proxy", saas.syncEdgeProxy);

cloudSaasRoutes.use("/analytics", cloudSessionAuth);
cloudSaasRoutes.post("/analytics", saas.analyticsProxy);

cloudSaasRoutes.use("/pages", cloudSessionAuth);
cloudSaasRoutes.post("/pages", saas.pagesProxy);

// ─── GitHub App proxy (cloud holds the App private key) ───────────────────
// All endpoints below are what self-hosted instances call via cloud-client.
// Cloud signs JWTs / mints install tokens; local never holds App creds.
cloudSaasRoutes.use("/github/*", cloudSessionAuth);
cloudSaasRoutes.post("/github/install-url", saas.githubInstallUrl);
cloudSaasRoutes.post("/github/exchange-code", saas.githubExchangeCode);
cloudSaasRoutes.get("/github/installations", saas.githubInstallations);
cloudSaasRoutes.post("/github/installation-token", saas.githubInstallationToken);
cloudSaasRoutes.get("/github/user-status", saas.githubUserStatus);