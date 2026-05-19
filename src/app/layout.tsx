export const dynamic = "force-dynamic";

import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import dynamicImport from "next/dynamic";
import { BASE_PATH } from "@/lib/base-path";
import "./globals.css";

// Lazy-loaded so the /login and /m/* bundles never include NextAuth
// SessionProvider, AppearanceProvider, sonner Toaster, or
// ServiceWorkerRegistration.
const AppShell = dynamicImport(() => import("@/components/layout/AppShell"));

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Remote Dev",
  description: "Remote development terminal interface",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Remote Dev",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#1a1b26",
  width: "device-width",
  initialScale: 1,
  // WCAG 1.4.4 (Resize Text): users must be able to zoom up to 200%.
  // Lighthouse a11y flags `maximum-scale=1` and `user-scalable=no`.
  // Allow up to 5x and keep pinch-zoom on.
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const hdrs = await headers();
  const pathname = hdrs.get("x-pathname") ?? "";
  const isLoginRoute = pathname === "/login";
  // /m/* routes are loaded by the Flutter WebView host and must not
  // mount the desktop AppShell (which would inject MobileShell with its
  // bottom tab bar on mobile viewports).
  const isMobileEmbedRoute = pathname.startsWith("/m/");
  const skipAppShell = isLoginRoute || isMobileEmbedRoute;

  return (
    // suppressHydrationWarning: Theme class is applied client-side by AppearanceProvider
    // Default to dark to prevent flash of unstyled content
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/*
          Embed the runtime base path before any client script runs so
          `window.__RDV_BASE_PATH__` is set when `useTerminalWsUrl` (and any
          future basePath-aware client code) reads it. The script lives in
          <head> rather than <body> because under React 19 concurrent
          rendering, a client component's useEffect can fire before a
          body-positioned inline script executes. JSON.stringify is the
          escape boundary — never string-concatenate untrusted values into
          a <script> tag, and never use template literals here.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__RDV_BASE_PATH__=${JSON.stringify(BASE_PATH)};`,
          }}
        />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {skipAppShell ? children : <AppShell>{children}</AppShell>}
      </body>
    </html>
  );
}
