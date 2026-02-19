import { compressFieldNames, flattenObject } from './schema.js';
import { TensTextEncoder } from './tens_text.js';
import type { OutputFormat } from './types.js';

// ── Cached instances (avoid per-call allocation) ────────────────────────────
const cachedTensTextEncoder = new TensTextEncoder();
const cachedByteEncoder = new TextEncoder();

// ── CSV Escape Helper ──────────────────────────────────────────────────────

/** Escape a value for CSV: wrap in quotes if it contains comma, quote, or newline. */
function csvEscape(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

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
    // Flatten nested objects so CSV preserves all data (avoids [object Object])
    const flatRows = rows.map((r) => flattenObject(r));
    // Collect all keys from all rows (flattening can produce different key sets)
    const keySet = new Set<string>();
    for (const r of flatRows) for (const k of Object.keys(r)) keySet.add(k);
    const keys = Array.from(keySet);
    const header = keys.map((k) => csvEscape(k)).join(',');
    const csvRows = flatRows.map((row) =>
      keys
        .map((k) => {
          const val = row[k];
          if (val === null || val === undefined) return '';
          if (Array.isArray(val) || (typeof val === 'object' && val !== null)) {
            return csvEscape(JSON.stringify(val));
          }
          if (typeof val === 'string') return csvEscape(val);
          return String(val);
        })
        .join(','),
    );
    return [header, ...csvRows].join('\n');
  }

  if (format === 'markdown') {
    if (rows.length === 0) return '';
    // Flatten nested objects so Markdown preserves all data (avoids [object Object])
    const flatRows = rows.map((r) => flattenObject(r));
    const keySet = new Set<string>();
    for (const r of flatRows) for (const k of Object.keys(r)) keySet.add(k);
    const keys = Array.from(keySet);
    const header = `| ${keys.join(' | ')} |`;
    const separator = `| ${keys.map(() => '---').join(' | ')} |`;
    const markdownRows = flatRows.map(
      (row) =>
        `| ${keys
          .map((k) => {
            const val = row[k];
            if (val === null || val === undefined) return '';
            let cell: string;
            if (Array.isArray(val) || (typeof val === 'object' && val !== null)) {
              cell = JSON.stringify(val);
            } else {
              cell = String(val);
            }
            // Escape pipe and newline chars that break Markdown table structure
            return cell.replace(/\|/g, '\\|').replace(/\n/g, ' ').replace(/\r/g, '');
          })
          .join(' | ')} |`,
    );
    return [header, separator, ...markdownRows].join('\n');
  }

  if (format === 'toon') {
    // TOON: Tab-separated header + rows
    // Most token-efficient text format for structured data going to LLMs
    if (rows.length === 0) return '';
    const flatRows = rows.map((r) => flattenObject(r));
    const keySet = new Set<string>();
    for (const row of flatRows) for (const k of Object.keys(row)) keySet.add(k);
    const keys = Array.from(keySet);
    const header = keys.join('\t');
    const toonRows = flatRows.map((row) =>
      keys
        .map((k) => {
          const val = (row as Record<string, unknown>)[k];
          if (val === null || val === undefined) return '';
          return String(val);
        })
        .join('\t'),
    );
    return [header, ...toonRows].join('\n');
  }

  if (format === 'contex') {
    // Contex Compact: Ultra-efficient format for LLM context injection
    // - Deep flattening: nested objects → dot-notation keys (readings.value)
    // - Constant column elision: columns identical across all rows → @c preamble
    // - Column-level string prefix compression: shared prefixes stripped → @p preamble
    // - Field name compression: shortest unique prefix (only when net-positive)
    // - Tab-separated header + values (schema declared once)
    // - Dictionary compression for repeated values (cost-benefit gated)
    // - Boolean abbreviation (T/F), Null abbreviation (_), Integer shortening
    // - Array compaction: [a, b, c] → "a b c" (space-separated)
    // - Sparse mode: when >50% of cells are null, emit only non-null values
    // - No brackets, no quotes, no colons, no commas
    if (rows.length === 0) return '';

    // Helper: serialize any value for embedding inside a cell
    // Escapes tabs, newlines, and @N-like strings to prevent structural ambiguity
    const serializeVal = (v: unknown): string => {
      if (v === null || v === undefined) return '_';
      if (v === true) return 'T';
      if (v === false) return 'F';
      if (typeof v === 'string') {
        let s = v;
        if (s.includes('\t') || s.includes('\n')) {
          s = s.replace(/\t/g, '\\t').replace(/\n/g, '\\n');
        }
        // Escape literal @N strings that would be misread as dictionary refs
        if (/^@\d+$/.test(s)) return `\\${s}`;
        return s;
      }
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

    // ── Step 1b: Constant column elision ─────────────────────────────────
    // Detect columns where every row has the identical value (including all-null).
    // These are emitted once as @c key=value and removed from the per-row grid.
    const constantCols = new Map<string, string>();  // key → serialized constant value
    const nRows = flatRows.length;
    for (const key of allKeys) {
      // Serialize the canonical form for comparison (using serializeVal for consistency)
      let isConstant = true;
      const firstVal = flatRows[0][key];
      const firstSerialized = serializeVal(firstVal);
      for (let i = 1; i < nRows; i++) {
        const val = flatRows[i][key];
        if (serializeVal(val) !== firstSerialized) {
          isConstant = false;
          break;
        }
      }
      if (isConstant) {
        constantCols.set(key, firstSerialized);
      }
    }

    // Build the variable-column key list (non-constant columns only)
    const keys: string[] = [];
    for (const key of allKeys) {
      if (!constantCols.has(key)) keys.push(key);
    }

    // ── Step 1c: Template column detection (run FIRST, before prefix compression) ──
    // Detect columns derivable as: prefix + otherCol_value + suffix.
    // Example: comments_url = url + "/comments" → @t entry, column removed from grid.
    // Supports both string and numeric source columns.
    const templateCols = new Map<number, { srcIdx: number; prefix: string; suffix: string }>();
    for (let ci = 0; ci < keys.length; ci++) {
      const k = keys[ci];
      const stringVals: { val: string; rowIdx: number }[] = [];
      for (let ri = 0; ri < nRows; ri++) {
        const v = flatRows[ri][k];
        if (typeof v === 'string' && v.length > 5) stringVals.push({ val: v, rowIdx: ri });
      }
      if (stringVals.length < nRows * 0.7) continue;

      for (let si = 0; si < keys.length; si++) {
        if (si === ci || templateCols.has(si)) continue;
        const sk = keys[si];
        let matched = true;
        let commonPrefix = '';
        let commonSuffix = '';
        let firstChecked = false;

        for (const { val, rowIdx } of stringVals) {
          const rawSrc = flatRows[rowIdx][sk];
          // Support string and numeric source columns
          const srcVal = (typeof rawSrc === 'string' && rawSrc.length >= 2) ? rawSrc
            : (typeof rawSrc === 'number') ? String(rawSrc)
            : null;
          if (!srcVal || srcVal.length < 1) { matched = false; break; }
          const srcPos = val.indexOf(srcVal);
          if (srcPos < 0) { matched = false; break; }
          const pre = val.substring(0, srcPos);
          const suf = val.substring(srcPos + srcVal.length);
          if (!firstChecked) {
            commonPrefix = pre;
            commonSuffix = suf;
            firstChecked = true;
          } else if (pre !== commonPrefix || suf !== commonSuffix) {
            matched = false; break;
          }
        }

        if (matched && firstChecked) {
          const removedChars = stringVals.reduce((sum, { val }) => sum + val.length + 1, 0) + k.length + 1;
          const declCost = k.length + keys[si].length + commonPrefix.length + commonSuffix.length + 10;
          if (removedChars > declCost * 1.5) {
            templateCols.set(ci, { srcIdx: si, prefix: commonPrefix, suffix: commonSuffix });
            break;
          }
        }
      }
    }

    // Remove template columns from the active key list
    const activeKeys: string[] = [];
    const activeKeyOrigIndices: number[] = [];
    for (let ci = 0; ci < keys.length; ci++) {
      if (!templateCols.has(ci)) {
        activeKeyOrigIndices.push(ci);
        activeKeys.push(keys[ci]);
      }
    }

    // ── Step 1c-ii: Column-level string prefix compression ────────────────
    // For each remaining string-dominated column, find the longest common prefix
    // shared by ≥60% of non-null values and factor it out.
    const remappedPrefixes = new Map<number, string>();  // activeIndex → common prefix
    for (let ai = 0; ai < activeKeys.length; ai++) {
      const k = activeKeys[ai];
      const stringVals: string[] = [];
      for (const row of flatRows) {
        const v = row[k];
        if (typeof v === 'string' && v.length > 10) stringVals.push(v);
      }
      if (stringVals.length < nRows * 0.6) continue;

      let prefix = stringVals[0];
      for (let i = 1; i < stringVals.length; i++) {
        while (prefix.length > 0 && !stringVals[i].startsWith(prefix)) {
          prefix = prefix.substring(0, prefix.length - 1);
        }
        if (prefix.length <= 5) break;
      }
      if (prefix.length <= 8) continue;

      const declCost = prefix.length + 6 + String(ai).length;
      const savings = stringVals.length * prefix.length;
      if (savings > declCost * 2) {
        remappedPrefixes.set(ai, prefix);
      }
    }

    // ── Step 1d: Field name compression (conditional) ────────────────────
    // Only emit @f mapping when the header savings exceed the @f line cost
    const fieldCompression = compressFieldNames(activeKeys);
    const shortKeys = activeKeys.map(k => fieldCompression.get(k) ?? k);
    const headerSavings = activeKeys.reduce((sum, k, i) => sum + (k.length - shortKeys[i].length), 0);
    const mappingEntries = activeKeys
      .map((k, i) => (shortKeys[i] !== k && shortKeys[i].length < k.length ? `${shortKeys[i]}=${k}` : ''))
      .filter(Boolean);
    const mappingLineCost = mappingEntries.length > 0 ? 3 + mappingEntries.join('\t').length : 0;
    const useFieldCompression = mappingLineCost > 0 && headerSavings > mappingLineCost;
    const headerKeys = useFieldCompression ? shortKeys : activeKeys;

    // ── Step 1e: Sparsity detection ──────────────────────────────────────
    let nullCells = 0;
    const totalCells = flatRows.length * activeKeys.length;
    for (const row of flatRows) {
      for (const k of activeKeys) {
        const val = row[k];
        if (val === null || val === undefined || val === '') nullCells++;
      }
    }
    const sparsityRatio = totalCells > 0 ? nullCells / totalCells : 0;

    // ── Step 2: Build dictionary (cost-benefit gated) ────────────────────
    const valueCounts = new Map<string, number>();
    for (const row of flatRows) {
      for (let ai = 0; ai < activeKeys.length; ai++) {
        const k = activeKeys[ai];
        const val = row[k];
        const serialized = serializeVal(val);
        if (serialized !== '_' && serialized !== 'T' && serialized !== 'F' && serialized.length > 2) {
          const prefix = remappedPrefixes.get(ai);
          const effective = (prefix && typeof val === 'string' && val.startsWith(prefix))
            ? val.substring(prefix.length)
            : serialized;
          if (effective.length > 2) {
            valueCounts.set(effective, (valueCounts.get(effective) || 0) + 1);
          }
        }
      }
    }

    // Dictionary-encode values appearing 2+ times with positive cost-benefit
    // Sort by (frequency × length) for maximum savings
    // Cap at 10,000 entries to prevent pathological dictionary bloat
    const MAX_DICT_SIZE = 10_000;
    const dictionary: string[] = [];
    const dictMap = new Map<string, number>();
    const maxDictSize = Math.min(valueCounts.size, MAX_DICT_SIZE);
    const candidates: [string, number][] = [...valueCounts.entries()]
      .filter(([val, count]: [string, number]): boolean => {
        if (/^@\d+$/.test(val)) return true;
        const refLen: number = 1 + String(maxDictSize).length;
        const savingsPerRef: number = val.length - refLen;
        const totalSavings: number = count * savingsPerRef;
        const entryCost: number = val.length + 1;
        return count >= 2 && totalSavings > entryCost;
      })
      .sort((a, b) => (b[1] * b[0].length) - (a[1] * a[0].length));
    for (const [val] of candidates) {
      if (dictionary.length >= MAX_DICT_SIZE) break;
      dictMap.set(val, dictionary.length);
      dictionary.push(val);
    }

    // ── Step 3: Value formatter with prefix stripping + dictionary lookup ─
    const formatVal = (val: unknown, colIdx?: number): string => {
      if (val === null || val === undefined) return '_';
      if (val === true) return 'T';
      if (val === false) return 'F';
      if (typeof val === 'string') {
        if (val.length === 0) return '_';
        // Apply column prefix stripping first
        let effective = val;
        if (colIdx !== undefined) {
          const prefix = remappedPrefixes.get(colIdx);
          if (prefix && val.startsWith(prefix)) {
            effective = val.substring(prefix.length);
          }
        }
        const dictIdx = dictMap.get(effective);
        if (dictIdx !== undefined) return `@${dictIdx}`;
        if (effective.includes('\t') || effective.includes('\n')) {
          return effective.replace(/\t/g, '\\t').replace(/\n/g, '\\n');
        }
        if (/^@\d+$/.test(effective)) return `\\${effective}`;
        return effective;
      }
      if (typeof val === 'number') {
        const numStr = Number.isInteger(val) ? String(val) : String(val);
        const dictIdx = dictMap.get(numStr);
        if (dictIdx !== undefined) return `@${dictIdx}`;
        return numStr;
      }
      if (Array.isArray(val)) {
        return val.map(v => formatVal(v)).join(' ');
      }
      if (typeof val === 'object') return JSON.stringify(val);
      return String(val);
    };

    // ── Step 4: Build output ─────────────────────────────────────────────
    const lines: string[] = [];

    // Constant column preamble
    if (constantCols.size > 0) {
      const cParts: string[] = [];
      for (const [k, v] of constantCols) {
        cParts.push(`${k}=${v}`);
      }
      lines.push('@c\t' + cParts.join('\t'));
    }

    // Template column declarations (@t)
    if (templateCols.size > 0) {
      const tParts: string[] = [];
      for (const [ci, tmpl] of templateCols) {
        // Map srcIdx through to activeKeys index for the source column name
        const srcKey = keys[tmpl.srcIdx];
        const colKey = keys[ci];
        tParts.push(`${colKey}=${tmpl.prefix}{${srcKey}}${tmpl.suffix}`);
      }
      lines.push('@t\t' + tParts.join('\t'));
    }

    // Helper: build grouped @p line (columns sharing the same prefix → "c1,c2=prefix")
    const buildGroupedPrefixLine = (): string | null => {
      if (remappedPrefixes.size === 0) return null;
      const byPrefix = new Map<string, number[]>();
      for (const [ai, prefix] of remappedPrefixes) {
        if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
        byPrefix.get(prefix)!.push(ai);
      }
      const pParts: string[] = [];
      for (const [prefix, colIndices] of byPrefix) {
        pParts.push(`${colIndices.join(',')}=${prefix}`);
      }
      return '@p\t' + pParts.join('\t');
    };

    if (sparsityRatio > 0.5) {
      // SPARSE MODE
      lines.push('@sparse');
      lines.push(headerKeys.join('\t'));

      if (useFieldCompression) {
        lines.push('@f\t' + mappingEntries.join('\t'));
      }

      const pLine = buildGroupedPrefixLine();
      if (pLine) lines.push(pLine);

      if (dictionary.length > 0) {
        lines.push('@d\t' + dictionary.join('\t'));
      }

      for (const row of flatRows) {
        const parts: string[] = [];
        for (let i = 0; i < activeKeys.length; i++) {
          const val = row[activeKeys[i]];
          if (val !== null && val !== undefined && val !== '') {
            parts.push(`${i}:${formatVal(val, i)}`);
          }
        }
        lines.push(parts.join('\t'));
      }
    } else {
      // DENSE MODE
      lines.push(headerKeys.join('\t'));

      if (useFieldCompression) {
        lines.push('@f\t' + mappingEntries.join('\t'));
      }

      const pLine = buildGroupedPrefixLine();
      if (pLine) lines.push(pLine);

      if (dictionary.length > 0) {
        lines.push('@d\t' + dictionary.join('\t'));
      }

      for (const row of flatRows) {
        const vals = activeKeys.map((k, i) => formatVal(row[k], i));
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
