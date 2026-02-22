import { describe, it, expect } from 'vitest';
import { parse } from '../parser';

function makeEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    timestamp: '2026-02-22T10:00:00.000Z',
    level: 'info',
    service: 'api',
    method: 'GET',
    path: '/users',
    statusCode: 200,
    responseTime: 42,
    requestId: 'req-001',
    ...overrides,
  };
}

function toJsonl(entries: Record<string, unknown>[]): string {
  return entries.map((e) => JSON.stringify(e)).join('\n');
}

describe('parser', () => {
  it('parses valid JSONL entries', () => {
    const content = toJsonl([
      makeEntry(),
      makeEntry({ requestId: 'req-002', statusCode: 201 }),
    ]);

    const result = parse(content);
    expect(result.entries).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
    expect(result.entries[0].requestId).toBe('req-001');
    expect(result.entries[1].statusCode).toBe(201);
  });

  it('handles empty input', () => {
    const result = parse('');
    expect(result.entries).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('handles blank lines', () => {
    const content = toJsonl([makeEntry()]) + '\n\n\n';
    const result = parse(content);
    expect(result.entries).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });

  it('collects malformed JSON lines as errors', () => {
    const content = JSON.stringify(makeEntry()) + '\nnot json\n' + JSON.stringify(makeEntry({ requestId: 'req-002' }));

    const result = parse(content);
    expect(result.entries).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].line).toBe(2);
    expect(result.errors[0].message).toBe('Invalid JSON');
  });

  it('rejects non-object JSON', () => {
    const content = '"just a string"\n[1,2,3]\n42';
    const result = parse(content);
    expect(result.entries).toHaveLength(0);
    expect(result.errors).toHaveLength(3);
  });

  it('flags missing required fields', () => {
    const incomplete = { timestamp: '2026-02-22T10:00:00Z', level: 'info' };
    const result = parse(JSON.stringify(incomplete));
    expect(result.entries).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('Missing required field');
  });

  it('rejects invalid level', () => {
    const entry = makeEntry({ level: 'debug' });
    const result = parse(JSON.stringify(entry));
    expect(result.entries).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('Invalid level');
  });

  it('rejects negative responseTime', () => {
    const entry = makeEntry({ responseTime: -10 });
    const result = parse(JSON.stringify(entry));
    expect(result.entries).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
  });

  it('rejects non-integer statusCode', () => {
    const entry = makeEntry({ statusCode: 200.5 });
    const result = parse(JSON.stringify(entry));
    expect(result.entries).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
  });

  it('sorts entries by timestamp', () => {
    const content = toJsonl([
      makeEntry({ timestamp: '2026-02-22T12:00:00Z', requestId: 'late' }),
      makeEntry({ timestamp: '2026-02-22T08:00:00Z', requestId: 'early' }),
      makeEntry({ timestamp: '2026-02-22T10:00:00Z', requestId: 'mid' }),
    ]);

    const result = parse(content);
    expect(result.entries.map((e) => e.requestId)).toEqual(['early', 'mid', 'late']);
  });

  it('preserves optional error field', () => {
    const entry = makeEntry({ level: 'error', statusCode: 500, error: 'Connection refused' });
    const result = parse(JSON.stringify(entry));
    expect(result.entries[0].error).toBe('Connection refused');
  });

  it('preserves optional metadata field', () => {
    const entry = makeEntry({ metadata: { userId: '123' } });
    const result = parse(JSON.stringify(entry));
    expect(result.entries[0].metadata).toEqual({ userId: '123' });
  });
});
