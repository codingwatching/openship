import { describe, expect, it, vi } from "vitest";

// Skip the full zod-validated env (which refuses to load outside desktop mode
// without INTERNAL_TOKEN); the crypto helpers only need BETTER_AUTH_SECRET.
vi.mock("../../src/config/env", () => ({
  env: { BETTER_AUTH_SECRET: "test-secret-for-data-transfer-unit-tests" },
}));

import { encrypt, decrypt } from "../../src/lib/encryption";
import { encryptSecretField, decryptSecretField } from "../../src/lib/credential-encryption";
import {
  sealSecretBundle,
  openSecretBundle,
  WrongPassphraseError,
} from "../../src/modules/system/data-transfer/passphrase-crypto";
import { extractPlaintext, sealForInstance } from "../../src/modules/system/data-transfer/secret-codec";
import type { SecretColumn } from "../../src/modules/system/data-transfer/secret-registry";
import type { SecretBundle } from "../../src/modules/system/data-transfer/types";

// The codec only reads scheme/secretPaths/sqlName/column, so a minimal cast is
// enough to exercise it without touching the DB-backed registry.
function spec(scheme: SecretColumn["scheme"], column: string, secretPaths?: string[]): SecretColumn {
  return { sqlName: "t", table: {} as never, pk: {} as never, column, scheme, secretPaths } as SecretColumn;
}

describe("passphrase-crypto", () => {
  const bundle: SecretBundle = {
    version: 1,
    entries: [{ table: "env_var", id: "env_1", column: "value", scheme: "scalar", value: "top-secret" }],
  };

  it("round-trips with the correct passphrase", () => {
    const sealed = sealSecretBundle(bundle, "correct horse");
    expect(openSecretBundle(sealed, "correct horse")).toEqual(bundle);
  });

  it("does not leak plaintext into the sealed output", () => {
    const sealed = sealSecretBundle(bundle, "correct horse");
    expect(JSON.stringify(sealed)).not.toContain("top-secret");
  });

  it("rejects a wrong passphrase", () => {
    const sealed = sealSecretBundle(bundle, "correct horse");
    expect(() => openSecretBundle(sealed, "wrong")).toThrow(WrongPassphraseError);
  });
});

describe("secret-codec round-trips (extract → seal → decrypt)", () => {
  it("scalar", () => {
    const stored = encrypt("db-url");
    const entry = extractPlaintext(spec("scalar", "value"), "id1", stored);
    expect(entry?.value).toBe("db-url");
    const sealedCell = sealForInstance(spec("scalar", "value"), entry!) as string;
    expect(decrypt(sealedCell)).toBe("db-url");
  });

  it("enc1 (ssh credential envelope)", () => {
    const stored = encryptSecretField("hunter2");
    const entry = extractPlaintext(spec("enc1", "sshPassword"), "id1", stored);
    expect(entry?.value).toBe("hunter2");
    const sealedCell = sealForInstance(spec("enc1", "sshPassword"), entry!) as string;
    expect(decryptSecretField(sealedCell)).toBe("hunter2");
  });

  it("plaintext (tunnelToken)", () => {
    const entry = extractPlaintext(spec("plaintext", "tunnelToken"), "id1", "raw-token");
    expect(entry?.value).toBe("raw-token");
    expect(sealForInstance(spec("plaintext", "tunnelToken"), entry!)).toBe("raw-token");
  });

  it("map (deployment.envVars)", () => {
    const stored = { A: encrypt("1"), B: encrypt("2") };
    const entry = extractPlaintext(spec("map", "envVars"), "id1", stored);
    expect(entry?.map).toEqual({ A: "1", B: "2" });
    const sealedCell = sealForInstance(spec("map", "envVars"), entry!) as Record<string, string>;
    expect(decrypt(sealedCell.A)).toBe("1");
    expect(decrypt(sealedCell.B)).toBe("2");
  });

  it("notification-config: secret sub-fields travel, plaintext fields preserved", () => {
    const s = spec("notification-config", "config", ["hmacSecret", "webhookUrl"]);
    const stored = { url: "https://hook", channelName: "ops", hmacSecret: encrypt("sig") };
    const entry = extractPlaintext(s, "id1", stored);
    expect(entry?.config).toEqual({ hmacSecret: "sig" });

    // Re-hydration merges the secret back into the restored (scrubbed) config.
    const restored = { url: "https://hook", channelName: "ops" };
    const sealedCell = sealForInstance(s, entry!, restored) as Record<string, unknown>;
    expect(sealedCell.url).toBe("https://hook");
    expect(sealedCell.channelName).toBe("ops");
    expect(decrypt(sealedCell.hmacSecret as string)).toBe("sig");
  });

  it("returns null for empty/absent cells", () => {
    expect(extractPlaintext(spec("scalar", "value"), "id1", null)).toBeNull();
    expect(extractPlaintext(spec("scalar", "value"), "id1", "")).toBeNull();
  });
});
