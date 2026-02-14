import { TensTextEncoder } from './tens_text.js';
import type { OutputFormat } from './types.js';

// ── Cached instances (avoid per-call allocation) ────────────────────────────
const cachedTensTextEncoder = new TensTextEncoder();
const cachedByteEncoder = new TextEncoder();

/** Analysis result for a single output format. */
export interface FormatAnalysis {
  /** The format used */
  format: OutputFormat;
  /** Output size in bytes */
  byteSize: number;
  /** The formatted output string */
  output: string;
}

/**
 * Format structured data into a text representation.
 *
 * @param data - Array of uniform objects to format
 * @param format - Target output format
 * @returns Formatted string ready for LLM context injection
 *
 * @example
 * ```ts
 * const data = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }];
 *
 * formatOutput(data, 'csv');
 * // → "id,name\n1,Alice\n2,Bob"
 *
 * formatOutput(data, 'toon');
 * // → "id\tname\n1\tAlice\n2\tBob"
 * ```
 */
export function formatOutput(data: any[], format: OutputFormat): string {
  if (format === 'json') {
    return JSON.stringify(data, null, 2);
  }

  if (format === 'csv') {
    if (data.length === 0) return '';
    const keys = Object.keys(data[0]);
    const header = keys.join(',');
    const rows = data.map((row) =>
      keys
        .map((k) => {
          const val = row[k];
          if (val === null || val === undefined) return '';
          if (
            typeof val === 'string' &&
            (val.includes(',') || val.includes('"') || val.includes('\n'))
          ) {
            return `"${val.replace(/"/g, '""')}"`;
          }
          return String(val);
        })
        .join(','),
    );
    return [header, ...rows].join('\n');
  }

  if (format === 'markdown') {
    if (data.length === 0) return '';
    const keys = Object.keys(data[0]);
    const header = '| ' + keys.join(' | ') + ' |';
    const separator = '| ' + keys.map(() => '---').join(' | ') + ' |';
    const rows = data.map(
      (row) =>
        '| ' +
        keys
          .map((k) => {
            const val = row[k];
            if (val === null || val === undefined) return '';
            return String(val);
          })
          .join(' | ') +
        ' |',
    );
    return [header, separator, ...rows].join('\n');
  }

  if (format === 'toon') {
    // TOON: Tab-separated header + rows
    // Most token-efficient text format for structured data going to LLMs
    if (data.length === 0) return '';
    const keys = Object.keys(data[0]);
    const header = keys.join('\t');
    const rows = data.map((row) =>
      keys
        .map((k) => {
          const val = row[k];
          if (val === null || val === undefined) return '';
          if (typeof val === 'object') return JSON.stringify(val);
          return String(val);
        })
        .join('\t'),
    );
    return [header, ...rows].join('\n');
  }

  if (format === 'tens-text') {
    return cachedTensTextEncoder.encode(data);
  }

  if (format === 'tens' || format === 'tokens') {
    // These are non-text formats handled specially by the engine
    return `__${format.toUpperCase()}_DATA__`;
  }

  // Default: minified JSON
  return JSON.stringify(data);
}

/**
 * Analyze all text output formats for a dataset.
 * Returns byte sizes for each format to help choose the most efficient one.
 *
 * @param data - Array of objects to analyze
 * @returns Array of format analysis results, one per format
 *
 * @example
 * ```ts
 * const results = analyzeFormats(data);
 * // → [{ format: 'json', byteSize: 1234, output: '...' }, ...]
 * ```
 */
export function analyzeFormats(data: any[]): FormatAnalysis[] {
  const formats: OutputFormat[] = ['json', 'csv', 'markdown', 'toon', 'tens-text'];
  return formats.map((format) => {
    const output = formatOutput(data, format);
    return {
      format,
      byteSize: cachedByteEncoder.encode(output).length,
      output,
    };
  });
}
