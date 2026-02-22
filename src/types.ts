export type LogLevel = 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  method: string;
  path: string;
  statusCode: number;
  responseTime: number;
  requestId: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface AnalyzerConfig {
  errorRateThreshold: number;
  latencyOutlierMultiplier: number;
  bucketSizeMs: number;
  minBucketsForSpike: number;
  statusAnomalyThreshold: number;
}

export interface ParseError {
  line: number;
  message: string;
  raw: string;
}

export interface ParseResult {
  entries: LogEntry[];
  errors: ParseError[];
}

export type AnomalyType = 'error_spike' | 'latency_outlier' | 'repeated_error' | 'status_anomaly';
export type AnomalySeverity = 'critical' | 'high' | 'medium' | 'low';

export interface Anomaly {
  type: AnomalyType;
  severity: AnomalySeverity;
  timestamp: string;
  description: string;
  affectedEndpoint?: string;
  details: Record<string, unknown>;
}

export interface LatencyStats {
  count: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  min: number;
}

export interface EndpointLatencyStats {
  endpoint: string;
  stats: LatencyStats;
}

export interface ErrorStats {
  totalErrors: number;
  errorRate: number;
  byStatusCode: Record<number, number>;
  byEndpoint: Record<string, { count: number; rate: number }>;
  topErrors: Array<{ message: string; count: number }>;
}

export interface TimelineBucket {
  timestamp: string;
  requestCount: number;
  errorCount: number;
  errorRate: number;
  avgResponseTime: number;
  p95ResponseTime: number;
}

export interface ErrorPattern {
  pattern: string;
  count: number;
  examples: string[];
  firstSeen: string;
  lastSeen: string;
}

export interface AnalysisSummary {
  totalRequests: number;
  timeRange: { start: string; end: string };
  uniqueEndpoints: number;
  uniqueServices: number;
  errorRate: number;
  avgResponseTime: number;
}

export interface LatencyResult {
  global: LatencyStats;
  byEndpoint: EndpointLatencyStats[];
}

export interface AnalysisResult {
  summary: AnalysisSummary;
  latency: LatencyResult;
  errors: ErrorStats;
  anomalies: Anomaly[];
  timeline: TimelineBucket[];
  patterns: ErrorPattern[];
}
