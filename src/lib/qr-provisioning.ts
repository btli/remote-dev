/**
 * QR provisioning payload builders (remote-dev-8xfo).
 *
 * Pure, client-safe helpers that serialise the versioned credential envelopes
 * the Settings → Mobile QR codes encode. The mobile app's `QrPayload.parse`
 * (`mobile/lib/domain/qr_payload.dart`) is the consumer of these strings — the
 * two MUST stay in sync:
 *
 *  - {@link buildCfServiceTokenPayload} → `{ v:1, type:"rdv.cfServiceToken",
 *    host, clientId, clientSecret }` (the new, forward-looking envelope).
 *  - The existing legacy server payload (`{ url, port, apiKey }`, no `type`)
 *    is still emitted inline by `MobileSetupPanel` and intentionally NOT
 *    re-implemented here — it has no version field and the parser recognises it
 *    by the absence of `type`.
 *
 * SECURITY: these functions only build a string from values the caller already
 * holds in browser memory. They never log, persist, or transmit anything — the
 * caller renders the result into a local QR and is responsible for never
 * sending it anywhere.
 */

/** Discriminator for the Cloudflare Access service-token envelope. */
export const CF_SERVICE_TOKEN_TYPE = "rdv.cfServiceToken" as const;

/** The envelope version this build emits (and the mobile parser accepts). */
export const QR_PAYLOAD_VERSION = 1 as const;

/** Shape of the serialised CF service-token envelope. */
export interface CfServiceTokenPayload {
  v: typeof QR_PAYLOAD_VERSION;
  type: typeof CF_SERVICE_TOKEN_TYPE;
  host: string;
  clientId: string;
  clientSecret: string;
}

/**
 * Build the versioned CF service-token QR payload JSON string.
 *
 * Emits exactly the five fields the mobile parser expects — `v`, `type`,
 * `host`, `clientId`, `clientSecret` — with `host` trimmed and `clientId`
 * trimmed (the secret is opaque and preserved verbatim). No extraneous fields
 * are included so the QR stays as small as possible.
 *
 * Inputs are taken as-is from the form; callers should pass a full origin for
 * `host` (e.g. `window.location.origin`).
 */
export function buildCfServiceTokenPayload(input: {
  host: string;
  clientId: string;
  clientSecret: string;
}): string {
  const payload: CfServiceTokenPayload = {
    v: QR_PAYLOAD_VERSION,
    type: CF_SERVICE_TOKEN_TYPE,
    host: input.host.trim(),
    clientId: input.clientId.trim(),
    clientSecret: input.clientSecret,
  };
  return JSON.stringify(payload);
}
