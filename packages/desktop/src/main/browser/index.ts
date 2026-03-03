// browser/index.ts — BrowserController: Playwright-based headless browser operations
// Used by IPC handlers for browser:navigate, browser:screenshot, browser:fillForm, browser:scrape

import { chromium, Browser, BrowserContext, Page } from 'playwright-core';

let _browser: Browser | null = null;
let _context: BrowserContext | null = null;

// Find the locally installed Chrome/Edge executable on Windows/macOS/Linux
function findExecutable(): string | undefined {
  const candidates: string[] = [];
  if (process.platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
    );
  }
  const fs = require('fs') as typeof import('fs');
  return candidates.find(p => fs.existsSync(p));
}

export async function getBrowser(): Promise<Browser> {
  if (_browser?.isConnected()) return _browser;
  const executablePath = findExecutable();
  _browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  return _browser;
}

async function getContext(): Promise<BrowserContext> {
  if (_context) return _context;
  const browser = await getBrowser();
  _context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });
  return _context;
}

async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const ctx = await getContext();
  const page = await ctx.newPage();
  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}

export type NavResult = { text: string; title: string; url: string };

export async function navigate(url: string): Promise<NavResult> {
  return withPage(async page => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const title = await page.title();
    const finalUrl = page.url();
    // Extract visible text, stripping scripts/styles
    const text = await page.evaluate(() => {
      const el = document.body;
      if (!el) return '';
      // Remove script/style/noscript content
      const cloned = el.cloneNode(true) as HTMLElement;
      cloned.querySelectorAll('script, style, noscript, svg').forEach(n => n.remove());
      return (cloned.innerText ?? cloned.textContent ?? '').replace(/\s{3,}/g, '\n\n').trim().slice(0, 50_000);
    });
    return { text, title, url: finalUrl };
  });
}

export type ScreenshotResult = { base64: string; width: number; height: number };

export async function screenshot(url: string): Promise<ScreenshotResult> {
  return withPage(async page => {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    const buf = await page.screenshot({ fullPage: true, type: 'jpeg', quality: 70 });
    const { width, height } = page.viewportSize() ?? { width: 1280, height: 800 };
    return { base64: buf.toString('base64'), width, height };
  });
}

export type FillFormResult = { ok: boolean; message?: string };

export async function fillForm(
  url: string,
  fields: Record<string, string>,
  submitSelector?: string,
): Promise<FillFormResult> {
  return withPage(async page => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    for (const [selector, value] of Object.entries(fields)) {
      await page.fill(selector, value);
    }
    if (submitSelector) {
      await page.click(submitSelector);
      await page.waitForLoadState('domcontentloaded').catch(() => {});
    }
    return { ok: true };
  });
}

export type ScrapeResult = { items: Array<Record<string, string>> };

export async function scrape(url: string, selector: string, attrs?: string[]): Promise<ScrapeResult> {
  return withPage(async page => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const items = await page.evaluate(
      ({ sel, attributes }) => {
        return Array.from(document.querySelectorAll(sel)).map(el => {
          const result: Record<string, string> = { text: (el as HTMLElement).innerText?.trim() ?? el.textContent?.trim() ?? '' };
          if (attributes) {
            for (const attr of attributes) {
              result[attr] = el.getAttribute(attr) ?? '';
            }
          }
          return result;
        });
      },
      { sel: selector, attributes: attrs },
    );
    return { items };
  });
}

export async function closeBrowser(): Promise<void> {
  await _context?.close().catch(() => {});
  _context = null;
  await _browser?.close().catch(() => {});
  _browser = null;
}
