import { describe, it, expect } from 'vitest';
import { generateMarkdownReport, generateJsonReport } from '../reportGenerator';
import type { AnalysisResult } from '../types';

function makeResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    summary: {
      totalRequests: 1000,
      timeRange: { start: '2026-02-22T10:00:00Z', end: '2026-02-22T11:00:00Z' },
      uniqueEndpoints: 5,
      uniqueServices: 2,
      errorRate: 0.05,
      avgResponseTime: 120.5,
    },
    latency: {
      global: { count: 1000, mean: 120.5, p50: 80, p95: 300, p99: 500, max: 2000, min: 5 },
      byEndpoint: [
        {
          endpoint: 'GET /users',
          stats: { count: 500, mean: 100, p50: 70, p95: 250, p99: 400, max: 1500, min: 10 },
        },
      ],
    },
    errors: {
      totalErrors: 50,
      errorRate: 0.05,
      byStatusCode: { 500: 30, 404: 20 },
      byEndpoint: { 'POST /submit': { count: 30, rate: 0.15 } },
      topErrors: [
        { message: 'Connection refused', count: 20 },
        { message: 'Not found', count: 15 },
      ],
    },
    anomalies: [
      {
        type: 'error_spike',
        severity: 'critical',
        timestamp: '2026-02-22T10:30:00Z',
        description: 'Error rate spike at 80%',
        details: {},
      },
      {
        type: 'latency_outlier',
        severity: 'high',
        timestamp: '2026-02-22T10:15:00Z',
        description: '3 requests exceeded 750ms',
        affectedEndpoint: 'GET /slow',
        details: {},
      },
    ],
    timeline: [
      {
        timestamp: '2026-02-22T10:00:00Z',
        requestCount: 100,
        errorCount: 5,
        errorRate: 0.05,
        avgResponseTime: 110,
        p95ResponseTime: 280,
      },
    ],
    patterns: [
      {
        pattern: 'Connection refused to <IP>',
        count: 20,
        examples: ['Connection refused to 192.168.1.1'],
        firstSeen: '2026-02-22T10:00:00Z',
        lastSeen: '2026-02-22T10:30:00Z',
      },
    ],
    ...overrides,
  };
}

describe('generateMarkdownReport', () => {
  it('contains all major sections', () => {
    const report = generateMarkdownReport(makeResult());

    expect(report).toContain('# Log Analysis Report');
    expect(report).toContain('## Summary');
    expect(report).toContain('## Latency Statistics');
    expect(report).toContain('## Error Analysis');
    expect(report).toContain('## Anomalies Detected');
    expect(report).toContain('## Error Patterns');
    expect(report).toContain('## Timeline');
  });

  it('includes summary metrics', () => {
    const report = generateMarkdownReport(makeResult());

    expect(report).toContain('1,000');
    expect(report).toContain('5.00%');
    expect(report).toContain('120.50ms');
  });

  it('includes latency table', () => {
    const report = generateMarkdownReport(makeResult());

    expect(report).toContain('GET /users');
    expect(report).toContain('### By Endpoint');
  });

  it('includes anomaly severity sections', () => {
    const report = generateMarkdownReport(makeResult());

    expect(report).toContain('### Critical (1)');
    expect(report).toContain('### High (1)');
    expect(report).toContain('error_spike');
    expect(report).toContain('latency_outlier');
  });

  it('omits anomalies section when none exist', () => {
    const report = generateMarkdownReport(makeResult({ anomalies: [] }));
    expect(report).not.toContain('## Anomalies Detected');
  });

  it('includes error patterns', () => {
    const report = generateMarkdownReport(makeResult());
    expect(report).toContain('Connection refused');
  });
});

describe('generateJsonReport', () => {
  it('produces valid JSON', () => {
    const result = makeResult();
    const json = generateJsonReport(result);
    const parsed = JSON.parse(json);
    expect(parsed.summary.totalRequests).toBe(1000);
  });

  it('round-trips the full result', () => {
    const result = makeResult();
    const json = generateJsonReport(result);
    const parsed = JSON.parse(json);

    expect(parsed.summary).toEqual(result.summary);
    expect(parsed.latency.global).toEqual(result.latency.global);
    expect(parsed.anomalies).toHaveLength(2);
    expect(parsed.patterns).toHaveLength(1);
  });

  it('is pretty-printed', () => {
    const json = generateJsonReport(makeResult());
    expect(json).toContain('\n');
    expect(json).toContain('  ');
  });
});
