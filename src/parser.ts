import type { LogEntry, LogLevel, ParseError, ParseResult } from './types';

const VALID_LEVELS: Set<string> = new Set(['info', 'warn', 'error', 'fatal']);

const REQUIRED_FIELDS = ['timestamp', 'level', 'service', 'method', 'path', 'statusCode', 'responseTime', 'requestId'] as const;

function validateEntry(obj: Record<string, unknown>, line: number): LogEntry | ParseError {
  for (const field of REQUIRED_FIELDS) {
    if (obj[field] === undefined || obj[field] === null) {
      return { line, message: `Missing required field: ${field}`, raw: JSON.stringify(obj) };
    }
  }

  if (typeof obj.timestamp !== 'string') {
    return { line, message: 'timestamp must be a string', raw: JSON.stringify(obj) };
  }

  if (!VALID_LEVELS.has(obj.level as string)) {
    return { line, message: `Invalid level: ${obj.level}. Must be info|warn|error|fatal`, raw: JSON.stringify(obj) };
  }

  if (typeof obj.statusCode !== 'number' || !Number.isInteger(obj.statusCode)) {
    return { line, message: 'statusCode must be an integer', raw: JSON.stringify(obj) };
  }

  if (typeof obj.responseTime !== 'number' || obj.responseTime < 0) {
    return { line, message: 'responseTime must be a non-negative number', raw: JSON.stringify(obj) };
  }

  return {
    timestamp: obj.timestamp as string,
    level: obj.level as LogLevel,
    service: String(obj.service),
    method: String(obj.method),
    path: String(obj.path),
    statusCode: obj.statusCode as number,
    responseTime: obj.responseTime as number,
    requestId: String(obj.requestId),
    error: obj.error !== undefined ? String(obj.error) : undefined,
    metadata: obj.metadata as Record<string, unknown> | undefined,
  };
}

export function parse(content: string): ParseResult {
  const entries: LogEntry[] = [];
  const errors: ParseError[] = [];

  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      errors.push({ line: i + 1, message: 'Invalid JSON', raw: line });
      continue;
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      errors.push({ line: i + 1, message: 'Expected JSON object', raw: line });
      continue;
    }

    const result = validateEntry(parsed, i + 1);
    if ('message' in result && 'raw' in result && !('timestamp' in result)) {
      errors.push(result as ParseError);
    } else {
      entries.push(result as LogEntry);
    }
  }

  entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return { entries, errors };
}
