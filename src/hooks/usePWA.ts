import { useState, useEffect } from "react";

/**
 * Detects whether the app is running as an installed PWA (standalone display mode).
 * Checks both the W3C display-mode media query and Apple's navigator.standalone.
 * SSR-safe: returns false during server render.
 */
export function usePWA(): boolean {
  const [isPWA, setIsPWA] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(display-mode: standalone)");

    function check(): void {
      setIsPWA(
        mq.matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true
      );
    }

    check();
    mq.addEventListener("change", check);
    return () => mq.removeEventListener("change", check);
  }, []);

  return isPWA;
}
