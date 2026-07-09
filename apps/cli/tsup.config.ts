import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  // Bundle the workspace packages (@repo/core, @repo/onboarding) INTO the
  // output. They're never published to npm, so an npx-installed `openship`
  // must carry them inline — otherwise it fails with ERR_MODULE_NOT_FOUND.
  // Runtime deps (commander, chalk, ora, open) stay external and come from
  // the published package's own dependencies.
  noExternal: [/^@repo\//],
});
