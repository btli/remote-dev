/**
 * Browser Service - Manages headless Playwright browser instances per session
 *
 * Provides screenshot-based browser interaction for in-app browser panes.
 * Each session gets an isolated browser context with its own page.
 *
 * Uses dynamic import to avoid loading Playwright at module level,
 * which would fail in Next.js client bundles.
 */

import type { Browser, Page, BrowserContext } from "playwright";

interface BrowserSession {
  context: BrowserContext;
  page: Page;
  lastScreenshot: Buffer | null;
  lastScreenshotAt: number;
}

const sessions = new Map<string, BrowserSession>();
let playwrightModule: typeof import("playwright") | null = null;
let sharedBrowser: Browser | null = null;

async function getPlaywright() {
  if (!playwrightModule) {
    playwrightModule = await import("playwright");
  }
  return playwrightModule;
}

/** Get or create a shared browser instance */
async function getSharedBrowser(): Promise<Browser> {
  if (sharedBrowser?.isConnected()) return sharedBrowser;
  const pw = await getPlaywright();
  sharedBrowser = await pw.chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  return sharedBrowser;
}

/**
 * Validate URL scheme for security.
 * Only http: and https: protocols are allowed.
 */
function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const allowed = ["http:", "https:"];
    return allowed.includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Get a session or throw if not found.
 */
function getSession(sessionId: string): BrowserSession {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`No browser session for ${sessionId}`);
  return session;
}

/**
 * Create a new browser session with an isolated context and page.
 * If a session already exists for the given ID, this is a no-op.
 */
export async function createBrowserSession(sessionId: string, url?: string): Promise<void> {
  if (sessions.has(sessionId)) return;

  const browser = await getSharedBrowser();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  if (url) {
    if (!validateUrl(url)) throw new Error("Invalid URL: only http/https allowed");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  }

  sessions.set(sessionId, {
    context,
    page,
    lastScreenshot: null,
    lastScreenshotAt: 0,
  });
}

/**
 * Close and clean up a browser session.
 */
export async function closeBrowserSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;

  await session.context.close().catch(() => {});
  sessions.delete(sessionId);

  // Close the shared browser if no sessions remain
  if (sessions.size === 0 && sharedBrowser) {
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null;
  }
}

/**
 * Navigate the session's page to a new URL.
 */
export async function navigate(sessionId: string, url: string): Promise<void> {
  const session = getSession(sessionId);
  if (!validateUrl(url)) throw new Error("Invalid URL: only http/https allowed");
  await session.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
}

/**
 * Take a screenshot of the current page.
 * Debounced to max 10fps (100ms between screenshots).
 */
export async function screenshot(sessionId: string): Promise<Buffer> {
  const session = getSession(sessionId);
  const now = Date.now();

  // Debounce: max 10fps (100ms between screenshots)
  if (session.lastScreenshot && now - session.lastScreenshotAt < 100) {
    return session.lastScreenshot;
  }

  const buffer = await session.page.screenshot({
    type: "jpeg",
    quality: 70,
  });

  // Playwright returns Buffer, ensure we store it correctly
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  session.lastScreenshot = buf;
  session.lastScreenshotAt = now;
  return buf;
}

/**
 * Click at the given coordinates on the page.
 */
export async function click(sessionId: string, x: number, y: number): Promise<void> {
  const session = getSession(sessionId);
  await session.page.mouse.click(x, y);
}

/**
 * Fill a form field identified by CSS selector with text.
 */
export async function fill(sessionId: string, selector: string, text: string): Promise<void> {
  const session = getSession(sessionId);
  await session.page.fill(selector, text);
}

/**
 * Type text using the keyboard (simulates keystrokes).
 */
export async function typeText(sessionId: string, text: string): Promise<void> {
  const session = getSession(sessionId);
  await session.page.keyboard.type(text);
}

/**
 * Evaluate a JavaScript expression in the browser page context.
 */
export async function evaluate(sessionId: string, expression: string): Promise<unknown> {
  const session = getSession(sessionId);
  return session.page.evaluate(expression);
}

/**
 * Get the accessibility tree snapshot as a string.
 * Uses Playwright's ariaSnapshot() for a structured ARIA representation.
 */
export async function snapshot(sessionId: string): Promise<string> {
  const session = getSession(sessionId);
  const ariaTree = await session.page.locator("body").ariaSnapshot();
  return ariaTree;
}

/**
 * Navigate back in browser history.
 */
export async function goBack(sessionId: string): Promise<void> {
  const session = getSession(sessionId);
  await session.page.goBack({ waitUntil: "domcontentloaded", timeout: 10000 });
}

/**
 * Navigate forward in browser history.
 */
export async function goForward(sessionId: string): Promise<void> {
  const session = getSession(sessionId);
  await session.page.goForward({ waitUntil: "domcontentloaded", timeout: 10000 });
}

/**
 * Get the current URL of the page.
 */
export async function getCurrentUrl(sessionId: string): Promise<string> {
  const session = getSession(sessionId);
  return session.page.url();
}

/**
 * Check if a browser session exists for the given ID.
 */
export function hasSession(sessionId: string): boolean {
  return sessions.has(sessionId);
}
