import { describe, it, expect } from 'vitest';
import {
  detectErrorSpikes,
  detectLatencyOutliers,
  detectRepeatedErrors,
  detectStatusAnomalies,
} from '../anomalyDetector';
import type { LogEntry, AnalyzerConfig } from '../types';

const DEFAULT_CONFIG: AnalyzerConfig = {
  errorRateThreshold: 2,
  latencyOutlierMultiplier: 1.5,
  bucketSizeMs: 60000,
  minBucketsForSpike: 5,
  statusAnomalyThreshold: 0.1,
};

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

describe('detectErrorSpikes', () => {
  it('detects a spike when one bucket has high error rate', () => {
    const base = new Date('2026-02-22T10:00:00Z').getTime();
    const entries: LogEntry[] = [];

    // 9 normal buckets with 0% error rate
    for (let bucket = 0; bucket < 9; bucket++) {
      for (let i = 0; i < 10; i++) {
        entries.push(makeEntry({
          timestamp: new Date(base + bucket * 60000 + i * 1000).toISOString(),
          statusCode: 200,
        }));
      }
    }

    // 1 spike bucket with 80% error rate
    for (let i = 0; i < 10; i++) {
      entries.push(makeEntry({
        timestamp: new Date(base + 9 * 60000 + i * 1000).toISOString(),
        statusCode: i < 8 ? 500 : 200,
        level: i < 8 ? 'error' : 'info',
      }));
    }

    const anomalies = detectErrorSpikes(entries, DEFAULT_CONFIG);
    expect(anomalies.length).toBeGreaterThan(0);
    expect(anomalies[0].type).toBe('error_spike');
  });

  it('returns no spikes for uniform error rate', () => {
    const base = new Date('2026-02-22T10:00:00Z').getTime();
    const entries: LogEntry[] = [];

    for (let bucket = 0; bucket < 10; bucket++) {
      for (let i = 0; i < 10; i++) {
        entries.push(makeEntry({
          timestamp: new Date(base + bucket * 60000 + i * 1000).toISOString(),
          statusCode: i === 0 ? 500 : 200,
        }));
      }
    }

    const anomalies = detectErrorSpikes(entries, DEFAULT_CONFIG);
    expect(anomalies).toHaveLength(0);
  });

  it('skips detection with too few buckets', () => {
    const entries = [
      makeEntry({ statusCode: 500 }),
      makeEntry({ statusCode: 200 }),
    ];
    const anomalies = detectErrorSpikes(entries, { ...DEFAULT_CONFIG, minBucketsForSpike: 5 });
    expect(anomalies).toHaveLength(0);
  });
});

describe('detectLatencyOutliers', () => {
  it('detects outliers above p99 * multiplier', () => {
    const entries: LogEntry[] = [];

    // 100 normal entries around 50ms
    for (let i = 0; i < 100; i++) {
      entries.push(makeEntry({ responseTime: 40 + Math.random() * 20 }));
    }

    // 2 extreme outliers
    entries.push(makeEntry({ responseTime: 5000, method: 'GET', path: '/slow' }));
    entries.push(makeEntry({ responseTime: 8000, method: 'GET', path: '/slow' }));

    const anomalies = detectLatencyOutliers(entries, DEFAULT_CONFIG);
    expect(anomalies.length).toBeGreaterThan(0);
    expect(anomalies[0].type).toBe('latency_outlier');
    expect(anomalies[0].affectedEndpoint).toBe('GET /slow');
  });

  it('returns no outliers for uniform latency', () => {
    const entries = Array.from({ length: 100 }, () => makeEntry({ responseTime: 50 }));
    const anomalies = detectLatencyOutliers(entries, DEFAULT_CONFIG);
    expect(anomalies).toHaveLength(0);
  });
});

describe('detectRepeatedErrors', () => {
  it('flags error messages appearing more than 3 times', () => {
    const entries: LogEntry[] = [];
    for (let i = 0; i < 5; i++) {
      entries.push(makeEntry({
        level: 'error',
        statusCode: 500,
        error: 'Connection timeout',
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
      }));
    }

    const anomalies = detectRepeatedErrors(entries);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].type).toBe('repeated_error');
    expect(anomalies[0].details.count).toBe(5);
  });

  it('ignores errors appearing 3 or fewer times', () => {
    const entries = [
      makeEntry({ error: 'Rare error', level: 'error', statusCode: 500 }),
      makeEntry({ error: 'Rare error', level: 'error', statusCode: 500 }),
      makeEntry({ error: 'Rare error', level: 'error', statusCode: 500 }),
    ];

    const anomalies = detectRepeatedErrors(entries);
    expect(anomalies).toHaveLength(0);
  });

  it('groups different error messages separately', () => {
    const entries: LogEntry[] = [];
    for (let i = 0; i < 5; i++) {
      entries.push(makeEntry({ error: 'Error A', level: 'error', statusCode: 500 }));
      entries.push(makeEntry({ error: 'Error B', level: 'error', statusCode: 500 }));
    }

    const anomalies = detectRepeatedErrors(entries);
    expect(anomalies).toHaveLength(2);
  });
});

describe('detectStatusAnomalies', () => {
  it('flags endpoints with high 5xx rate', () => {
    const entries = [
      makeEntry({ method: 'POST', path: '/submit', statusCode: 500 }),
      makeEntry({ method: 'POST', path: '/submit', statusCode: 500 }),
      makeEntry({ method: 'POST', path: '/submit', statusCode: 200 }),
      makeEntry({ method: 'GET', path: '/health', statusCode: 200 }),
      makeEntry({ method: 'GET', path: '/health', statusCode: 200 }),
    ];

    const anomalies = detectStatusAnomalies(entries, DEFAULT_CONFIG);
    expect(anomalies.length).toBeGreaterThan(0);
    expect(anomalies[0].affectedEndpoint).toBe('POST /submit');
  });

  it('ignores endpoints below threshold', () => {
    const entries: LogEntry[] = [];
    for (let i = 0; i < 100; i++) {
      entries.push(makeEntry({ statusCode: 200 }));
    }
    entries.push(makeEntry({ statusCode: 500 }));

    const anomalies = detectStatusAnomalies(entries, DEFAULT_CONFIG);
    expect(anomalies).toHaveLength(0);
  });

  it('ignores 4xx errors (only flags 5xx)', () => {
    const entries = [
      makeEntry({ method: 'GET', path: '/missing', statusCode: 404 }),
      makeEntry({ method: 'GET', path: '/missing', statusCode: 404 }),
      makeEntry({ method: 'GET', path: '/missing', statusCode: 200 }),
    ];

    const anomalies = detectStatusAnomalies(entries, DEFAULT_CONFIG);
    expect(anomalies).toHaveLength(0);
  });
});
