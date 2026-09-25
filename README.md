# @gagandeep023/log-analyzer

Reads a JSONL request log and tells you what is wrong with it: latency
percentiles, error rates over time, four kinds of anomaly, and errors grouped so
the same failure is one row instead of a thousand.

```bash
npm i @gagandeep023/log-analyzer
```

**Zero runtime dependencies.** Nothing else is installed. It is a CLI and a
library from the same build.

---

## The log format it expects

One JSON object per line. Eight fields are required, two are optional:

```jsonc
{
  "timestamp": "2026-02-20T10:15:00.000Z",  // string, required
  "level": "error",                 // info | warn | error | fatal
  "service": "api",                          // required
  "method": "POST",                          // required
  "path": "/v1/checkout",                    // required
  "statusCode": 500,                         // integer, required
  "responseTime": 1420,             // non-negative ms, required
  "requestId": "req_8f21",                   // required
  "error": "Timeout connecting to payments",  // optional, grouped
  "metadata": { "region": "ap-south-1" }     // optional, passed through
}
```

Validation is strict on purpose, but a bad line never stops the run. `parse`
returns everything it could read **and** everything it could not, each with its
line number:

```ts
const { entries, errors } = parse(raw);
// errors: [{
//   line: 42,
//   message: 'Invalid level: debug. Must be info|warn|error|fatal',
//   raw: '...',
// }]
```

A log where half the lines are malformed will still produce an analysis, and
tell you which half was ignored. Blank lines are skipped silently.

---

## CLI

```bash
log-analyzer analyze access.jsonl
log-analyzer analyze access.jsonl --format both --output ./reports
log-analyzer analyze access.jsonl --config thresholds.json
log-analyzer parse access.jsonl          # validate only, no analysis
```

| Option | Meaning |
|---|---|
| `--format <json\|markdown\|both>` | Output format. Default `markdown`. |
| `--output <dir>` | Write reports to a directory. Default is stdout. |
| `--config <file>` | JSON file of threshold overrides, all fields optional. |
| `--help` | Usage. |

Use `parse` before `analyze` when you are wiring up a new log source: it is a
dry run that reports schema problems without producing numbers you might trust
by mistake.

---

## Library

```ts
import { analyze, DEFAULT_CONFIG } from '@gagandeep023/log-analyzer';

const result = analyze(rawJsonl, { bucketSizeMs: 300_000 });

result.summary;    // totals, time range, unique endpoints and services
result.latency;    // global percentiles + per-endpoint breakdown
result.errors;     // rate, by status code, by endpoint, top messages
result.anomalies;  // see below, severity-ranked
result.timeline;   // per-bucket request count, error rate, p95
result.patterns;   // errors grouped by normalised message
```

Every stage is also exported on its own, so you can run one piece against rows
from a database instead of a file:

```ts
import {
  parse,
  computePercentiles, computeLatencyStats, computeErrorStats,
  computeTimeline, computeSummary,
  detectAnomalies, detectErrorSpikes, detectLatencyOutliers,
  detectRepeatedErrors, detectStatusAnomalies,
  normalizeMessage, matchPatterns,
  generateMarkdownReport, generateJsonReport,
} from '@gagandeep023/log-analyzer';
```

Types are a separate entry point:

```ts
import type {
  LogEntry, LogLevel, AnalyzerConfig, AnalysisResult, Anomaly,
  AnomalyType, AnomalySeverity, LatencyStats, ErrorStats,
  TimelineBucket, ErrorPattern, ParseResult, ParseError,
} from '@gagandeep023/log-analyzer/types';
```

---

## Configuration

```ts
export const DEFAULT_CONFIG = {
  errorRateThreshold: 2,        // standard deviations above the mean
  latencyOutlierMultiplier: 1.5,// multiple of p99
  bucketSizeMs: 60000,          // timeline bucket, 1 minute
  minBucketsForSpike: 5,        // below this, spikes are skipped
  statusAnomalyThreshold: 0.1,  // share of requests on one status code
};
```

`minBucketsForSpike` is the one worth understanding. Spike detection compares
each bucket against the mean and standard deviation of all buckets, so a log
covering three minutes has no meaningful baseline to compare against. Rather
than report confident nonsense from four data points, it reports nothing.

---

## The four anomaly passes

Each returns `Anomaly` objects carrying the evidence, not just a label, so you
can check the call rather than trust it.

### Error spikes

A bucket is a spike when its error rate exceeds `mean + errorRateThreshold × stddev`
**and** it actually contains errors. Severity comes from the ratio to the mean:
5× is `critical`, 3× `high`, 2× `medium`.

```
Error rate spike: 34.0% (mean: 4.2%, +6.1 stddev)
```

`details` carries `errorRate`, `errorCount`, `requestCount`, `meanErrorRate`
and `stddev`, so the arithmetic is auditable.

### Latency outliers

Threshold is `p99 × latencyOutlierMultiplier`, computed globally, then outliers
are grouped **per endpoint** so one slow route does not get buried in the
overall count. Severity is the worst request's ratio to p99.

Percentiles rather than means throughout: a single 30-second request cannot hide
behind a fast average, which is the usual reason a mean-based report looks calm
during an incident.

### Repeated errors

Groups errors by **normalised** message (see below). Severity is by volume:
20 or more is `critical`, 10 `high`, 5 `medium`, otherwise `low`.

### Status anomalies

Flags any status code taking an unusual share of traffic. At or above 50% of
requests it is `critical`, 25% `high`, 15% `medium`, with
`statusAnomalyThreshold` as the floor for reporting at all.

---

## Why errors get normalised first

An error carrying an id is a different string every time, so raw grouping
reports a thousand distinct one-off failures instead of one failure that
happened a thousand times. `normalizeMessage` replaces the parts that vary:

| Replaced | With |
|---|---|
| UUIDs | `<UUID>` |
| ISO timestamps | `<TIMESTAMP>` |
| Email addresses | `<EMAIL>` |
| IPv4 addresses | `<IP>` |
| Hex strings, 24 chars or longer | `<HEX_ID>` |
| Bare integers, 4 digits or longer | `<ID>` |

Order matters and is deliberate. UUIDs and timestamps are replaced before the
generic numeric rule, or `2026-02-20T10:15:00Z` would be shredded into `<ID>`
fragments and stop matching anything.

```ts
normalizeMessage('User 48211 not found in tenant 3f9a...e12b');
// 'User <ID> not found in tenant <HEX_ID>'
```

Each `ErrorPattern` keeps up to three real examples plus `firstSeen` and
`lastSeen`, so you can still see the original text and when it started.

---

## Reports

```ts
import { generateMarkdownReport, generateJsonReport }
  from '@gagandeep023/log-analyzer';

// human-readable, paste into an issue
const md = generateMarkdownReport(result);

// machine-readable, diff between runs
const json = generateJsonReport(result);
```

---

## Empty input

`analyze('')` returns a fully-formed `AnalysisResult` with zeroed fields rather
than throwing or returning `null`. Callers rendering a dashboard do not need a
special case for "no data yet".

## Requests and feedback

[![Request a feature](https://img.shields.io/badge/request-a%20feature-64ffda)](https://github.com/Gagandeep023/log-analyzer/discussions/new?category=ideas)
[![Report a bug](https://img.shields.io/badge/report-a%20bug-cc4444)](https://github.com/Gagandeep023/log-analyzer/issues/new?template=bug_report.yml)

Ideas and questions go to Discussions, bugs to Issues.

## License

MIT
