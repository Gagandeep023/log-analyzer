import type { LogEntry, Anomaly, AnomalySeverity, AnalyzerConfig, TimelineBucket } from './types';
import { computePercentiles, computeTimeline } from './aggregator';

function classifyErrorSpikeSeverity(rate: number, mean: number): AnomalySeverity {
  const ratio = rate / Math.max(mean, 0.01);
  if (ratio >= 5) return 'critical';
  if (ratio >= 3) return 'high';
  if (ratio >= 2) return 'medium';
  return 'low';
}

function classifyLatencySeverity(responseTime: number, p99: number): AnomalySeverity {
  const ratio = responseTime / Math.max(p99, 1);
  if (ratio >= 5) return 'critical';
  if (ratio >= 3) return 'high';
  if (ratio >= 2) return 'medium';
  return 'low';
}

function stddev(values: number[], mean: number): number {
  if (values.length === 0) return 0;
  const sumSquares = values.reduce((sum, v) => sum + (v - mean) ** 2, 0);
  return Math.sqrt(sumSquares / values.length);
}

export function detectErrorSpikes(
  entries: LogEntry[],
  config: AnalyzerConfig,
  timeline?: TimelineBucket[],
): Anomaly[] {
  const buckets = timeline || computeTimeline(entries, config.bucketSizeMs);
  if (buckets.length < config.minBucketsForSpike) return [];

  const rates = buckets.map((b) => b.errorRate);
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const sd = stddev(rates, mean);

  const anomalies: Anomaly[] = [];
  for (const bucket of buckets) {
    if (bucket.errorRate > mean + config.errorRateThreshold * sd && bucket.errorCount > 0) {
      anomalies.push({
        type: 'error_spike',
        severity: classifyErrorSpikeSeverity(bucket.errorRate, mean),
        timestamp: bucket.timestamp,
        description: `Error rate spike: ${(bucket.errorRate * 100).toFixed(1)}% (mean: ${(mean * 100).toFixed(1)}%, +${((bucket.errorRate - mean) / Math.max(sd, 0.001)).toFixed(1)} stddev)`,
        details: {
          errorRate: bucket.errorRate,
          errorCount: bucket.errorCount,
          requestCount: bucket.requestCount,
          meanErrorRate: Math.round(mean * 10000) / 10000,
          stddev: Math.round(sd * 10000) / 10000,
        },
      });
    }
  }

  return anomalies;
}

export function detectLatencyOutliers(
  entries: LogEntry[],
  config: AnalyzerConfig,
): Anomaly[] {
  const responseTimes = entries.map((e) => e.responseTime);
  const [p99] = computePercentiles(responseTimes, [99]);
  const threshold = p99 * config.latencyOutlierMultiplier;

  const outliersByEndpoint = new Map<string, LogEntry[]>();

  for (const entry of entries) {
    if (entry.responseTime > threshold) {
      const key = `${entry.method} ${entry.path}`;
      const list = outliersByEndpoint.get(key) || [];
      list.push(entry);
      outliersByEndpoint.set(key, list);
    }
  }

  const anomalies: Anomaly[] = [];
  for (const [endpoint, outliers] of outliersByEndpoint) {
    const maxRT = Math.max(...outliers.map((e) => e.responseTime));
    anomalies.push({
      type: 'latency_outlier',
      severity: classifyLatencySeverity(maxRT, p99),
      timestamp: outliers[0].timestamp,
      description: `${outliers.length} request(s) to ${endpoint} exceeded ${threshold.toFixed(0)}ms (p99 * ${config.latencyOutlierMultiplier}). Max: ${maxRT.toFixed(0)}ms`,
      affectedEndpoint: endpoint,
      details: {
        count: outliers.length,
        maxResponseTime: maxRT,
        p99,
        threshold,
        requestIds: outliers.slice(0, 5).map((e) => e.requestId),
      },
    });
  }

  return anomalies.sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
}

export function detectRepeatedErrors(entries: LogEntry[]): Anomaly[] {
  const errorEntries = entries.filter((e) => e.error);
  const groups = new Map<string, { count: number; first: string; last: string }>();

  for (const entry of errorEntries) {
    const msg = entry.error!;
    const existing = groups.get(msg);
    if (existing) {
      existing.count++;
      existing.last = entry.timestamp;
    } else {
      groups.set(msg, { count: 1, first: entry.timestamp, last: entry.timestamp });
    }
  }

  const anomalies: Anomaly[] = [];
  for (const [message, data] of groups) {
    if (data.count > 3) {
      const severity: AnomalySeverity = data.count >= 20 ? 'critical' : data.count >= 10 ? 'high' : data.count >= 5 ? 'medium' : 'low';
      anomalies.push({
        type: 'repeated_error',
        severity,
        timestamp: data.first,
        description: `Error repeated ${data.count} times: "${message.slice(0, 100)}"`,
        details: {
          message,
          count: data.count,
          firstSeen: data.first,
          lastSeen: data.last,
        },
      });
    }
  }

  return anomalies.sort((a, b) => (b.details.count as number) - (a.details.count as number));
}

export function detectStatusAnomalies(
  entries: LogEntry[],
  config: AnalyzerConfig,
): Anomaly[] {
  const endpointStats = new Map<string, { total: number; serverErrors: number }>();

  for (const entry of entries) {
    const key = `${entry.method} ${entry.path}`;
    const stats = endpointStats.get(key) || { total: 0, serverErrors: 0 };
    stats.total++;
    if (entry.statusCode >= 500) stats.serverErrors++;
    endpointStats.set(key, stats);
  }

  const anomalies: Anomaly[] = [];
  for (const [endpoint, stats] of endpointStats) {
    const rate = stats.serverErrors / stats.total;
    if (rate > config.statusAnomalyThreshold && stats.serverErrors > 1) {
      const severity: AnomalySeverity = rate >= 0.5 ? 'critical' : rate >= 0.25 ? 'high' : rate >= 0.15 ? 'medium' : 'low';
      anomalies.push({
        type: 'status_anomaly',
        severity,
        timestamp: entries.find((e) => `${e.method} ${e.path}` === endpoint && e.statusCode >= 500)?.timestamp || '',
        description: `${endpoint}: ${(rate * 100).toFixed(1)}% server error rate (${stats.serverErrors}/${stats.total} requests)`,
        affectedEndpoint: endpoint,
        details: {
          serverErrorCount: stats.serverErrors,
          totalRequests: stats.total,
          errorRate: Math.round(rate * 10000) / 10000,
        },
      });
    }
  }

  return anomalies.sort((a, b) => (b.details.errorRate as number) - (a.details.errorRate as number));
}

export function detectAnomalies(
  entries: LogEntry[],
  config: AnalyzerConfig,
  timeline?: TimelineBucket[],
): Anomaly[] {
  return [
    ...detectErrorSpikes(entries, config, timeline),
    ...detectLatencyOutliers(entries, config),
    ...detectRepeatedErrors(entries),
    ...detectStatusAnomalies(entries, config),
  ];
}
