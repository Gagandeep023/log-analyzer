import type { LogEntry, ErrorPattern } from './types';

const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const NUMERIC_ID_REGEX = /\b\d{4,}\b/g;
const ISO_TIMESTAMP_REGEX = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.\d]*Z?/g;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const IP_REGEX = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
const HEX_ID_REGEX = /\b[0-9a-f]{24,}\b/gi;

export function normalizeMessage(message: string): string {
  return message
    .replace(UUID_REGEX, '<UUID>')
    .replace(ISO_TIMESTAMP_REGEX, '<TIMESTAMP>')
    .replace(EMAIL_REGEX, '<EMAIL>')
    .replace(IP_REGEX, '<IP>')
    .replace(HEX_ID_REGEX, '<HEX_ID>')
    .replace(NUMERIC_ID_REGEX, '<ID>')
    .trim();
}

export function matchPatterns(entries: LogEntry[]): ErrorPattern[] {
  const errorEntries = entries.filter((e) => e.error);
  const groups = new Map<string, { count: number; examples: Set<string>; firstSeen: string; lastSeen: string }>();

  for (const entry of errorEntries) {
    const normalized = normalizeMessage(entry.error!);
    const existing = groups.get(normalized);

    if (existing) {
      existing.count++;
      if (existing.examples.size < 3) {
        existing.examples.add(entry.error!);
      }
      existing.lastSeen = entry.timestamp;
    } else {
      groups.set(normalized, {
        count: 1,
        examples: new Set([entry.error!]),
        firstSeen: entry.timestamp,
        lastSeen: entry.timestamp,
      });
    }
  }

  return Array.from(groups.entries())
    .map(([pattern, data]) => ({
      pattern,
      count: data.count,
      examples: Array.from(data.examples),
      firstSeen: data.firstSeen,
      lastSeen: data.lastSeen,
    }))
    .sort((a, b) => b.count - a.count);
}
