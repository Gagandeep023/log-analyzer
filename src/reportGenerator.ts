import type { AnalysisResult } from './types';

function escapeMarkdown(text: string): string {
  return text.replace(/\|/g, '\\|');
}

export function generateMarkdownReport(result: AnalysisResult): string {
  const lines: string[] = [];

  lines.push('# Log Analysis Report');
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Total Requests | ${result.summary.totalRequests.toLocaleString()} |`);
  lines.push(`| Time Range | ${result.summary.timeRange.start} to ${result.summary.timeRange.end} |`);
  lines.push(`| Unique Endpoints | ${result.summary.uniqueEndpoints} |`);
  lines.push(`| Unique Services | ${result.summary.uniqueServices} |`);
  lines.push(`| Error Rate | ${(result.summary.errorRate * 100).toFixed(2)}% |`);
  lines.push(`| Avg Response Time | ${result.summary.avgResponseTime.toFixed(2)}ms |`);
  lines.push('');

  // Latency
  lines.push('## Latency Statistics');
  lines.push('');
  lines.push('### Global');
  lines.push('');
  const g = result.latency.global;
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Mean | ${g.mean.toFixed(2)}ms |`);
  lines.push(`| P50 | ${g.p50.toFixed(2)}ms |`);
  lines.push(`| P95 | ${g.p95.toFixed(2)}ms |`);
  lines.push(`| P99 | ${g.p99.toFixed(2)}ms |`);
  lines.push(`| Max | ${g.max.toFixed(2)}ms |`);
  lines.push(`| Min | ${g.min.toFixed(2)}ms |`);
  lines.push('');

  if (result.latency.byEndpoint.length > 0) {
    lines.push('### By Endpoint');
    lines.push('');
    lines.push('| Endpoint | Count | Mean | P50 | P95 | P99 | Max |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const ep of result.latency.byEndpoint.slice(0, 20)) {
      lines.push(`| ${escapeMarkdown(ep.endpoint)} | ${ep.stats.count} | ${ep.stats.mean.toFixed(1)}ms | ${ep.stats.p50.toFixed(1)}ms | ${ep.stats.p95.toFixed(1)}ms | ${ep.stats.p99.toFixed(1)}ms | ${ep.stats.max.toFixed(1)}ms |`);
    }
    lines.push('');
  }

  // Errors
  lines.push('## Error Analysis');
  lines.push('');
  lines.push(`- Total Errors: ${result.errors.totalErrors}`);
  lines.push(`- Error Rate: ${(result.errors.errorRate * 100).toFixed(2)}%`);
  lines.push('');

  if (Object.keys(result.errors.byStatusCode).length > 0) {
    lines.push('### By Status Code');
    lines.push('');
    lines.push('| Status Code | Count |');
    lines.push('| --- | --- |');
    for (const [code, count] of Object.entries(result.errors.byStatusCode).sort(([, a], [, b]) => b - a)) {
      lines.push(`| ${code} | ${count} |`);
    }
    lines.push('');
  }

  if (result.errors.topErrors.length > 0) {
    lines.push('### Top Errors');
    lines.push('');
    lines.push('| Error | Count |');
    lines.push('| --- | --- |');
    for (const err of result.errors.topErrors) {
      lines.push(`| ${escapeMarkdown(err.message.slice(0, 80))} | ${err.count} |`);
    }
    lines.push('');
  }

  // Anomalies
  if (result.anomalies.length > 0) {
    lines.push('## Anomalies Detected');
    lines.push('');
    lines.push(`Found **${result.anomalies.length}** anomalies.`);
    lines.push('');

    const bySeverity = { critical: [] as typeof result.anomalies, high: [] as typeof result.anomalies, medium: [] as typeof result.anomalies, low: [] as typeof result.anomalies };
    for (const a of result.anomalies) {
      bySeverity[a.severity].push(a);
    }

    for (const [severity, anomalies] of Object.entries(bySeverity)) {
      if (anomalies.length === 0) continue;
      lines.push(`### ${severity.charAt(0).toUpperCase() + severity.slice(1)} (${anomalies.length})`);
      lines.push('');
      for (const a of anomalies) {
        lines.push(`- **[${a.type}]** ${a.description}`);
        if (a.affectedEndpoint) {
          lines.push(`  - Endpoint: \`${a.affectedEndpoint}\``);
        }
      }
      lines.push('');
    }
  }

  // Patterns
  if (result.patterns.length > 0) {
    lines.push('## Error Patterns');
    lines.push('');
    lines.push('| Pattern | Count | First Seen | Last Seen |');
    lines.push('| --- | --- | --- | --- |');
    for (const p of result.patterns.slice(0, 15)) {
      lines.push(`| ${escapeMarkdown(p.pattern.slice(0, 60))} | ${p.count} | ${p.firstSeen} | ${p.lastSeen} |`);
    }
    lines.push('');
  }

  // Timeline
  if (result.timeline.length > 0) {
    lines.push('## Timeline');
    lines.push('');
    lines.push('| Time | Requests | Errors | Error Rate | Avg RT | P95 RT |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const b of result.timeline) {
      lines.push(`| ${b.timestamp} | ${b.requestCount} | ${b.errorCount} | ${(b.errorRate * 100).toFixed(1)}% | ${b.avgResponseTime.toFixed(1)}ms | ${b.p95ResponseTime.toFixed(1)}ms |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function generateJsonReport(result: AnalysisResult): string {
  return JSON.stringify(result, null, 2);
}
