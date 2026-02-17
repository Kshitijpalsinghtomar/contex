import { compressFieldNames } from './schema.js';
import { TensTextEncoder } from './tens_text.js';
import type { OutputFormat } from './types.js';

// ── Cached instances (avoid per-call allocation) ────────────────────────────
const cachedTensTextEncoder = new TensTextEncoder();
const cachedByteEncoder = new TextEncoder();

// ── P2-2: Array Optimization Helpers ───────────────────────────────────────

/**
 * Run-length encoding for sorted arrays with repeated values.
 * Converts: [a, a, a, b, b, c, c, c, c] → [[a, 3], [b, 2], [c, 4]]
 */
function runLengthEncode(arr: unknown[]): unknown[] {
  if (arr.length === 0) return [];

  const result: [unknown, number][] = [];
  let current = arr[0];
  let count = 1;

  for (let i = 1; i < arr.length; i++) {
    if (arr[i] === current) {
      count++;
    } else {
      result.push([current, count]);
      current = arr[i];
      count = 1;
    }
  }
  result.push([current, count]);

  return result;
}

/**
 * Delta encoding for sorted numeric arrays.
 * Converts: [100, 101, 102, 103, 200] → [100, 1, 1, 1, 97]
 */
function deltaEncode(arr: number[]): number[] {
  if (arr.length === 0) return [];

  const result: number[] = [arr[0]];
  for (let i = 1; i < arr.length; i++) {
    result.push(arr[i] - arr[i - 1]);
  }
  return result;
}

/**
 * Optimize arrays in data using various strategies:
 * - Run-length encoding for repeated values
 * - Delta encoding for sorted numbers
 * - Dictionary compression for repeated strings
 */
export function optimizeArrays(data: unknown[]): unknown[] {
  if (data.length === 0) return data;

  // Get all unique keys that contain arrays
  const keysWithArrays = new Set<string>();
  for (const row of data) {
    if (row && typeof row === 'object') {
      const record = row as Record<string, unknown>;
      for (const [key, value] of Object.entries(record)) {
        if (Array.isArray(value) && value.length > 0) {
          keysWithArrays.add(key);
        }
      }
    }
  }

  if (keysWithArrays.size === 0) return data;

  // Process each row
  return data.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const optimized: Record<string, unknown> = { ...(row as Record<string, unknown>) };

    for (const key of keysWithArrays) {
      const arr = optimized[key];
      if (!Array.isArray(arr)) continue;

      // Check if array is sorted
      const isSorted = arr.every((val, i, a) => !i || String(a[i - 1]) <= String(val));

      // Check if numeric
      const isNumeric = arr.every((val) => typeof val === 'number' && !Number.isNaN(val));

      // Check for repeated values (good candidate for RLE)
      const uniqueCount = new Set(arr.map(String)).size;
      const hasRepeats = arr.length > uniqueCount * 1.5;

      if (isNumeric && isSorted) {
        // Use delta encoding for sorted numbers
        const delta = deltaEncode(arr as number[]);
        // Store as special object to indicate encoding
        optimized[key] = { __delta: delta };
      } else if (hasRepeats && isSorted) {
        // Use run-length encoding for sorted repeated values
        optimized[key] = { __rle: runLengthEncode(arr) };
      } else if (uniqueCount < arr.length * 0.5) {
        // Use dictionary compression for frequent values
        const dictionary = [...new Set(arr.map(String))];
        const compressed = arr.map((val) => {
          const idx = dictionary.indexOf(String(val));
          return idx >= 0 ? idx : val;
        });
        optimized[key] = { __dict: dictionary, __data: compressed };
      }
    }

    return optimized;
  });
}

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
export function formatOutput(data: unknown[], format: OutputFormat): string {
  // Input validation — guard against null, undefined, non-array inputs
  if (!data || !Array.isArray(data)) return '';
  const rows = data.filter(
    (r) => r !== null && r !== undefined && typeof r === 'object' && !Array.isArray(r),
  ) as Record<string, unknown>[];
  if (format === 'json') {
    return JSON.stringify(rows, null, 2);
  }

  if (format === 'csv') {
    if (rows.length === 0) return '';
    const keys = Object.keys(rows[0]);
    const header = keys.join(',');
    const csvRows = rows.map((row) =>
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
    return [header, ...csvRows].join('\n');
  }

  if (format === 'markdown') {
    if (rows.length === 0) return '';
    const keys = Object.keys(rows[0]);
    const header = `| ${keys.join(' | ')} |`;
    const separator = `| ${keys.map(() => '---').join(' | ')} |`;
    const markdownRows = rows.map(
      (row) =>
        `| ${keys
          .map((k) => {
            const val = row[k];
            if (val === null || val === undefined) return '';
            return String(val);
          })
          .join(' | ')} |`,
    );
    return [header, separator, ...markdownRows].join('\n');
  }

  if (format === 'toon') {
    // TOON: Tab-separated header + rows
    // Most token-efficient text format for structured data going to LLMs
    if (rows.length === 0) return '';
    const keys = Object.keys(rows[0]);
    const header = keys.join('\t');
    const toonRows = rows.map((row) =>
      keys
        .map((k) => {
          const val = row[k];
          if (val === null || val === undefined) return '';
          if (typeof val === 'object') return JSON.stringify(val);
          return String(val);
        })
        .join('\t'),
    );
    return [header, ...toonRows].join('\n');
  }

  if (format === 'contex') {
    // Contex Compact: Ultra-efficient format for LLM context injection
    // - Deep flattening: nested objects → dot-notation keys (readings.value)
    // - Field name compression: shortest unique prefix for each field
    // - Tab-separated header + values (schema declared once)
    // - Dictionary compression for repeated string AND numeric values (@0, @1, ...)
    // - Boolean abbreviation (T/F instead of true/false)
    // - Null abbreviation (_ instead of null/empty)
    // - Integer shortening (no trailing .0)
    // - Array compaction: [a, b, c] → "a b c" (space-separated)
    // - Sparse mode: when >50% of cells are null, emit only non-null values with column indices
    // - No brackets, no quotes, no colons, no commas
    if (rows.length === 0) return '';

    // Helper: serialize any value for embedding inside a cell
    const serializeVal = (v: unknown): string => {
      if (v === null || v === undefined) return '_';
      if (v === true) return 'T';
      if (v === false) return 'F';
      if (typeof v === 'string') return v;
      if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
      if (Array.isArray(v)) {
        if (v.length > 0 && typeof v[0] === 'object' && v[0] !== null) {
          // Nested array of objects: serialize each as {k:v,k:v} then semicolon-separated
          return v.map((item: unknown) => {
            if (typeof item === 'object' && item !== null) {
              return '{' + Object.entries(item as Record<string, unknown>)
                .map(([ik, iv]) => `${ik}:${serializeVal(iv)}`)
                .join(',') + '}';
            }
            return serializeVal(item);
          }).join(';');
        }
        // Simple array: space-separated
        return v.map(serializeVal).join(' ');
      }
      if (typeof v === 'object') {
        // Plain nested object: {k:v,k:v}
        return '{' + Object.entries(v as Record<string, unknown>)
          .map(([ik, iv]) => `${ik}:${serializeVal(iv)}`)
          .join(',') + '}';
      }
      return String(v);
    };

    // Step 1: Deep flatten all rows — converts nested objects to dot-notation keys
    const flattenRow = (obj: Record<string, unknown>, prefix = ''): Record<string, unknown> => {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
          // Recursively flatten plain objects
          Object.assign(result, flattenRow(val as Record<string, unknown>, fullKey));
        } else if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object' && val[0] !== null) {
          // Array of objects: flatten each object, serialize compactly
          // Use pipe-separated objects with space-separated values
          const subKeys = Object.keys(val[0] as Record<string, unknown>);
          result[fullKey] = val.map((item: unknown) => {
            if (typeof item === 'object' && item !== null) {
              return subKeys.map(sk => {
                const v = (item as Record<string, unknown>)[sk];
                return serializeVal(v);
              }).join(' ');
            }
            return serializeVal(item);
          }).join('|');
          // Store sub-schema for this array field
          if (!result[`${fullKey}@`]) {
            result[`${fullKey}@`] = subKeys.join(' ');
          }
        } else {
          result[fullKey] = val;
        }
      }
      return result;
    };

    const flatRows = rows.map(r => flattenRow(r));

    // Collect all unique keys across all flattened rows (to handle sparse data)
    const allKeys = new Set<string>();
    for (const row of flatRows) {
      for (const key of Object.keys(row)) {
        if (!key.endsWith('@')) allKeys.add(key); // Skip sub-schema keys
      }
    }
    const keys = Array.from(allKeys);

    // Step 1c: Field name compression — shorten to shortest unique prefix
    // e.g. customer_shipping_address → shipping, customer_billing_address → billing
    const fieldCompression = compressFieldNames(keys);
    const shortKeys = keys.map(k => fieldCompression.get(k) ?? k);
    // Build reverse map for header (compressed names)
    // Only emit @f mapping line if any key was actually shortened
    const anyCompressed = keys.some((k, i) => shortKeys[i] !== k && shortKeys[i].length < k.length);

    // Step 1d: Sparsity detection — count null/undefined/empty cells
    let nullCells = 0;
    const totalCells = flatRows.length * keys.length;
    for (const row of flatRows) {
      for (const k of keys) {
        const val = row[k];
        if (val === null || val === undefined || val === '') nullCells++;
      }
    }
    const sparsityRatio = totalCells > 0 ? nullCells / totalCells : 0;

    // Step 2: Build dictionary — collect all string AND numeric values and their frequencies
    const valueCounts = new Map<string, number>();
    for (const row of flatRows) {
      for (const k of keys) {
        const val = row[k];
        if (typeof val === 'string' && val.length > 1) {
          valueCounts.set(val, (valueCounts.get(val) || 0) + 1);
        }
        // Also track repeated numbers — their string representations can be dictionary-compressed
        if (typeof val === 'number') {
          const numStr = Number.isInteger(val) ? String(val) : String(val);
          if (numStr.length > 2) { // Only worth dict-encoding if 3+ chars (e.g. "100", "3.14")
            valueCounts.set(numStr, (valueCounts.get(numStr) || 0) + 1);
          }
        }
        if (Array.isArray(val)) {
          for (const elem of val) {
            if (typeof elem === 'string' && elem.length > 1) {
              valueCounts.set(elem, (valueCounts.get(elem) || 0) + 1);
            }
          }
        }
      }
    }

    // Dictionary-encode strings appearing 2+ times
    // Sort by (frequency × length) for maximum token savings
    // Also force-add strings that look like dictionary references (@0, @1, ...)
    // to avoid ambiguity — without this, a literal "@0" value would be
    // indistinguishable from a dictionary reference to index 0.
    const dictionary: string[] = [];
    const dictMap = new Map<string, number>();
    const candidates = [...valueCounts.entries()]
      .filter(([val, count]) => {
        // Always include strings that look like dictionary refs to avoid ambiguity
        if (/^@\d+$/.test(val)) return true;
        return count >= 2 && val.length > 1;
      })
      .sort((a, b) => (b[1] * b[0].length) - (a[1] * a[0].length));
    for (const [val] of candidates) {
      dictMap.set(val, dictionary.length);
      dictionary.push(val);
    }

    // Step 3: Value formatter with dictionary lookup + integer shortening
    const formatVal = (val: unknown): string => {
      if (val === null || val === undefined) return '_';
      if (val === true) return 'T';
      if (val === false) return 'F';
      if (typeof val === 'string') {
        if (val.length === 0) return '_';
        const dictIdx = dictMap.get(val);
        if (dictIdx !== undefined) return `@${dictIdx}`;
        if (val.includes('\t') || val.includes('\n')) {
          return val.replace(/\t/g, '\\t').replace(/\n/g, '\\n');
        }
        // Safety: if a string looks like a dictionary reference but wasn't
        // dictionary-encoded (should not happen with force-add above, but
        // belt-and-suspenders), escape the leading @
        if (/^@\d+$/.test(val)) return `\\${val}`;
        return val;
      }
      if (typeof val === 'number') {
        // Integer shortening: 42.0 → "42", but 3.14 stays "3.14"
        const numStr = Number.isInteger(val) ? String(val) : String(val);
        // Check dictionary for repeated numbers
        const dictIdx = dictMap.get(numStr);
        if (dictIdx !== undefined) return `@${dictIdx}`;
        return numStr;
      }
      if (Array.isArray(val)) {
        return val.map(formatVal).join(' ');
      }
      if (typeof val === 'object') return JSON.stringify(val);
      return String(val);
    };

    // Step 4: Build output — choose dense vs sparse mode
    const lines: string[] = [];

    if (sparsityRatio > 0.5) {
      // SPARSE MODE: Only emit non-null values with column index prefix
      // Format: @sparse\nheader\n[@f mapping]\n[@d dict]\ncol:val\tcol:val ...
      lines.push('@sparse');
      lines.push(shortKeys.join('\t'));

      // Field name mapping (if compression was applied)
      if (anyCompressed) {
        const mapping = keys.map((k, i) => shortKeys[i] !== k ? `${shortKeys[i]}=${k}` : '').filter(Boolean);
        if (mapping.length > 0) lines.push('@f\t' + mapping.join('\t'));
      }

      if (dictionary.length > 0) {
        lines.push('@d\t' + dictionary.join('\t'));
      }

      for (const row of flatRows) {
        const parts: string[] = [];
        for (let i = 0; i < keys.length; i++) {
          const val = row[keys[i]];
          if (val !== null && val !== undefined && val !== '') {
            parts.push(`${i}:${formatVal(val)}`);
          }
        }
        lines.push(parts.join('\t'));
      }
    } else {
      // DENSE MODE: Standard contex compact format
      // Header: compressed field names (tab-separated)
      lines.push(shortKeys.join('\t'));

      // Field name mapping (if compression was applied)
      if (anyCompressed) {
        const mapping = keys.map((k, i) => shortKeys[i] !== k ? `${shortKeys[i]}=${k}` : '').filter(Boolean);
        if (mapping.length > 0) lines.push('@f\t' + mapping.join('\t'));
      }

      // Dictionary (if any repeated values)
      if (dictionary.length > 0) {
        lines.push('@d\t' + dictionary.join('\t'));
      }

      // Data rows: tab-separated values in schema order
      for (const row of flatRows) {
        const vals = keys.map((k) => formatVal(row[k]));
        lines.push(vals.join('\t'));
      }
    }

    return lines.join('\n');
  }

  if (format === 'tens-text') {
    return cachedTensTextEncoder.encode(rows);
  }

  if (format === 'tens' || format === 'tokens') {
    // These are non-text formats handled specially by the engine
    return `__${format.toUpperCase()}_DATA__`;
  }

  // Default: minified JSON
  return JSON.stringify(rows);
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
export function analyzeFormats(data: unknown[]): FormatAnalysis[] {
  const formats: OutputFormat[] = ['json', 'csv', 'markdown', 'toon', 'tens-text', 'contex'];
  return formats.map((format) => {
    const output = formatOutput(data, format);
    return {
      format,
      byteSize: cachedByteEncoder.encode(output).length,
      output,
    };
  });
}
