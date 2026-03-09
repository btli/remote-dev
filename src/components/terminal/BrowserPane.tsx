"use client";

/**
 * BrowserPane - Screenshot-based browser viewport component
 *
 * Renders a headless browser session with:
 * - Navigation bar (back, forward, refresh, URL input)
 * - Screenshot viewport that polls for frames
 * - Click interaction mapped to viewport coordinates
 * - IntersectionObserver to pause polling when not visible
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { ArrowLeft, ArrowRight, RotateCw, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TerminalSession } from "@/types/session";
import type { BrowserSessionMetadata } from "@/types/terminal-type";

interface BrowserPaneProps {
  session: TerminalSession;
}

export function BrowserPane({ session }: BrowserPaneProps) {
  const metadata = session.typeMetadata as BrowserSessionMetadata | null;
  const [url, setUrl] = useState(metadata?.currentUrl ?? "");
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [navigated, setNavigated] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isVisible, setIsVisible] = useState(true);

  // Track the previous screenshot URL for cleanup
  const prevScreenshotUrlRef = useRef<string | null>(null);

  // IntersectionObserver to pause frame delivery when not visible
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { threshold: 0.1 }
    );
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  // Poll for screenshots when visible and navigated
  useEffect(() => {
    if (!navigated || !isVisible) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }

    const fetchScreenshot = async () => {
      try {
        const res = await fetch(`/api/sessions/${session.id}/browser/screenshot`);
        if (res.ok) {
          const blob = await res.blob();
          const objectUrl = URL.createObjectURL(blob);
          setScreenshotUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return objectUrl;
          });
          prevScreenshotUrlRef.current = objectUrl;
        }
      } catch {
        // Ignore screenshot fetch errors
      }
    };

    fetchScreenshot();
    pollRef.current = setInterval(fetchScreenshot, 1000); // 1fps polling

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [session.id, navigated, isVisible]);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      if (prevScreenshotUrlRef.current) {
        URL.revokeObjectURL(prevScreenshotUrlRef.current);
      }
    };
  }, []);

  const handleNavigate = useCallback(
    async (targetUrl?: string) => {
      const navUrl = targetUrl ?? url;
      if (!navUrl) return;

      setLoading(true);
      try {
        const res = await fetch(`/api/sessions/${session.id}/browser/navigate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: navUrl }),
        });
        if (res.ok) {
          const data = (await res.json()) as { url?: string };
          setUrl(data.url ?? navUrl);
          setNavigated(true);
        }
      } catch (err) {
        console.error("Navigation failed:", err);
      } finally {
        setLoading(false);
      }
    },
    [session.id, url]
  );

  const handleClick = useCallback(
    async (e: React.MouseEvent<HTMLImageElement>) => {
      if (!screenshotUrl) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const img = e.currentTarget;

      // Calculate coordinates relative to the original viewport
      const scaleX = (metadata?.viewportWidth ?? 1280) / img.clientWidth;
      const scaleY = (metadata?.viewportHeight ?? 720) / img.clientHeight;
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);

      await fetch(`/api/sessions/${session.id}/browser/click`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x, y }),
      });
    },
    [session.id, screenshotUrl, metadata?.viewportWidth, metadata?.viewportHeight]
  );

  const handleBack = useCallback(
    () => fetch(`/api/sessions/${session.id}/browser/back`, { method: "POST" }),
    [session.id]
  );

  const handleForward = useCallback(
    () => fetch(`/api/sessions/${session.id}/browser/forward`, { method: "POST" }),
    [session.id]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      handleNavigate();
    },
    [handleNavigate]
  );

  return (
    <div ref={containerRef} className="flex flex-col h-full bg-background">
      {/* Navigation bar */}
      <div className="flex items-center gap-1 p-1.5 border-b border-border/50 bg-muted/20">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleBack}>
          <ArrowLeft className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleForward}>
          <ArrowRight className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => handleNavigate()}
          disabled={loading}
        >
          <RotateCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
        <form className="flex-1 flex" onSubmit={handleSubmit}>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Enter URL..."
            className="h-7 text-sm bg-background/50"
          />
        </form>
      </div>

      {/* Browser viewport */}
      <div className="flex-1 overflow-hidden relative bg-white">
        {!navigated ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 bg-background">
            <Globe className="w-12 h-12 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Enter a URL to browse</p>
          </div>
        ) : screenshotUrl ? (
          <img
            src={screenshotUrl}
            alt="Browser view"
            className="w-full h-full object-contain cursor-pointer"
            onClick={handleClick}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <RotateCw className="w-6 h-6 text-muted-foreground animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}
