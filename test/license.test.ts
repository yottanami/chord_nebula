import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadAppPureLogic } from "./support/loadApp";

interface App {
  isLevelAllowed(level: number, unlocked: boolean): boolean;
  verifyLicenseToken(token: string): Promise<boolean>;
  isUnlocked(): Promise<boolean>;
  unlockWithLicenseKey(licenseKey: string): Promise<{ ok: boolean; error?: string }>;
  UNLOCK_PUBLIC_KEY_JWK: JsonWebKey;
  FREE_LEVEL_MAX: number;
  UNLOCK_TOKEN_STORAGE_KEY: string;
  crypto: Crypto;
  atob: typeof atob;
  btoa: typeof btoa;
  TextDecoder: typeof TextDecoder;
  localStorage: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void };
  fetch: typeof fetch;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signToken(privateKey: CryptoKey, payload: unknown): Promise<string> {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const signature = await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, payloadBytes);
  return `${toBase64Url(payloadBytes)}.${toBase64Url(new Uint8Array(signature))}`;
}

function createFakeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

function loadApp(): App {
  const app = loadAppPureLogic() as unknown as App;
  // The vm sandbox starts completely empty -- none of these are inherited
  // from the outer Node process, even though Node itself has all of them.
  app.crypto = webcrypto as unknown as Crypto;
  app.atob = atob;
  app.btoa = btoa;
  app.TextDecoder = TextDecoder;
  app.localStorage = createFakeLocalStorage();
  return app;
}

let keyPair: CryptoKeyPair;
let otherKeyPair: CryptoKeyPair;

beforeEach(async () => {
  keyPair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  otherKeyPair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
});

describe("isLevelAllowed", () => {
  it("always allows levels 1-3, locked or not", () => {
    const app = loadApp();
    expect(app.isLevelAllowed(1, false)).toBe(true);
    expect(app.isLevelAllowed(3, false)).toBe(true);
    expect(app.isLevelAllowed(1, true)).toBe(true);
  });

  it("blocks levels 4-8 when locked", () => {
    const app = loadApp();
    expect(app.isLevelAllowed(4, false)).toBe(false);
    expect(app.isLevelAllowed(8, false)).toBe(false);
  });

  it("allows levels 4-8 when unlocked", () => {
    const app = loadApp();
    expect(app.isLevelAllowed(4, true)).toBe(true);
    expect(app.isLevelAllowed(8, true)).toBe(true);
  });
});

describe("verifyLicenseToken", () => {
  it("accepts a token validly signed by the configured public key", async () => {
    const app = loadApp();
    app.UNLOCK_PUBLIC_KEY_JWK = await webcrypto.subtle.exportKey("jwk", keyPair.publicKey);
    const token = await signToken(keyPair.privateKey, { unlocked: true, iat: Date.now() });

    expect(await app.verifyLicenseToken(token)).toBe(true);
  });

  it("rejects a token signed by a different key pair", async () => {
    const app = loadApp();
    app.UNLOCK_PUBLIC_KEY_JWK = await webcrypto.subtle.exportKey("jwk", keyPair.publicKey);
    // Signed with otherKeyPair's private key, but the app only trusts keyPair's public key.
    const token = await signToken(otherKeyPair.privateKey, { unlocked: true, iat: Date.now() });

    expect(await app.verifyLicenseToken(token)).toBe(false);
  });

  it("rejects a token whose payload was tampered with after signing", async () => {
    const app = loadApp();
    app.UNLOCK_PUBLIC_KEY_JWK = await webcrypto.subtle.exportKey("jwk", keyPair.publicKey);
    const token = await signToken(keyPair.privateKey, { unlocked: true, iat: Date.now() });
    const [, signaturePart] = token.split(".");
    const tamperedPayload = toBase64Url(new TextEncoder().encode(JSON.stringify({ unlocked: true, iat: 0 })));
    const tampered = `${tamperedPayload}.${signaturePart}`;

    expect(await app.verifyLicenseToken(tampered)).toBe(false);
  });

  it("rejects a validly-signed token that doesn't actually claim unlocked:true", async () => {
    const app = loadApp();
    app.UNLOCK_PUBLIC_KEY_JWK = await webcrypto.subtle.exportKey("jwk", keyPair.publicKey);
    const token = await signToken(keyPair.privateKey, { unlocked: false, iat: Date.now() });

    expect(await app.verifyLicenseToken(token)).toBe(false);
  });

  it("rejects a malformed token", async () => {
    const app = loadApp();
    app.UNLOCK_PUBLIC_KEY_JWK = await webcrypto.subtle.exportKey("jwk", keyPair.publicKey);

    expect(await app.verifyLicenseToken("not-a-real-token")).toBe(false);
    expect(await app.verifyLicenseToken("")).toBe(false);
  });
});

describe("isUnlocked", () => {
  it("is false when nothing is stored", async () => {
    const app = loadApp();
    app.UNLOCK_PUBLIC_KEY_JWK = await webcrypto.subtle.exportKey("jwk", keyPair.publicKey);

    expect(await app.isUnlocked()).toBe(false);
  });

  it("is true when a validly-signed token is stored", async () => {
    const app = loadApp();
    app.UNLOCK_PUBLIC_KEY_JWK = await webcrypto.subtle.exportKey("jwk", keyPair.publicKey);
    const token = await signToken(keyPair.privateKey, { unlocked: true, iat: Date.now() });
    app.localStorage.setItem(app.UNLOCK_TOKEN_STORAGE_KEY, token);

    expect(await app.isUnlocked()).toBe(true);
  });

  it("is false when the stored token doesn't verify", async () => {
    const app = loadApp();
    app.UNLOCK_PUBLIC_KEY_JWK = await webcrypto.subtle.exportKey("jwk", keyPair.publicKey);
    app.localStorage.setItem(app.UNLOCK_TOKEN_STORAGE_KEY, "garbage-token");

    expect(await app.isUnlocked()).toBe(false);
  });
});

describe("unlockWithLicenseKey", () => {
  it("stores the returned token and reports success on a valid key", async () => {
    const app = loadApp();
    const token = "fake.token";
    app.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token }),
    }) as unknown as typeof fetch;

    const result = await app.unlockWithLicenseKey("ABCD-1234");

    expect(result.ok).toBe(true);
    expect(app.localStorage.getItem(app.UNLOCK_TOKEN_STORAGE_KEY)).toBe(token);
  });

  it("reports the server's error and doesn't store anything on an invalid key", async () => {
    const app = loadApp();
    app.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "That license key isn't valid for Chord Nebula." }),
    }) as unknown as typeof fetch;

    const result = await app.unlockWithLicenseKey("WRONG-KEY");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/isn't valid/);
    expect(app.localStorage.getItem(app.UNLOCK_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("reports a network error without throwing", async () => {
    const app = loadApp();
    app.fetch = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;

    const result = await app.unlockWithLicenseKey("ABCD-1234");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/network/i);
  });
});
