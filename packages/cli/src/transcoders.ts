// ============================================================================
// @contex-llm/cli — Format Transcoders
// ============================================================================
//
// Converts data arrays between all supported serialization formats.
// Used by the benchmark suite to measure format efficiency and by the
// CLI for format conversion commands.
//
// All transcoders sort keys for deterministic output (required for
// prefix cache benchmarks and structural hashing).
// ============================================================================

import { TensTextEncoder, TokenStreamEncoder, formatOutput } from '@contex-llm/core';
import yaml from 'js-yaml';
import { js2xml } from 'xml-js';

export type SupportedFormat =
  | 'json'
  | 'json-min'
  | 'json-pretty'
  | 'yaml'
  | 'xml'
  | 'ndjson'
  | 'csv'
  | 'markdown'
  | 'toon'
  | 'tens'
  | 'tens-text';

// Singleton for TENS text encoding
let _tensEncoder: TokenStreamEncoder | null = null;
function getTensEncoder(): TokenStreamEncoder {
  if (!_tensEncoder) _tensEncoder = new TokenStreamEncoder();
  return _tensEncoder;
}

function sortKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(sortKeys);
  }
  if (obj !== null && typeof obj === 'object') {
    const record = obj as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce(
        (acc, key) => {
          acc[key] = sortKeys(record[key]);
          return acc;
        },
        {} as Record<string, unknown>,
      );
  }
  return obj;
}

/**
 * Transcode data to the specified format with deterministic key ordering.
 *
 * @param data - Array of objects to transcode
 * @param format - Target output format
 * @returns Formatted string (or space-separated token IDs for TENS)
 */
export function transcode(data: unknown[], format: SupportedFormat): string | Uint8Array {
  // Ensure deterministic output by sorting keys
  const sortedData = sortKeys(data) as Record<string, unknown>[];

  switch (format) {
    case 'json':
      return JSON.stringify(sortedData, null, 2);
    case 'json-min':
      return JSON.stringify(sortedData);
    case 'json-pretty':
      return JSON.stringify(sortedData, null, 2);
    case 'yaml':
      return yaml.dump(sortedData);
    case 'xml':
      return js2xml({ root: { row: sortedData } }, { compact: true, spaces: 2 });
    case 'ndjson':
      return sortedData.map((d) => JSON.stringify(d)).join('\n');
    case 'csv':
      return formatOutput(sortedData, 'csv');
    case 'markdown':
      return formatOutput(sortedData, 'markdown');
    case 'toon':
      return formatOutput(sortedData, 'toon');
    case 'tens': {
      // TENS binary: token-stream rendered as space-separated token IDs
      const encoder = getTensEncoder();
      const stream = encoder.encodeToTokenStream(sortedData);
      return stream.join(' ');
    }
    case 'tens-text': {
      // TENS-Text: human-readable indentation-based format
      const ttEncoder = new TensTextEncoder('o200k_base');
      return ttEncoder.encode(sortedData);
    }
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

/** Dispose the singleton TENS encoder to free tokenizer resources. */
export function disposeTensEncoder(): void {
  if (_tensEncoder) {
    _tensEncoder.dispose();
    _tensEncoder = null;
  }
}
