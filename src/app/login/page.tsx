"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Smartphone } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const result = await signIn("credentials", {
      email,
      redirect: false,
    });

    if (result?.error) {
      setError("Unauthorized email or login not allowed from this location");
      setLoading(false);
    } else {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Remote Dev</CardTitle>
          <CardDescription>
            Sign in with your authorized email (localhost only)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Remote access requires Cloudflare Access authentication
            </p>
          </form>
        </CardContent>
      </Card>
      <MobileAppBanner />
    </div>
  );
}

const APK_DOWNLOAD_URL =
  "https://github.com/btli/remote-dev/releases/latest/download/remote-dev-0.3.0-android-debug.apk";

function MobileAppBanner() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setIsMobile(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
  }, []);

  if (!isMobile) return null;

  return (
    <Card className="w-full max-w-md border-primary/20 bg-primary/5">
      <CardContent className="flex items-center gap-3 p-4">
        <Smartphone className="h-8 w-8 shrink-0 text-primary" />
        <div className="flex-1">
          <p className="text-sm font-medium">Remote Dev Mobile</p>
          <p className="text-xs text-muted-foreground">
            Native terminal app for Android
          </p>
        </div>
        <Button size="sm" variant="outline" asChild>
          <a href={APK_DOWNLOAD_URL}>Download APK</a>
        </Button>
      </CardContent>
    </Card>
  );
}
