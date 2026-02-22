import type {
  LogEntry,
  LatencyStats,
  EndpointLatencyStats,
  ErrorStats,
  TimelineBucket,
  AnalysisSummary,
  LatencyResult,
} from './types';

export function computePercentiles(values: number[], percentiles: number[]): number[] {
  if (values.length === 0) return percentiles.map(() => 0);

  const sorted = [...values].sort((a, b) => a - b);
  return percentiles.map((p) => {
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    const fraction = index - lower;
    return sorted[lower] + fraction * (sorted[upper] - sorted[lower]);
  });
}

function computeStatsFromValues(values: number[]): LatencyStats {
  if (values.length === 0) {
    return { count: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0, min: 0 };
  }

  const sum = values.reduce((a, b) => a + b, 0);
  const [p50, p95, p99] = computePercentiles(values, [50, 95, 99]);

  return {
    count: values.length,
    mean: Math.round((sum / values.length) * 100) / 100,
    p50: Math.round(p50 * 100) / 100,
    p95: Math.round(p95 * 100) / 100,
    p99: Math.round(p99 * 100) / 100,
    max: Math.max(...values),
    min: Math.min(...values),
  };
}

export function computeLatencyStats(entries: LogEntry[]): LatencyResult {
  const allResponseTimes = entries.map((e) => e.responseTime);
  const global = computeStatsFromValues(allResponseTimes);

  const byEndpointMap = new Map<string, number[]>();
  for (const entry of entries) {
    const key = `${entry.method} ${entry.path}`;
    const values = byEndpointMap.get(key);
    if (values) {
      values.push(entry.responseTime);
    } else {
      byEndpointMap.set(key, [entry.responseTime]);
    }
  }

  const byEndpoint: EndpointLatencyStats[] = Array.from(byEndpointMap.entries())
    .map(([endpoint, values]) => ({
      endpoint,
      stats: computeStatsFromValues(values),
    }))
    .sort((a, b) => b.stats.p95 - a.stats.p95);

  return { global, byEndpoint };
}

export function computeErrorStats(entries: LogEntry[]): ErrorStats {
  const errorEntries = entries.filter((e) => e.statusCode >= 400);
  const totalErrors = errorEntries.length;
  const errorRate = entries.length > 0 ? Math.round((totalErrors / entries.length) * 10000) / 10000 : 0;

  const byStatusCode: Record<number, number> = {};
  for (const entry of errorEntries) {
    byStatusCode[entry.statusCode] = (byStatusCode[entry.statusCode] || 0) + 1;
  }

  const endpointCounts = new Map<string, { total: number; errors: number }>();
  for (const entry of entries) {
    const key = `${entry.method} ${entry.path}`;
    const current = endpointCounts.get(key) || { total: 0, errors: 0 };
    current.total++;
    if (entry.statusCode >= 400) current.errors++;
    endpointCounts.set(key, current);
  }

  const byEndpoint: Record<string, { count: number; rate: number }> = {};
  for (const [endpoint, counts] of endpointCounts) {
    if (counts.errors > 0) {
      byEndpoint[endpoint] = {
        count: counts.errors,
        rate: Math.round((counts.errors / counts.total) * 10000) / 10000,
      };
    }
  }

  const errorMessages = new Map<string, number>();
  for (const entry of errorEntries) {
    const msg = entry.error || `HTTP ${entry.statusCode}`;
    errorMessages.set(msg, (errorMessages.get(msg) || 0) + 1);
  }

  const topErrors = Array.from(errorMessages.entries())
    .map(([message, count]) => ({ message, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return { totalErrors, errorRate, byStatusCode, byEndpoint, topErrors };
}

export function computeTimeline(entries: LogEntry[], bucketSizeMs: number): TimelineBucket[] {
  if (entries.length === 0) return [];

  const buckets = new Map<number, { requests: number; errors: number; responseTimes: number[] }>();

  for (const entry of entries) {
    const ts = new Date(entry.timestamp).getTime();
    const bucketKey = Math.floor(ts / bucketSizeMs) * bucketSizeMs;

    const bucket = buckets.get(bucketKey) || { requests: 0, errors: 0, responseTimes: [] };
    bucket.requests++;
    if (entry.statusCode >= 400) bucket.errors++;
    bucket.responseTimes.push(entry.responseTime);
    buckets.set(bucketKey, bucket);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([ts, bucket]) => {
      const avg = bucket.responseTimes.reduce((a, b) => a + b, 0) / bucket.responseTimes.length;
      const [p95] = computePercentiles(bucket.responseTimes, [95]);
      return {
        timestamp: new Date(ts).toISOString(),
        requestCount: bucket.requests,
        errorCount: bucket.errors,
        errorRate: Math.round((bucket.errors / bucket.requests) * 10000) / 10000,
        avgResponseTime: Math.round(avg * 100) / 100,
        p95ResponseTime: Math.round(p95 * 100) / 100,
      };
    });
}

export function computeSummary(entries: LogEntry[]): AnalysisSummary {
  if (entries.length === 0) {
    return {
      totalRequests: 0,
      timeRange: { start: '', end: '' },
      uniqueEndpoints: 0,
      uniqueServices: 0,
      errorRate: 0,
      avgResponseTime: 0,
    };
  }

  const endpoints = new Set(entries.map((e) => `${e.method} ${e.path}`));
  const services = new Set(entries.map((e) => e.service));
  const errors = entries.filter((e) => e.statusCode >= 400).length;
  const avgRT = entries.reduce((sum, e) => sum + e.responseTime, 0) / entries.length;

  return {
    totalRequests: entries.length,
    timeRange: {
      start: entries[0].timestamp,
      end: entries[entries.length - 1].timestamp,
    },
    uniqueEndpoints: endpoints.size,
    uniqueServices: services.size,
    errorRate: Math.round((errors / entries.length) * 10000) / 10000,
    avgResponseTime: Math.round(avgRT * 100) / 100,
  };
}
