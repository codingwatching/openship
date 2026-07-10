import { PACKAGE_ROOT_ONLY_EXCLUDES } from "@repo/core";

/** Names that double as real source folders — anchor them to the archive root
 *  instead of matching at any depth (see stacks.ts). */
const ROOT_ONLY_EXCLUDES = new Set<string>(PACKAGE_ROOT_ONLY_EXCLUDES);

export interface TarTransferOptions {
  excludes?: string[];
  includes?: string[];
}

export function getTarCreateEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    COPYFILE_DISABLE: "1",
    COPY_EXTENDED_ATTRIBUTES_DISABLE: "1",
  };
}

export function getTarCreateArgs(
  localPath: string,
  options?: TarTransferOptions,
): string[] {
  const args: string[] = [];

  if (process.platform === "darwin") {
    args.push("--no-mac-metadata", "--no-xattrs", "--no-acls", "--no-fflags");
  }

  args.push("-czf", "-", "-C", localPath);

  if (options?.includes?.length) {
    args.push(...options.includes);
    return args;
  }

  for (const exclude of options?.excludes ?? []) {
    // Ambiguous output names (build/dist/data) also occur as real source
    // folders. Anchor them to the archive root (`./name` — only the top-level
    // member is `./build`, never `./src/build`) so nested source isn't deleted
    // in transit. Unambiguous names (node_modules, .next, …) match at any depth.
    const pattern = ROOT_ONLY_EXCLUDES.has(exclude) ? `./${exclude}` : exclude;
    args.push(`--exclude=${pattern}`);
  }

  args.push(".");
  return args;
}