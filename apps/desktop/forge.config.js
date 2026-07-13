// @ts-check
const { execFileSync } = require("node:child_process");
const { chmodSync, existsSync } = require("node:fs");
const path = require("node:path");

const ICON_BASE = path.join(__dirname, "assets/icon"); // packager appends .icns/.ico
const RESOURCES = path.join(__dirname, "resources");

// Code signing is opt-in: only wire osxSign/osxNotarize when the Apple creds
// are present in the environment (CI secrets). Unset → an unsigned build.
const APPLE_IDENTITY = process.env.APPLE_IDENTITY;
const osxSigning = APPLE_IDENTITY
  ? {
      osxSign: { identity: APPLE_IDENTITY },
      ...(process.env.APPLE_ID
        ? {
            osxNotarize: {
              appleId: process.env.APPLE_ID,
              appleIdPassword: process.env.APPLE_PASSWORD,
              teamId: process.env.APPLE_TEAM_ID,
            },
          }
        : {}),
    }
  : {};

module.exports = {
  packagerConfig: {
    name: "Openship",
    executableName: "openship",
    icon: ICON_BASE,
    asar: true,
    // The main/preload are bundled (build/bundle.mjs) into self-contained files,
    // so the app has no runtime node_modules. Skip the dependency prune (which
    // flora-colossus can't walk against bun's store layout) and ship only the
    // bundled `out/` + package.json. The API + dashboard ride along via
    // extraResource below.
    prune: false,
    ignore: (p) => {
      if (!p) return false; // keep the app root
      const rel = p.startsWith("/") ? p.slice(1) : p;
      // Ship only the bundled app (dist/) + its manifest. `out/` is forge's own
      // output dir and is excluded by packager automatically.
      return !(rel === "package.json" || rel === "dist" || rel.startsWith("dist/"));
    },
    // Bundled payload built by build/stage.ts. These are the ONLY things that
    // make the app self-contained; no source is copied.
    extraResource: [
      path.join(RESOURCES, "bin"),
      path.join(RESOURCES, "dashboard"),
      path.join(RESOURCES, "migrations"),
      path.join(RESOURCES, "pglite"),
    ],
    ...osxSigning,
  },

  hooks: {
    // Build + stage the self-contained payload (API binary, dashboard
    // standalone, migrations, pglite assets) before packaging. Runs for both
    // `package` and `make`. Requires bun on PATH.
    generateAssets: async (_forgeConfig, _platform, _arch) => {
      execFileSync("bun", ["run", path.join(__dirname, "build/stage.ts")], {
        cwd: __dirname,
        stdio: "inherit",
      });
    },

    // The compiled API is an executable data file — make sure the exec bit
    // survives packaging on macOS/Linux (Windows doesn't use it).
    postPackage: async (_forgeConfig, options) => {
      if (process.platform === "win32") return;
      for (const out of options.outputPaths) {
        for (const rel of [
          "Openship.app/Contents/Resources/bin/openship-api", // macOS
          "resources/bin/openship-api", // linux
        ]) {
          const p = path.join(out, rel);
          if (existsSync(p)) chmodSync(p, 0o755);
        }
      }
    },

    // Build the macOS .dmg with hdiutil instead of @electron-forge/maker-dmg.
    // maker-dmg pulls in appdmg -> macos-alias, a native (node-gyp) module bun
    // doesn't build on CI's cold cache, which broke the dmg step. hdiutil ships
    // with macOS and needs no node deps. Output lands in out/make/ so the
    // release workflow's `find -name *.dmg` still picks it up.
    postMake: async (_forgeConfig, makeResults) => {
      if (process.platform !== "darwin") return makeResults;
      const arch = process.arch; // each runner packages its own native arch
      const appPath = path.join(__dirname, "out", `Openship-darwin-${arch}`, "Openship.app");
      if (!existsSync(appPath)) {
        throw new Error(`postMake: expected packaged app at ${appPath}`);
      }
      const dmgPath = path.join(__dirname, "out", "make", `Openship-${arch}.dmg`);
      const staging = path.join(__dirname, "out", `dmg-staging-${arch}`);
      execFileSync("rm", ["-rf", staging, dmgPath]);
      execFileSync("mkdir", ["-p", staging]);
      execFileSync("cp", ["-R", appPath, path.join(staging, "Openship.app")]);
      execFileSync("ln", ["-s", "/Applications", path.join(staging, "Applications")]);
      execFileSync(
        "hdiutil",
        ["create", "-volname", "Openship", "-srcfolder", staging, "-ov", "-format", "UDZO", dmgPath],
        { stdio: "inherit" },
      );
      execFileSync("rm", ["-rf", staging]);
      return makeResults;
    },
  },

  makers: [
    {
      name: "@reforged/maker-appimage",
      config: { options: { bin: "openship", icon: `${ICON_BASE}.png` } },
      platforms: ["linux"],
    },
    {
      // Windows ships as a zip. The Squirrel maker's bundled .exe tools
      // (Update.exe et al.) aren't found under bun's symlinked node_modules,
      // so releasify dies with "cannot find the file specified". A zip needs
      // no native tooling and builds reliably on the runner.
      name: "@electron-forge/maker-zip",
      platforms: ["darwin", "linux", "win32"],
    },
  ],
};
