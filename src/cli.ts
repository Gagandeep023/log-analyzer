import * as fs from 'fs';
import * as path from 'path';
import { analyze, DEFAULT_CONFIG } from './analyzer';
import { generateMarkdownReport, generateJsonReport } from './reportGenerator';
import { parse } from './parser';
import type { AnalyzerConfig } from './types';

function printUsage(): void {
  console.log(`
log-analyzer - JSONL log analysis with anomaly detection

Usage:
  log-analyzer analyze <file.jsonl> [options]
  log-analyzer parse <file.jsonl>
  log-analyzer --help

Commands:
  analyze   Run full analysis on a JSONL log file
  parse     Parse and validate a JSONL log file (dry run)

Options:
  --format <format>    Output format: json, markdown, or both (default: markdown)
  --output <dir>       Output directory for reports (default: stdout)
  --config <file>      Path to JSON config file with analyzer thresholds
  --help               Show this help message

Config file format (all fields optional):
  {
    "errorRateThreshold": 2,
    "latencyOutlierMultiplier": 1.5,
    "bucketSizeMs": 60000,
    "minBucketsForSpike": 5,
    "statusAnomalyThreshold": 0.1
  }

Examples:
  log-analyzer analyze access.jsonl
  log-analyzer analyze access.jsonl --format both --output ./reports
  log-analyzer analyze access.jsonl --config thresholds.json
  log-analyzer parse access.jsonl
`);
}

function parseArgs(argv: string[]): {
  command?: string;
  file?: string;
  format: 'json' | 'markdown' | 'both';
  output?: string;
  configPath?: string;
  help: boolean;
} {
  const args = argv.slice(2);
  const result: ReturnType<typeof parseArgs> = {
    format: 'markdown',
    help: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      result.help = true;
      i++;
    } else if (arg === '--format' && i + 1 < args.length) {
      const fmt = args[i + 1];
      if (fmt === 'json' || fmt === 'markdown' || fmt === 'both') {
        result.format = fmt;
      } else {
        console.error(`Invalid format: ${fmt}. Must be json, markdown, or both.`);
        process.exit(1);
      }
      i += 2;
    } else if (arg === '--output' && i + 1 < args.length) {
      result.output = args[i + 1];
      i += 2;
    } else if (arg === '--config' && i + 1 < args.length) {
      result.configPath = args[i + 1];
      i += 2;
    } else if (!arg.startsWith('--')) {
      if (!result.command) {
        result.command = arg;
      } else if (!result.file) {
        result.file = arg;
      }
      i++;
    } else {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    }
  }

  return result;
}

function loadConfig(configPath: string): Partial<AnalyzerConfig> {
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Failed to load config from ${configPath}: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

function writeReport(content: string, filename: string, outputDir: string): void {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const filePath = path.join(outputDir, filename);
  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(`Report written to: ${filePath}`);
}

function main(): void {
  const args = parseArgs(process.argv);

  if (args.help || !args.command) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  if (args.command === 'parse') {
    if (!args.file) {
      console.error('Error: file path required. Usage: log-analyzer parse <file.jsonl>');
      process.exit(1);
    }

    let content: string;
    try {
      content = fs.readFileSync(args.file, 'utf-8');
    } catch (err) {
      console.error(`Failed to read file: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }

    const result = parse(content);
    console.log(`Parsed ${result.entries.length} valid entries.`);
    if (result.errors.length > 0) {
      console.log(`Found ${result.errors.length} parse errors:`);
      for (const err of result.errors.slice(0, 10)) {
        console.log(`  Line ${err.line}: ${err.message}`);
      }
      if (result.errors.length > 10) {
        console.log(`  ... and ${result.errors.length - 10} more`);
      }
    }
    return;
  }

  if (args.command === 'analyze') {
    if (!args.file) {
      console.error('Error: file path required. Usage: log-analyzer analyze <file.jsonl>');
      process.exit(1);
    }

    let content: string;
    try {
      content = fs.readFileSync(args.file, 'utf-8');
    } catch (err) {
      console.error(`Failed to read file: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }

    const config: Partial<AnalyzerConfig> = args.configPath ? loadConfig(args.configPath) : {};
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    const result = analyze(content, mergedConfig);

    if (args.output) {
      if (args.format === 'markdown' || args.format === 'both') {
        writeReport(generateMarkdownReport(result), 'report.md', args.output);
      }
      if (args.format === 'json' || args.format === 'both') {
        writeReport(generateJsonReport(result), 'report.json', args.output);
      }
    } else {
      if (args.format === 'json') {
        console.log(generateJsonReport(result));
      } else if (args.format === 'both') {
        console.log(generateMarkdownReport(result));
        console.log('\n---JSON Report---\n');
        console.log(generateJsonReport(result));
      } else {
        console.log(generateMarkdownReport(result));
      }
    }

    // Print summary to stderr when outputting to files
    if (args.output) {
      const anomalyCount = result.anomalies.length;
      const critical = result.anomalies.filter((a) => a.severity === 'critical').length;
      console.log(`\nAnalysis complete: ${result.summary.totalRequests} requests, ${anomalyCount} anomalies${critical > 0 ? ` (${critical} critical)` : ''}`);
    }
    return;
  }

  console.error(`Unknown command: ${args.command}`);
  printUsage();
  process.exit(1);
}

main();
