# Chord Nebula license verification Worker

The one piece of server-side infrastructure this otherwise-static site
(GitHub Pages, no backend) needs, so levels 4-8 can require a real
purchase. See issue #27 for the full context; this file covers the
product decision and how to actually deploy it.

## Why this design

**Provider: Gumroad.** Chosen over Lemon Squeezy because its license
verification API (`POST https://api.gumroad.com/v2/licenses/verify`)
needs no OAuth or API secret to call — just the (non-secret) product ID
and the customer's key — which keeps this Worker's own secret surface to
exactly one thing (the token-signing key, below). It's also widely used
for exactly this "sell a license key for a small product" case.

**Verification: server-checked once, then a self-verifying offline
token — not "call the Worker on every page load."** A pure static site
fundamentally can't have *real* DRM: any client-side check can be patched
out in devtools by someone determined enough, regardless of how the
check is implemented. Given that, the goal here isn't unbreakable
protection, it's:

1. A real purchase, actually checked against Gumroad (including
   refund/dispute/chargeback status, which only Gumroad's API knows) —
   not just "did the user type something into a box."
2. Once verified, an unlock that keeps working offline and doesn't
   depend on this Worker's uptime for every single page load.

That's what the token is for. The Worker holds an ECDSA (P-256) *private*
key as a secret and signs a small `{unlocked:true, iat:...}` payload with
it after a successful Gumroad check. The corresponding *public* key is
committed in `src/app.ts` (`UNLOCK_PUBLIC_KEY_JWK`) — a public key can
verify a signature but can't forge one, so it's safe to ship in the
client bundle. The browser checks the signature with `crypto.subtle.verify`
entirely locally after that; no network call, no re-checking with Gumroad,
satisfying "not re-verified on every load against the provider." This is
the standard offline-license-verification pattern (asymmetric-signed
token), not something bespoke.

An HMAC (symmetric-secret) token would have been simpler to implement,
but the client can't verify an HMAC without knowing the secret — which
means it isn't a secret anymore once it's in client JS. That would have
forced re-checking with *this Worker* (not Gumroad) on every load instead
of a genuinely offline check, which doesn't fit "e.g. localStorage token"
from the issue's acceptance criteria as well as a self-contained signed
token does.

## Deploying

1. **Create the Gumroad product** (a one-time-payment product with
   license keys enabled — Gumroad's own product settings). Note its
   product ID.
2. **Generate a signing key pair.** Anywhere with Node works — do this
   somewhere the private key output won't be logged/committed anywhere,
   not in this repo, not pasted into an AI session:
   ```js
   const { webcrypto } = require("crypto");
   (async () => {
     const kp = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
     console.log("PRIVATE (Worker secret):", JSON.stringify(await webcrypto.subtle.exportKey("jwk", kp.privateKey)));
     console.log("PUBLIC (commit in src/app.ts):", JSON.stringify(await webcrypto.subtle.exportKey("jwk", kp.publicKey)));
   })();
   ```
3. **Update `src/app.ts`**: set `UNLOCK_PUBLIC_KEY_JWK` to the public JWK
   from step 2, `GUMROAD_PRODUCT_URL` to the product's purchase page.
4. **Update `worker/wrangler.toml`**: set `GUMROAD_PRODUCT_ID` to the
   product ID from step 1, `ALLOWED_ORIGIN` if the site isn't at
   `chords.yottanami.com`.
5. **Set the Worker secret** (never goes in a file, not even
   `wrangler.toml`):
   ```bash
   cd worker
   npx wrangler secret put PRIVATE_KEY_JWK
   # paste the PRIVATE JWK from step 2 when prompted
   ```
6. **Deploy**: `npm run deploy` (from `worker/`). Note the resulting
   `*.workers.dev` URL (or set up a custom route) and put it in
   `src/app.ts`'s `LICENSE_VERIFY_URL`.
7. Rebuild the site (`npm run build` at the repo root) and redeploy.

## Testing without a real purchase

Gumroad supports test-mode purchases/license keys — the Worker
deliberately does **not** reject `purchase.test === true` (see
`worker/src/verify.ts`), so a Gumroad test purchase round-trips through
this exact flow end-to-end, per the issue's acceptance criteria.

## Local development

```bash
npm install
npm run dev     # wrangler dev, runs the Worker locally
npm test        # unit tests for verifyLicense's decision logic (mocked Gumroad, no network)
```
