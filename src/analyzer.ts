import type { AnalyzerConfig, AnalysisResult } from './types';
import { parse } from './parser';
import { computeLatencyStats, computeErrorStats, computeTimeline, computeSummary } from './aggregator';
import { detectAnomalies } from './anomalyDetector';
import { matchPatterns } from './patternMatcher';

export const DEFAULT_CONFIG: AnalyzerConfig = {
  errorRateThreshold: 2,
  latencyOutlierMultiplier: 1.5,
  bucketSizeMs: 60000,
  minBucketsForSpike: 5,
  statusAnomalyThreshold: 0.1,
};

export function analyze(content: string, config?: Partial<AnalyzerConfig>): AnalysisResult {
  const mergedConfig: AnalyzerConfig = { ...DEFAULT_CONFIG, ...config };

  const { entries } = parse(content);

  if (entries.length === 0) {
    return {
      summary: {
        totalRequests: 0,
        timeRange: { start: '', end: '' },
        uniqueEndpoints: 0,
        uniqueServices: 0,
        errorRate: 0,
        avgResponseTime: 0,
      },
      latency: { global: { count: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0, min: 0 }, byEndpoint: [] },
      errors: { totalErrors: 0, errorRate: 0, byStatusCode: {}, byEndpoint: {}, topErrors: [] },
      anomalies: [],
      timeline: [],
      patterns: [],
    };
  }

  const summary = computeSummary(entries);
  const latency = computeLatencyStats(entries);
  const errors = computeErrorStats(entries);
  const timeline = computeTimeline(entries, mergedConfig.bucketSizeMs);
  const anomalies = detectAnomalies(entries, mergedConfig, timeline);
  const patterns = matchPatterns(entries);

  return { summary, latency, errors, anomalies, timeline, patterns };
}
