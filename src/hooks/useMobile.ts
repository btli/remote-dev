import { useState, useEffect } from "react";

/**
 * Detects whether the device is mobile based on user-agent and touch capability.
 * More reliable than viewport width — works correctly on tablets, split-screen, etc.
 * SSR-safe: returns false during server render.
 */
export function useMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent;
    const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
    const hasTouchScreen = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    // iPad reports as "Macintosh" in modern Safari — detect via touch + Mac UA
    const isIPad = /Macintosh/i.test(ua) && hasTouchScreen;

    setIsMobile(isMobileUA || isIPad);
  }, []);

  return isMobile;
}
