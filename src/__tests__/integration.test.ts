import { describe, it, expect } from 'vitest';
import { analyze } from '../analyzer';
import { generateMarkdownReport, generateJsonReport } from '../reportGenerator';

function generateSyntheticLogs(): string {
  const lines: string[] = [];
  const base = new Date('2026-02-22T10:00:00Z').getTime();
  const services = ['api', 'auth', 'payments'];
  const endpoints = [
    { method: 'GET', path: '/users' },
    { method: 'POST', path: '/users' },
    { method: 'GET', path: '/orders' },
    { method: 'POST', path: '/payments' },
    { method: 'GET', path: '/health' },
  ];

  let reqCounter = 0;

  // Generate 10 minutes of normal traffic
  for (let minute = 0; minute < 10; minute++) {
    for (let i = 0; i < 20; i++) {
      const ts = base + minute * 60000 + i * 3000;
      const ep = endpoints[i % endpoints.length];
      const service = services[i % services.length];
      const responseTime = 30 + Math.floor(Math.random() * 100);

      lines.push(JSON.stringify({
        timestamp: new Date(ts).toISOString(),
        level: 'info',
        service,
        method: ep.method,
        path: ep.path,
        statusCode: 200,
        responseTime,
        requestId: `req-${++reqCounter}`,
      }));
    }
  }

  // Inject error spike in minute 11
  for (let i = 0; i < 20; i++) {
    const ts = base + 10 * 60000 + i * 3000;
    const isError = i < 15;
    lines.push(JSON.stringify({
      timestamp: new Date(ts).toISOString(),
      level: isError ? 'error' : 'info',
      service: 'payments',
      method: 'POST',
      path: '/payments',
      statusCode: isError ? 500 : 200,
      responseTime: isError ? 800 + Math.floor(Math.random() * 500) : 50,
      requestId: `req-${++reqCounter}`,
      error: isError ? 'Payment gateway timeout' : undefined,
    }));
  }

  // Inject latency outliers
  for (let i = 0; i < 3; i++) {
    const ts = base + 12 * 60000 + i * 5000;
    lines.push(JSON.stringify({
      timestamp: new Date(ts).toISOString(),
      level: 'warn',
      service: 'api',
      method: 'GET',
      path: '/users',
      statusCode: 200,
      responseTime: 5000 + Math.floor(Math.random() * 3000),
      requestId: `req-${++reqCounter}`,
    }));
  }

  // More normal traffic after
  for (let minute = 13; minute < 20; minute++) {
    for (let i = 0; i < 15; i++) {
      const ts = base + minute * 60000 + i * 4000;
      const ep = endpoints[i % endpoints.length];
      lines.push(JSON.stringify({
        timestamp: new Date(ts).toISOString(),
        level: 'info',
        service: services[i % services.length],
        method: ep.method,
        path: ep.path,
        statusCode: 200,
        responseTime: 40 + Math.floor(Math.random() * 80),
        requestId: `req-${++reqCounter}`,
      }));
    }
  }

  // Inject repeated errors throughout
  for (let i = 0; i < 8; i++) {
    const ts = base + (i + 2) * 60000 + 30000;
    lines.push(JSON.stringify({
      timestamp: new Date(ts).toISOString(),
      level: 'error',
      service: 'auth',
      method: 'POST',
      path: '/users',
      statusCode: 401,
      responseTime: 15,
      requestId: `req-${++reqCounter}`,
      error: 'Invalid token: token expired',
    }));
  }

  return lines.join('\n');
}

describe('integration', () => {
  const syntheticLogs = generateSyntheticLogs();

  it('runs full pipeline on synthetic data', () => {
    const result = analyze(syntheticLogs);

    expect(result.summary.totalRequests).toBeGreaterThan(200);
    expect(result.summary.uniqueEndpoints).toBeGreaterThan(0);
    expect(result.summary.uniqueServices).toBeGreaterThan(0);
    expect(result.summary.errorRate).toBeGreaterThan(0);
    expect(result.summary.avgResponseTime).toBeGreaterThan(0);
  });

  it('detects anomalies in injected data', () => {
    const result = analyze(syntheticLogs);

    expect(result.anomalies.length).toBeGreaterThan(0);

    const types = new Set(result.anomalies.map((a) => a.type));
    expect(types.has('repeated_error')).toBe(true);
  });

  it('computes timeline with non-empty buckets', () => {
    const result = analyze(syntheticLogs);

    expect(result.timeline.length).toBeGreaterThan(0);
    for (const bucket of result.timeline) {
      expect(bucket.requestCount).toBeGreaterThan(0);
      expect(bucket.avgResponseTime).toBeGreaterThan(0);
    }
  });

  it('identifies error patterns', () => {
    const result = analyze(syntheticLogs);

    expect(result.patterns.length).toBeGreaterThan(0);
    const paymentPattern = result.patterns.find((p) => p.pattern.includes('Payment'));
    expect(paymentPattern).toBeDefined();
    expect(paymentPattern!.count).toBeGreaterThan(1);
  });

  it('generates valid markdown report', () => {
    const result = analyze(syntheticLogs);
    const markdown = generateMarkdownReport(result);

    expect(markdown).toContain('# Log Analysis Report');
    expect(markdown).toContain('## Summary');
    expect(markdown).toContain('## Latency Statistics');
    expect(markdown.length).toBeGreaterThan(500);
  });

  it('generates valid JSON report that round-trips', () => {
    const result = analyze(syntheticLogs);
    const json = generateJsonReport(result);
    const parsed = JSON.parse(json);

    expect(parsed.summary.totalRequests).toBe(result.summary.totalRequests);
    expect(parsed.anomalies.length).toBe(result.anomalies.length);
  });

  it('handles custom config', () => {
    const result = analyze(syntheticLogs, {
      bucketSizeMs: 120000,
      statusAnomalyThreshold: 0.5,
    });

    expect(result.timeline.length).toBeLessThan(
      analyze(syntheticLogs, { bucketSizeMs: 60000 }).timeline.length,
    );
  });

  it('handles empty input', () => {
    const result = analyze('');
    expect(result.summary.totalRequests).toBe(0);
    expect(result.anomalies).toHaveLength(0);
    expect(result.timeline).toHaveLength(0);
  });
});
