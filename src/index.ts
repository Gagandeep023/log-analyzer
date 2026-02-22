// Core pipeline
export { analyze, DEFAULT_CONFIG } from './analyzer';
export { parse } from './parser';
export { generateMarkdownReport, generateJsonReport } from './reportGenerator';

// Aggregation
export {
  computePercentiles,
  computeLatencyStats,
  computeErrorStats,
  computeTimeline,
  computeSummary,
} from './aggregator';

// Anomaly detection
export {
  detectAnomalies,
  detectErrorSpikes,
  detectLatencyOutliers,
  detectRepeatedErrors,
  detectStatusAnomalies,
} from './anomalyDetector';

// Pattern matching
export { normalizeMessage, matchPatterns } from './patternMatcher';

// Types
export type {
  LogEntry,
  LogLevel,
  AnalyzerConfig,
  AnalysisResult,
  AnalysisSummary,
  Anomaly,
  AnomalyType,
  AnomalySeverity,
  LatencyStats,
  LatencyResult,
  EndpointLatencyStats,
  ErrorStats,
  TimelineBucket,
  ErrorPattern,
  ParseResult,
  ParseError,
} from './types';
