"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ShieldCheck, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildCfServiceTokenPayload } from "@/lib/qr-provisioning";

/**
 * Renders a Cloudflare Access **service token** as a provisioning QR code the
 * mobile app can scan from Edit Host → "Scan QR" (remote-dev-8xfo).
 *
 * Entirely client-side: the three values (host, client id, client secret) live
 * only in component state, are encoded into a QR with {@link QRCodeSVG}, and are
 * NEVER sent to any API, logged, or persisted (no localStorage/sessionStorage).
 * The QR appears only while the form has all three values; "Clear" wipes state.
 *
 * NOTE on basePath: like {@link MobileSetupPanel}, we prefill the Host URL with
 * `window.location.origin` only (no `RDV_BASE_PATH` suffix) — the Dio client is
 * origin-only today, so encoding a base-path host would mislead. Same caveat as
 * the panel above; see that TODO.
 */
export function ServiceTokenQrPanel() {
  const [host, setHost] = useState<string>(() =>
    typeof window !== "undefined" ? window.location.origin : "",
  );
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const ready =
    host.trim().length > 0 &&
    clientId.trim().length > 0 &&
    clientSecret.length > 0;

  // Built locally on every render while the form is complete. Never leaves the
  // browser — no fetch, no logging, no storage.
  const payload = ready
    ? buildCfServiceTokenPayload({ host, clientId, clientSecret })
    : null;

  const handleClear = () => {
    setClientId("");
    setClientSecret("");
    // Reset host back to the origin default rather than blanking it.
    setHost(typeof window !== "undefined" ? window.location.origin : "");
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">
            Cloudflare service token
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          For hosts behind Cloudflare Access. Paste a service token to render a
          QR the mobile app can scan in Edit Host → Scan QR.
        </p>
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="stq-host" className="text-foreground text-xs">
            Host URL
          </Label>
          <Input
            id="stq-host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="https://dev.example.com"
            className="bg-input border-border text-foreground font-mono text-xs"
            autoComplete="off"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="stq-client-id" className="text-foreground text-xs">
            CF-Access-Client-Id
          </Label>
          <Input
            id="stq-client-id"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="xxxx….access"
            className="bg-input border-border text-foreground font-mono text-xs"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="stq-client-secret" className="text-foreground text-xs">
            CF-Access-Client-Secret
          </Label>
          <Input
            id="stq-client-secret"
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="Paste the secret"
            className="bg-input border-border text-foreground font-mono text-xs"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>

      {payload ? (
        <div className="space-y-3 text-center">
          <div className="flex justify-center">
            <div className="p-4 bg-white rounded-xl">
              <QRCodeSVG
                value={payload}
                size={200}
                level="M"
                includeMargin={false}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground max-w-[280px] mx-auto">
            Rendered locally — these values never leave this browser. Scan from
            the mobile app: Edit host → Scan QR.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={handleClear}
          >
            <Eraser className="w-4 h-4 mr-2" />
            Clear
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Enter the host URL and both halves of the token to generate the QR
          code.
        </p>
      )}
    </div>
  );
}
