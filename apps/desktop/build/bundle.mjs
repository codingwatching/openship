/**
 * Bundle the Electron main + preload into self-contained CJS files.
 *
 * This is what makes the packaged app need ZERO runtime node_modules: the two
 * workspace deps (@repo/core, @repo/onboarding) are inlined, so forge can ship
 * just `out/` + package.json and skip dependency pruning entirely (which
 * flora-colossus can't do against bun's store-based node_modules anyway).
 *
 * Dev keeps using `tsc` (unbundled) — node_modules is present there.
 */

import { build } from "esbuild";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Output to dist/, NOT out/ — `out/` is electron-forge's own output dir
// (packaged apps + installers), which packager refuses to copy into the app.
rmSync(join(ROOT, "dist"), { recursive: true, force: true });

const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  external: ["electron"], // provided by the Electron runtime
  logLevel: "info",
};

await build({
  ...common,
  entryPoints: [join(ROOT, "src/main/index.ts")],
  outfile: join(ROOT, "dist/main/index.js"),
});

await build({
  ...common,
  entryPoints: [join(ROOT, "src/preload/index.ts")],
  outfile: join(ROOT, "dist/preload/index.js"),
});
