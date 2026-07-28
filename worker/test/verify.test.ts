import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { verifyLicense } from "../src/verify";

let privateKeyJwk: string;
let publicKey: CryptoKey;

beforeAll(async () => {
  const keyPair = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  privateKeyJwk = JSON.stringify(await webcrypto.subtle.exportKey("jwk", keyPair.privateKey));
  publicKey = await webcrypto.subtle.importKey(
    "jwk",
    await webcrypto.subtle.exportKey("jwk", keyPair.publicKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
});

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function assertValidToken(token: string): Promise<Record<string, unknown>> {
  const [payloadPart, signaturePart] = token.split(".");
  const payloadBytes = fromBase64Url(payloadPart);
  const signature = fromBase64Url(signaturePart);
  const valid = await webcrypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    signature,
    payloadBytes,
  );
  expect(valid).toBe(true);
  return JSON.parse(new TextDecoder().decode(payloadBytes));
}

function gumroadResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const env = () => ({ GUMROAD_PRODUCT_ID: "prod_123", PRIVATE_KEY_JWK: privateKeyJwk });

describe("verifyLicense", () => {
  it("rejects an empty license key without calling Gumroad", async () => {
    const fetchFn = vi.fn();
    const result = await verifyLicense("", env(), fetchFn);
    expect(result.status).toBe(400);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("sends the license key and product id to Gumroad's verify endpoint", async () => {
    const fetchFn = vi.fn().mockResolvedValue(gumroadResponse({ success: true, purchase: {} }));
    await verifyLicense("ABCD-1234", env(), fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api.gumroad.com/v2/licenses/verify");
    const body = init.body as URLSearchParams;
    expect(body.get("product_id")).toBe("prod_123");
    expect(body.get("license_key")).toBe("ABCD-1234");
  });

  it("mints a valid, verifiable token for a clean purchase", async () => {
    const fetchFn = vi.fn().mockResolvedValue(gumroadResponse({ success: true, purchase: {} }));
    const result = await verifyLicense("ABCD-1234", env(), fetchFn);

    expect(result.status).toBe(200);
    const token = (result.body as { token: string }).token;
    const payload = await assertValidToken(token);
    expect(payload.unlocked).toBe(true);
    expect(typeof payload.iat).toBe("number");
  });

  it("still succeeds for a Gumroad test-mode (sandbox) purchase", async () => {
    const fetchFn = vi.fn().mockResolvedValue(gumroadResponse({ success: true, purchase: { test: true } }));
    const result = await verifyLicense("TEST-KEY", env(), fetchFn);
    expect(result.status).toBe(200);
  });

  it("rejects a key Gumroad says isn't valid", async () => {
    const fetchFn = vi.fn().mockResolvedValue(gumroadResponse({ success: false, message: "That license does not exist for the provided product." }));
    const result = await verifyLicense("WRONG-KEY", env(), fetchFn);
    expect(result.status).toBe(402);
    expect((result.body as { error: string }).error).toMatch(/does not exist/);
  });

  it("rejects a refunded purchase", async () => {
    const fetchFn = vi.fn().mockResolvedValue(gumroadResponse({ success: true, purchase: { refunded: true } }));
    const result = await verifyLicense("ABCD-1234", env(), fetchFn);
    expect(result.status).toBe(402);
  });

  it("rejects a disputed purchase", async () => {
    const fetchFn = vi.fn().mockResolvedValue(gumroadResponse({ success: true, purchase: { disputed: true } }));
    const result = await verifyLicense("ABCD-1234", env(), fetchFn);
    expect(result.status).toBe(402);
  });

  it("rejects a chargebacked purchase", async () => {
    const fetchFn = vi.fn().mockResolvedValue(gumroadResponse({ success: true, purchase: { chargebacked: true } }));
    const result = await verifyLicense("ABCD-1234", env(), fetchFn);
    expect(result.status).toBe(402);
  });

  it("returns a 502 if Gumroad can't be reached", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await verifyLicense("ABCD-1234", env(), fetchFn);
    expect(result.status).toBe(502);
  });
});
