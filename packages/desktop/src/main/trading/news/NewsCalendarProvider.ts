// ── main/trading/news/NewsCalendarProvider.ts ──────────────────────────────────
//
// Loads and manages an economic event calendar from a local JSON file.
// The calendar lives at userData/triforge-news-calendar.json.
//
// File format (array of raw event objects):
//   [
//     { "time": "2025-06-18T13:00:00Z", "title": "FOMC Rate Decision" },
//     { "time": "2025-06-20T12:30:00Z", "title": "Initial Jobless Claims" },
//     ...
//   ]
//
// Each event is classified on load via NewsEventClassifier.
// If the file does not exist, the provider returns an empty calendar safely.
//
// SIMULATION ONLY. No real brokerage orders.

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { NewsEvent, NewsTier } from '@triforge/engine';
import { classifyEvent, assignBuffers } from './NewsEventClassifier';

// ── Raw Calendar Entry (JSON file format) ──────────────────────────────────

interface RawCalendarEntry {
  time: string;      // ISO-8601 date-time string
  title: string;     // Event title
  tier?: NewsTier;   // Optional manual override
}

// ── Provider ────────────────────────────────────────────────────────────────

const CALENDAR_FILENAME = 'triforge-news-calendar.json';

export class NewsCalendarProvider {
  private _events: NewsEvent[] = [];
  private _lastLoadTime = 0;

  /** Reload interval — re-read the file at most once per 5 minutes. */
  private static readonly RELOAD_INTERVAL_MS = 5 * 60 * 1000;

  // ── Loading ─────────────────────────────────────────────────────────────

  /**
   * Load or reload the calendar from disk.
   * Safe to call frequently — only re-reads if stale.
   */
  load(): void {
    const now = Date.now();
    if (now - this._lastLoadTime < NewsCalendarProvider.RELOAD_INTERVAL_MS) return;
    this._lastLoadTime = now;

    const filePath = this._calendarPath();
    if (!fs.existsSync(filePath)) {
      this._events = [];
      return;
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const entries: RawCalendarEntry[] = JSON.parse(raw);
      if (!Array.isArray(entries)) {
        this._events = [];
        return;
      }

      this._events = entries
        .map(e => this._parseEntry(e))
        .filter((e): e is NewsEvent => e !== null)
        .sort((a, b) => a.time - b.time);
    } catch {
      // Corrupt or unreadable file — safe fallback
      this._events = [];
    }
  }

  // ── Queries ─────────────────────────────────────────────────────────────

  /**
   * Get events within a time window around `now`.
   *
   * @param windowMinutesBefore - How many minutes before now to include.
   * @param windowMinutesAfter  - How many minutes after now to include.
   * @param now                 - Override current time (ms epoch). Defaults to Date.now().
   */
  getUpcomingEvents(
    windowMinutesBefore = 30,
    windowMinutesAfter = 60,
    now = Date.now(),
  ): NewsEvent[] {
    this.load(); // ensure fresh data

    const windowStart = now - windowMinutesBefore * 60_000;
    const windowEnd = now + windowMinutesAfter * 60_000;

    return this._events.filter(e => e.time >= windowStart && e.time <= windowEnd);
  }

  /**
   * Get all loaded events (sorted by time ascending).
   */
  getAllEvents(): NewsEvent[] {
    this.load();
    return [...this._events];
  }

  /**
   * Get the count of loaded events.
   */
  get eventCount(): number {
    return this._events.length;
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private _calendarPath(): string {
    return path.join(app.getPath('userData'), CALENDAR_FILENAME);
  }

  private _parseEntry(raw: RawCalendarEntry): NewsEvent | null {
    if (!raw.time || !raw.title) return null;

    const timeMs = new Date(raw.time).getTime();
    if (isNaN(timeMs)) return null;

    const tier: NewsTier = raw.tier ?? classifyEvent(raw.title);
    const buffers = assignBuffers(tier);

    return {
      time: timeMs,
      title: raw.title.trim(),
      tier,
      bufferMinutesBefore: buffers.before,
      bufferMinutesAfter: buffers.after,
    };
  }
}
