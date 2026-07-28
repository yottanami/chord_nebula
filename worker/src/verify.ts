// Cloudflare Worker: the one piece of server-side infrastructure this
// otherwise-static site needs. Verifies a Gumroad license key server-side
// (the only way to check refund/dispute/chargeback status, which requires
// Gumroad's API -- nothing client-side can check this), then mints a
// short, self-contained signed token the client can verify entirely
// offline afterward (see src/app.ts's verifyLicenseToken), so normal page
// loads never need to call this Worker or Gumroad again.
//
// Deploy: see worker/README.md for the required secrets/vars and the
// `wrangler` commands. Nothing here is a substitute for real DRM -- see
// that README for why that's an accepted, deliberate limitation.

export interface Env {
  /** Not secret -- Gumroad's own docs treat this as public, it just says which product to check against. */
  GUMROAD_PRODUCT_ID: string;
  /** Secret. JSON-serialized JWK for an ECDSA P-256 private key. Set via `wrangler secret put PRIVATE_KEY_JWK`. */
  PRIVATE_KEY_JWK: string;
  /** The single origin allowed to call this Worker, e.g. "https://chords.yottanami.com". */
  ALLOWED_ORIGIN: string;
}

interface GumroadPurchase {
  refunded?: boolean;
  disputed?: boolean;
  chargebacked?: boolean;
}

interface GumroadResponse {
  success: boolean;
  message?: string;
  purchase?: GumroadPurchase;
}

export interface VerifyResult {
  status: number;
  body: { token: string } | { error: string };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Mints the signed, offline-verifiable unlock token. See src/app.ts's verifyLicenseToken for the client-side check. */
async function signUnlockToken(privateKeyJwk: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "jwk",
    JSON.parse(privateKeyJwk),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const payloadBytes = new TextEncoder().encode(JSON.stringify({ unlocked: true, iat: Date.now() }));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, payloadBytes);
  return `${toBase64Url(payloadBytes)}.${toBase64Url(new Uint8Array(signature))}`;
}

/**
 * Core verification logic, deliberately independent of the Workers
 * runtime (takes `fetchFn` as a plain argument) so it's testable with
 * plain Vitest against a mocked Gumroad response -- no Workers-specific
 * test harness needed for the part that actually has decision logic.
 */
export async function verifyLicense(
  licenseKey: string,
  env: Pick<Env, "GUMROAD_PRODUCT_ID" | "PRIVATE_KEY_JWK">,
  fetchFn: typeof fetch,
): Promise<VerifyResult> {
  const trimmed = licenseKey.trim();
  if (!trimmed) {
    return { status: 400, body: { error: "License key is required" } };
  }

  let gumroadRes: Response;
  try {
    gumroadRes = await fetchFn("https://api.gumroad.com/v2/licenses/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        product_id: env.GUMROAD_PRODUCT_ID,
        license_key: trimmed,
        increment_uses_count: "true",
      }),
    });
  } catch {
    return { status: 502, body: { error: "Could not reach the license server. Try again shortly." } };
  }

  const data = (await gumroadRes.json()) as GumroadResponse;

  if (!data.success) {
    return { status: 402, body: { error: data.message ?? "That license key isn't valid for Chord Nebula." } };
  }

  const purchase = data.purchase;
  // `purchase.test` (Gumroad's test-mode flag) is deliberately NOT
  // rejected here -- the issue's own acceptance criteria wants a sandbox
  // purchase to round-trip through this exact flow.
  if (purchase?.refunded || purchase?.disputed || purchase?.chargebacked) {
    return { status: 402, body: { error: "This purchase is no longer valid (refunded or disputed)." } };
  }

  const token = await signUnlockToken(env.PRIVATE_KEY_JWK);
  return { status: 200, body: { token } };
}

function corsHeaders(origin: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = corsHeaders(env.ALLOWED_ORIGIN);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    let licenseKey = "";
    try {
      const body = (await request.json()) as { licenseKey?: unknown };
      if (typeof body.licenseKey === "string") licenseKey = body.licenseKey;
    } catch {
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const result = await verifyLicense(licenseKey, env, fetch);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  },
};
