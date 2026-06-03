export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";

import { prefixPath } from "@/lib/base-path";
import { resolveInstanceMobileCallback } from "@/lib/mobile-callback";

export default async function MobileCallbackPage() {
  const result = await resolveInstanceMobileCallback();

  if (result.kind === "redirect") {
    redirect(result.url);
  }

  if (result.kind === "login") {
    redirect(
      prefixPath(
        `/login?callbackUrl=${encodeURIComponent(prefixPath("/auth/mobile-callback"))}`,
      ),
    );
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
