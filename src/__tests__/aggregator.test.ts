import { describe, it, expect } from 'vitest';
import {
  computePercentiles,
  computeLatencyStats,
  computeErrorStats,
  computeTimeline,
  computeSummary,
} from '../aggregator';
import type { LogEntry } from '../types';

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    timestamp: '2026-02-22T10:00:00.000Z',
    level: 'info',
    service: 'api',
    method: 'GET',
    path: '/users',
    statusCode: 200,
    responseTime: 50,
    requestId: `req-${Math.random().toString(36).slice(2, 8)}`,
    ...overrides,
  };
}

describe('computePercentiles', () => {
  it('returns correct percentiles for sorted data', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const [p50, p95] = computePercentiles(values, [50, 95]);
    expect(p50).toBe(5.5);
    expect(p95).toBeCloseTo(9.55, 1);
  });

  it('returns 0 for empty array', () => {
    const result = computePercentiles([], [50, 95]);
    expect(result).toEqual([0, 0]);
  });

  it('returns the single value for single-element array', () => {
    const result = computePercentiles([42], [50, 95, 99]);
    expect(result).toEqual([42, 42, 42]);
  });

  it('handles unsorted input', () => {
    const values = [10, 1, 5, 3, 7, 9, 2, 8, 4, 6];
    const [p50] = computePercentiles(values, [50]);
    expect(p50).toBe(5.5);
  });
});

describe('computeLatencyStats', () => {
  it('computes global and per-endpoint stats', () => {
    const entries = [
      makeEntry({ method: 'GET', path: '/users', responseTime: 100 }),
      makeEntry({ method: 'GET', path: '/users', responseTime: 200 }),
      makeEntry({ method: 'POST', path: '/users', responseTime: 300 }),
    ];

    const result = computeLatencyStats(entries);
    expect(result.global.count).toBe(3);
    expect(result.global.mean).toBe(200);
    expect(result.global.min).toBe(100);
    expect(result.global.max).toBe(300);
    expect(result.byEndpoint).toHaveLength(2);
  });

  it('sorts endpoints by p95 descending', () => {
    const entries = [
      makeEntry({ method: 'GET', path: '/fast', responseTime: 10 }),
      makeEntry({ method: 'GET', path: '/slow', responseTime: 500 }),
    ];

    const result = computeLatencyStats(entries);
    expect(result.byEndpoint[0].endpoint).toBe('GET /slow');
  });

  it('handles empty entries', () => {
    const result = computeLatencyStats([]);
    expect(result.global.count).toBe(0);
    expect(result.byEndpoint).toHaveLength(0);
  });
});

describe('computeErrorStats', () => {
  it('computes error rates and groups', () => {
    const entries = [
      makeEntry({ statusCode: 200 }),
      makeEntry({ statusCode: 200 }),
      makeEntry({ statusCode: 500, error: 'DB error' }),
      makeEntry({ statusCode: 404, error: 'Not found' }),
    ];

    const result = computeErrorStats(entries);
    expect(result.totalErrors).toBe(2);
    expect(result.errorRate).toBe(0.5);
    expect(result.byStatusCode[500]).toBe(1);
    expect(result.byStatusCode[404]).toBe(1);
    expect(result.topErrors).toHaveLength(2);
  });

  it('returns zero stats for all-success entries', () => {
    const entries = [makeEntry(), makeEntry()];
    const result = computeErrorStats(entries);
    expect(result.totalErrors).toBe(0);
    expect(result.errorRate).toBe(0);
  });

  it('computes per-endpoint error rates', () => {
    const entries = [
      makeEntry({ method: 'GET', path: '/a', statusCode: 200 }),
      makeEntry({ method: 'GET', path: '/a', statusCode: 500 }),
      makeEntry({ method: 'GET', path: '/b', statusCode: 200 }),
    ];

    const result = computeErrorStats(entries);
    expect(result.byEndpoint['GET /a'].count).toBe(1);
    expect(result.byEndpoint['GET /a'].rate).toBe(0.5);
    expect(result.byEndpoint['GET /b']).toBeUndefined();
  });
});

describe('computeTimeline', () => {
  it('buckets entries by time', () => {
    const base = new Date('2026-02-22T10:00:00Z').getTime();
    const entries = [
      makeEntry({ timestamp: new Date(base).toISOString(), responseTime: 100 }),
      makeEntry({ timestamp: new Date(base + 30000).toISOString(), responseTime: 200 }),
      makeEntry({ timestamp: new Date(base + 90000).toISOString(), responseTime: 50 }),
    ];

    const result = computeTimeline(entries, 60000);
    expect(result).toHaveLength(2);
    expect(result[0].requestCount).toBe(2);
    expect(result[1].requestCount).toBe(1);
  });

  it('computes error rate per bucket', () => {
    const base = new Date('2026-02-22T10:00:00Z').getTime();
    const entries = [
      makeEntry({ timestamp: new Date(base).toISOString(), statusCode: 200 }),
      makeEntry({ timestamp: new Date(base + 1000).toISOString(), statusCode: 500 }),
    ];

    const result = computeTimeline(entries, 60000);
    expect(result[0].errorRate).toBe(0.5);
    expect(result[0].errorCount).toBe(1);
  });

  it('returns empty for no entries', () => {
    expect(computeTimeline([], 60000)).toEqual([]);
  });
});

describe('computeSummary', () => {
  it('computes correct summary', () => {
    const entries = [
      makeEntry({ timestamp: '2026-02-22T10:00:00Z', service: 'api', method: 'GET', path: '/a', statusCode: 200, responseTime: 100 }),
      makeEntry({ timestamp: '2026-02-22T10:01:00Z', service: 'auth', method: 'POST', path: '/b', statusCode: 500, responseTime: 200 }),
    ];

    const result = computeSummary(entries);
    expect(result.totalRequests).toBe(2);
    expect(result.uniqueEndpoints).toBe(2);
    expect(result.uniqueServices).toBe(2);
    expect(result.errorRate).toBe(0.5);
    expect(result.avgResponseTime).toBe(150);
    expect(result.timeRange.start).toBe('2026-02-22T10:00:00Z');
    expect(result.timeRange.end).toBe('2026-02-22T10:01:00Z');
  });

  it('handles empty entries', () => {
    const result = computeSummary([]);
    expect(result.totalRequests).toBe(0);
    expect(result.uniqueEndpoints).toBe(0);
  });
});
