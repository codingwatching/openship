import { serve } from "@hono/node-server";
import { app } from "./app";
import { env } from "./config/env";

const port = env.PORT;

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`🚀 Openship API running on http://localhost:${info.port}`);
});

// WebSocket support is only needed for the interactive terminal, which
// is a self-hosted feature. Cloud-mode boots never load lib/ws or its
// @hono/node-ws dependency — keeps the cloud runtime lean.
if (!env.CLOUD_MODE) {
  const { injectWebSocket } = await import("./lib/ws");
  injectWebSocket(server);
}
