/**
 * NextAuth route handler for the Supervisor's OIDC login flow.
 *
 * The Supervisor UI runs at the root (basePath ""), unlike the slug-pathed
 * instances, so no base-path rewrite wrapper is needed (cf. the root app's
 * handler). The login flow is reachable because the router proxies `/api/*`
 * (incl. `/api/auth/*`) and `/login` to the Supervisor dashboard, and the proxy
 * (`src/proxy.ts`) passes both through without a CF Access requirement.
 */

import { handlers } from "@/auth";

export const { GET, POST } = handlers;
