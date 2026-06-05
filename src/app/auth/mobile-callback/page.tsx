export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";

import { prefixPath } from "@/lib/base-path";
import { resolveInstanceMobileCallback } from "@/lib/mobile-callback";

export default async function MobileCallbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  // Anti-hijack nonce the app generated for THIS login attempt (remote-dev-gkuo).
  // Echoed unchanged on the deep link so the app rejects callbacks it didn't
  // initiate. Absent for older app builds (then nothing is echoed).
  const rawState = sp.state;
  const state = Array.isArray(rawState) ? rawState[0] : rawState;

  const result = await resolveInstanceMobileCallback({ state });

  if (result.kind === "redirect") {
    redirect(result.url);
  }

  if (result.kind === "login") {
    // Preserve `state` across the login round-trip: NextAuth returns the user to
    // this `callbackUrl` after sign-in, so the nonce must ride inside it (the
    // top-level query param is dropped during the OIDC bounce). `safeCallbackPath`
    // on the login page accepts this relative path + query as a same-origin
    // redirect. `state` is hex/base64url, so it needs no extra escaping beyond
    // the encodeURIComponent already applied to the whole callbackUrl.
    const inner =
      prefixPath("/auth/mobile-callback") +
      (state ? `?state=${encodeURIComponent(state)}` : "");
    redirect(prefixPath(`/login?callbackUrl=${encodeURIComponent(inner)}`));
  }

  return <ErrorPage message={result.message} />;
}

function ErrorPage({ message }: { message: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: "24px",
        backgroundColor: "#1a1b26",
        color: "#c0caf5",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "12px" }}>
        Authentication Error
      </h1>
      <p style={{ fontSize: "16px", color: "#a9b1d6", textAlign: "center" }}>
        {message}
      </p>
    </div>
  );
}
