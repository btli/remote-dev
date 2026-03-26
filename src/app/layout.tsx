import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import { AppearanceProvider } from "@/contexts/AppearanceContext";
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";
import { Toaster } from "sonner";
import "./globals.css";

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
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: Theme class is applied client-side by AppearanceProvider
    // Default to dark to prevent flash of unstyled content
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <SessionProvider refetchInterval={5 * 60} refetchOnWindowFocus={true}>
          <AppearanceProvider>{children}</AppearanceProvider>
        </SessionProvider>
        <Toaster
          position="bottom-center"
          theme="dark"
          toastOptions={{
            classNames: {
              toast:
                "bg-popover/95 backdrop-blur-xl border border-border shadow-2xl text-popover-foreground",
              title: "font-medium text-sm",
              description: "text-xs text-muted-foreground",
              actionButton:
                "bg-primary text-primary-foreground text-xs px-2 py-1 rounded-md",
              closeButton: "text-muted-foreground hover:text-foreground",
            },
          }}
        />
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
