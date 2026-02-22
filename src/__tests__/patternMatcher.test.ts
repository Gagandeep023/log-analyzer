import { describe, it, expect } from 'vitest';
import { normalizeMessage, matchPatterns } from '../patternMatcher';
import type { LogEntry } from '../types';

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    timestamp: '2026-02-22T10:00:00.000Z',
    level: 'error',
    service: 'api',
    method: 'GET',
    path: '/users',
    statusCode: 500,
    responseTime: 50,
    requestId: 'req-001',
    ...overrides,
  };
}

describe('normalizeMessage', () => {
  it('replaces UUIDs', () => {
    const msg = 'User a1b2c3d4-e5f6-7890-abcd-ef1234567890 not found';
    expect(normalizeMessage(msg)).toBe('User <UUID> not found');
  });

  it('replaces numeric IDs (4+ digits)', () => {
    const msg = 'Order 123456 failed';
    expect(normalizeMessage(msg)).toBe('Order <ID> failed');
  });

  it('replaces ISO timestamps', () => {
    const msg = 'Error at 2026-02-22T10:30:00.000Z';
    expect(normalizeMessage(msg)).toBe('Error at <TIMESTAMP>');
  });

  it('replaces email addresses', () => {
    const msg = 'Invalid email: user@example.com';
    expect(normalizeMessage(msg)).toBe('Invalid email: <EMAIL>');
  });

  it('replaces IP addresses', () => {
    const msg = 'Connection from 192.168.1.100 refused';
    expect(normalizeMessage(msg)).toBe('Connection from <IP> refused');
  });

  it('replaces hex IDs (24+ chars)', () => {
    const msg = 'Document 507f1f77bcf86cd799439011 not found';
    expect(normalizeMessage(msg)).toBe('Document <HEX_ID> not found');
  });

  it('handles multiple replacements in one message', () => {
    const msg = 'User a1b2c3d4-e5f6-7890-abcd-ef1234567890 at 192.168.1.1 failed at 2026-02-22T10:00:00Z';
    const result = normalizeMessage(msg);
    expect(result).not.toContain('a1b2c3d4');
    expect(result).not.toContain('192.168.1.1');
    expect(result).toContain('<UUID>');
    expect(result).toContain('<IP>');
  });
});

describe('matchPatterns', () => {
  it('groups identical error messages', () => {
    const entries = [
      makeEntry({ error: 'Connection timeout', timestamp: '2026-02-22T10:00:00Z' }),
      makeEntry({ error: 'Connection timeout', timestamp: '2026-02-22T10:01:00Z' }),
      makeEntry({ error: 'Connection timeout', timestamp: '2026-02-22T10:02:00Z' }),
    ];

    const patterns = matchPatterns(entries);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].count).toBe(3);
    expect(patterns[0].pattern).toBe('Connection timeout');
  });

  it('groups messages with different variable parts under same pattern', () => {
    const entries = [
      makeEntry({ error: 'User a1b2c3d4-e5f6-7890-abcd-ef1234567890 not found' }),
      makeEntry({ error: 'User b2c3d4e5-f6a7-8901-bcde-f12345678901 not found' }),
    ];

    const patterns = matchPatterns(entries);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].pattern).toBe('User <UUID> not found');
    expect(patterns[0].count).toBe(2);
  });

  it('sorts by count descending', () => {
    const entries = [
      makeEntry({ error: 'Rare error' }),
      makeEntry({ error: 'Common error' }),
      makeEntry({ error: 'Common error' }),
      makeEntry({ error: 'Common error' }),
    ];

    const patterns = matchPatterns(entries);
    expect(patterns[0].pattern).toBe('Common error');
    expect(patterns[0].count).toBe(3);
  });

  it('stores up to 3 examples', () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ error: `User ${String(i).padStart(5, '0')} not found` }),
    );

    const patterns = matchPatterns(entries);
    expect(patterns[0].examples.length).toBeLessThanOrEqual(3);
  });

  it('ignores entries without error field', () => {
    const entries = [
      makeEntry({ statusCode: 200 }),
      makeEntry({ error: 'Some error' }),
    ];

    const patterns = matchPatterns(entries);
    expect(patterns).toHaveLength(1);
  });

  it('tracks firstSeen and lastSeen', () => {
    const entries = [
      makeEntry({ error: 'Error X', timestamp: '2026-02-22T10:00:00Z' }),
      makeEntry({ error: 'Error X', timestamp: '2026-02-22T12:00:00Z' }),
    ];

    const patterns = matchPatterns(entries);
    expect(patterns[0].firstSeen).toBe('2026-02-22T10:00:00Z');
    expect(patterns[0].lastSeen).toBe('2026-02-22T12:00:00Z');
  });
});
