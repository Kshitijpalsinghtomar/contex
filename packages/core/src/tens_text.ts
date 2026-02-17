// ============================================================================
// @contex/core — TENS-Text: Human-Readable TENS Representation
// ============================================================================
//
// TENS-Text is a human-readable text format that maps 1:1 to TENS binary data.
// It uses an indentation-based, field-per-line syntax with @-directives for
// structural metadata.
//
// File extension: .tens
// Specification:  docs/tens-specification.md §6.3
//
// ─── LEXICAL GRAMMAR ───────────────────────────────────────────────────────
//
//   IDENT         = LETTER { LETTER | DIGIT | "_" }
//   LETTER        = "a"..."z" | "A"..."Z" | "_"
//   DIGIT         = "0"..."9"
//   NUMBER        = ["-"] DIGIT { DIGIT } ["." DIGIT { DIGIT }]
//   BOOLEAN       = "true" | "false"
//   NULL          = "_"
//   DICT_REF      = "@" DIGIT { DIGIT }
//   BARE_STRING   = IDENT            (no whitespace / special chars)
//   QUOTED_STRING = '"' { CHAR | ESCAPE } '"'
//   ESCAPE        = "\\" ( '"' | "\\" | "n" | "r" | "t" )
//   INDENT        = "  "             (2 spaces, semantic)
//   NL            = "\n" | "\r\n"    (normalized to \n on output)
//   WS            = " " { " " }
//
// ─── SYNTACTIC GRAMMAR (EBNF) ──────────────────────────────────────────────
//
//   file          = { directive } { record }
//
//   directive     = version | encoding | schema | dict
//   version       = "@version" WS NUMBER NL
//   encoding      = "@encoding" WS IDENT NL
//   schema        = "@schema" WS IDENT WS field_def { WS field_def } NL
//   field_def     = IDENT ":" type
//   type          = base_type [ "[]" ] [ "?" ]
//   base_type     = "str" | "num" | "bool"
//   dict          = "@dict" WS value { WS value } NL
//
//   record        = IDENT NL { field_line }
//   field_line    = INDENT IDENT WS value NL
//
//   value         = NUMBER | BOOLEAN | NULL | DICT_REF
//                 | BARE_STRING | QUOTED_STRING
//
// ─── ARRAY ASSEMBLY ────────────────────────────────────────────────────────
//
//   Implicit via field repetition. If the same field name appears
//   multiple times in a record, values are collected into an array.
//   e.g.  tag scenic\n  tag alpine  →  tag: ["scenic", "alpine"]
//   Schema marks array fields with [] suffix (e.g. tag:str[])
//
// ─── IMPLEMENTATION PIPELINE ───────────────────────────────────────────────
//
//   Encoder:  Objects → ANALYZE (keys, types) → DICT (freq ≥ 2) → EMIT
//   Decoder:  Text → LEX (lines) → PARSE (directives, records) → RESOLVE
//
// ─── ERROR HANDLING ────────────────────────────────────────────────────────
//
//   Missing @version/@encoding  → defaults (1, o200k_base)
//   Out-of-range @N ref         → null
//   Missing optional field      → null
//   Extra blank lines           → skipped
//   Unknown directive           → skipped (forward compatibility)
//
// ─── DESIGN PRINCIPLES ────────────────────────────────────────────────────
//
//   - No brackets, no commas, no exotic operators
//   - Grammar simpler than YAML, more deterministic than JSON
//   - Schema defined once, fields in canonical order
//   - Dictionary compression visible and inspectable
//   - 1:1 lossless roundtrip with TENS binary data model
//   - Type-directed parsing: str-typed fields stay strings
//   - No comments supported (preserves canonical invariant)
//   - Self-contained: no imports, no external references
//
// ============================================================================

import type { TensType, TokenizerEncoding } from './types.js';

// ============================================================================
// Types
// ============================================================================

/** A parsed TENS-Text schema definition. */
export interface TensTextSchema {
  name: string;
  fields: { name: string; type: TensType; optional: boolean; isArray: boolean }[];
}

/** A parsed TENS-Text row. */
export interface TensTextRow {
  rowNum: number;
  /** Map of field name → raw value(s). Repeated fields form arrays. */
  fields: Map<string, unknown>;
}

/** A complete parsed TENS-Text document. */
export interface TensTextDocument {
  version: number;
  encoding: TokenizerEncoding;
  schemas: TensTextSchema[];
  dictionary: string[];
  rows: TensTextRow[];
}

// ============================================================================
// Constants
// ============================================================================

const TENS_TEXT_VERSION = 1;
const INDENT = '  '; // 2-space indent for field values

// ============================================================================
// Encoder: Structured Data → TENS-Text String
// ============================================================================

/**
 * Encodes structured data into TENS-Text format.
 *
 * @example
 * ```ts
 * const encoder = new TensTextEncoder('o200k_base');
 * const text = encoder.encode([
 *   { id: 1, name: 'Alice', role: 'admin' },
 *   { id: 2, name: 'Bob', role: 'user' },
 * ]);
 * // Output:
 * // @version 1
 * // @encoding o200k_base
 * // @schema data id:num name:str role:str
 * //
 * // @dict admin user
 * //
 * // data
 * //   id 1
 * //   name Alice
 * //   role @0
 * // data
 * //   id 2
 * //   name Bob
 * //   role @1
 * ```
 */
export class TensTextEncoder {
  private encoding: TokenizerEncoding;

  constructor(encoding: TokenizerEncoding = 'o200k_base') {
    this.encoding = encoding;
  }

  /**
   * Encode an array of objects into TENS-Text format.
   * @param data - Array of uniform objects
   * @param schemaName - Optional name for the schema (default: 'data')
   * @returns TENS-Text formatted string
   */
  encode(data: Record<string, unknown>[], schemaName = 'data'): string {
    if (data.length === 0) {
      return `@version ${TENS_TEXT_VERSION}\n@encoding ${this.encoding}\n@schema ${schemaName}\n`;
    }

    const lines: string[] = [];

    // ---- Header ----
    lines.push(`@version ${TENS_TEXT_VERSION}`);
    lines.push(`@encoding ${this.encoding}`);

    // ---- Schema Analysis ----
    const allKeys = new Set<string>();
    const arrayFields = new Set<string>(); // fields that contain arrays
    for (const row of data) {
      if (row && typeof row === 'object' && !Array.isArray(row)) {
        for (const key of Object.keys(row)) {
          allKeys.add(key);
          if (Array.isArray(row[key])) {
            arrayFields.add(key);
          }
        }
      }
    }
    const fields = Array.from(allKeys);

    // Determine field types and optionality
    const fieldInfo = fields.map((field) => {
      let type: TensType = 'null';
      let hasNull = false;
      let hasValue = false;

      for (const row of data) {
        const val = row?.[field];
        if (val === null || val === undefined) {
          hasNull = true;
          continue;
        }
        hasValue = true;
        if (Array.isArray(val)) {
          // Array fields: infer element type
          for (const elem of val) {
            const t = inferFieldType(elem);
            if (type === 'null') type = t;
            else if (type !== t) type = 'string';
          }
        } else {
          const t = inferFieldType(val);
          if (type === 'null') {
            type = t;
          } else if (type !== t) {
            type = 'string'; // Mixed types → string
          }
        }
      }

      return {
        name: field,
        type: hasValue ? type : 'string',
        optional: hasNull,
        isArray: arrayFields.has(field),
      };
    });

    // ---- Schema Definition ----
    // Array fields are marked with [] suffix on the type (e.g. tag:str[])
    const schemaFields = fieldInfo
      .map(
        (f) =>
          `${f.name}:${mapTypeToShort(f.type)}${f.isArray ? '[]' : ''}${f.optional ? '?' : ''}`,
      )
      .join(' ');
    lines.push(`@schema ${schemaName} ${schemaFields}`);

    // ---- Dictionary Building ----
    const valueCounts = new Map<string, number>();
    for (const row of data) {
      for (const field of fields) {
        const val = row?.[field];
        if (typeof val === 'string') {
          valueCounts.set(val, (valueCounts.get(val) || 0) + 1);
        }
        if (Array.isArray(val)) {
          for (const elem of val) {
            if (typeof elem === 'string') {
              valueCounts.set(elem, (valueCounts.get(elem) || 0) + 1);
            }
          }
        }
      }
    }

    // Only dictionary-encode strings that appear 2+ times
    const dictionary: string[] = [];
    const dictIndex = new Map<string, number>();
    for (const [val, count] of valueCounts.entries()) {
      if (count >= 2 && val.length > 0) {
        dictIndex.set(val, dictionary.length);
        dictionary.push(val);
      }
    }

    if (dictionary.length > 0) {
      lines.push('');
      const dictEntries = dictionary.map((v) => quoteIfNeeded(v)).join(' ');
      lines.push(`@dict ${dictEntries}`);
    }

    // ---- Data Records ----
    lines.push('');
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      lines.push(schemaName);
      for (const fi of fieldInfo) {
        const val = row?.[fi.name];
        if (fi.isArray && Array.isArray(val)) {
          // Arrays: emit each element as a repeated field line
          if (val.length === 0) {
            // Empty array → no field lines emitted (field is simply absent)
            // But we need to know it was an empty array, not null.
            // We use a special marker: field with no value
            // Actually — per grammar, zero repetitions = empty array.
            // No lines emitted. The decoder knows it's an array field
            // from the schema or from prior records.
          } else {
            for (const elem of val) {
              const formatted = formatScalarValue(elem, dictIndex);
              lines.push(`${INDENT}${fi.name} ${formatted}`);
            }
          }
        } else {
          // Scalar value
          const formatted = formatScalarValue(val, dictIndex);
          lines.push(`${INDENT}${fi.name} ${formatted}`);
        }
      }
    }

    return `${lines.join('\n')}\n`;
  }
}

// ============================================================================
// Decoder: TENS-Text String → Structured Data
// ============================================================================

/**
 * Decodes TENS-Text format back into structured data.
 *
 * @example
 * ```ts
 * const decoder = new TensTextDecoder();
 * const result = decoder.decode(tensTextString);
 * // result.data → [{ id: 1, name: 'Alice', role: 'admin' }, ...]
 * ```
 */
export class TensTextDecoder {
  /**
   * Decode a TENS-Text string into structured data.
   * @param text - TENS-Text formatted string
   * @returns Decoded document with data, schemas, and metadata
   */
  decode(text: string): { data: Record<string, unknown>[]; document: TensTextDocument } {
    const lines = text.split('\n');

    let version = TENS_TEXT_VERSION;
    let encoding: TokenizerEncoding = 'o200k_base';
    const schemas: TensTextSchema[] = [];
    const dictionary: string[] = [];
    const rows: TensTextRow[] = [];

    // Track which fields are array fields (from schema or observed)
    const arrayFieldSet = new Set<string>();

    // Current record being parsed
    let currentRow: TensTextRow | null = null;
    let rowCounter = 0;

    // First pass: collect directives and detect schema names
    const schemaNames = new Set<string>();

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;

      // ---- @version ----
      if (trimmed.startsWith('@version ')) {
        version = Number.parseInt(trimmed.substring(9).trim(), 10);
        continue;
      }

      // ---- @encoding ----
      if (trimmed.startsWith('@encoding ')) {
        encoding = trimmed.substring(10).trim() as TokenizerEncoding;
        continue;
      }

      // ---- @schema ----
      if (trimmed.startsWith('@schema ')) {
        const schema = parseSchemaLine(trimmed);
        if (schema) {
          schemas.push(schema);
          schemaNames.add(schema.name);
          // Collect array fields from schema
          for (const field of schema.fields) {
            if (field.isArray) arrayFieldSet.add(field.name);
          }
        }
        continue;
      }

      // ---- @dict ----
      if (trimmed.startsWith('@dict ')) {
        const entries = parseDictLine(trimmed);
        dictionary.push(...entries);
        continue;
      }

      // ---- Record marker (IDENT that matches a schema name) ----
      if (
        !line.startsWith(' ') &&
        !line.startsWith('\t') &&
        !trimmed.startsWith('@') &&
        !trimmed.startsWith('#')
      ) {
        // This is a record marker if it matches a schema name,
        // or if we have no schemas, treat any bare IDENT as a record marker
        const isRecordMarker = schemaNames.size === 0 || schemaNames.has(trimmed);

        // Also support legacy #N format for backward compat
        const isLegacyRow = /^#\d+/.test(trimmed);

        if (isRecordMarker || isLegacyRow) {
          // Save previous row
          if (currentRow) rows.push(currentRow);
          rowCounter++;
          currentRow = { rowNum: rowCounter, fields: new Map() };
          continue;
        }
      }

      // ---- Indented field value ----
      if (currentRow && (line.startsWith(INDENT) || line.startsWith('\t'))) {
        const fieldLine = trimmed;
        const spaceIdx = fieldLine.indexOf(' ');
        if (spaceIdx > 0) {
          const fieldName = fieldLine.substring(0, spaceIdx);
          const rawValue = fieldLine.substring(spaceIdx + 1);

          // Check if this field already exists in the current record
          if (currentRow.fields.has(fieldName)) {
            // Repeated field → array semantics
            const existing = currentRow.fields.get(fieldName);
            if (Array.isArray(existing)) {
              existing.push(rawValue);
            } else {
              // Convert existing scalar to array
              currentRow.fields.set(fieldName, [existing, rawValue]);
            }
            arrayFieldSet.add(fieldName);
          } else {
            currentRow.fields.set(fieldName, rawValue);
          }
        }
      }
    }

    // Don't forget the last row
    if (currentRow) rows.push(currentRow);

    // ---- Identify array fields from schema + observation ----
    // A field is an array field if:
    // 1. Schema marks it with [] suffix (e.g. tag:str[])
    // 2. OR it was observed repeated in any record during parsing

    // ---- Reconstruct Objects ----
    const currentSchema = schemas[0];
    const data: Record<string, unknown>[] = [];

    for (const row of rows) {
      const obj: Record<string, unknown> = {};
      if (currentSchema) {
        for (const field of currentSchema.fields) {
          const rawVal = row.fields.get(field.name);
          const isArr = field.isArray || arrayFieldSet.has(field.name);
          if (rawVal === undefined) {
            // Field not present in this record
            if (isArr) {
              obj[field.name] = []; // Missing array field → empty array
            } else {
              obj[field.name] = field.optional ? null : undefined;
            }
          } else if (Array.isArray(rawVal)) {
            // Repeated field → resolve each element
            obj[field.name] = rawVal.map((v) =>
              resolveValue(typeof v === 'string' ? v : String(v), field.type, dictionary),
            );
          } else if (isArr) {
            // Single occurrence of an array field → wrap in array
            obj[field.name] = [
              resolveValue(
                typeof rawVal === 'string' ? rawVal : String(rawVal),
                field.type,
                dictionary,
              ),
            ];
          } else {
            obj[field.name] = resolveValue(
              typeof rawVal === 'string' ? rawVal : String(rawVal),
              field.type,
              dictionary,
            );
          }
        }
      } else {
        // No schema — use field names from the row itself
        for (const [key, val] of row.fields.entries()) {
          const isArr = arrayFieldSet.has(key);
          if (Array.isArray(val)) {
            obj[key] = val.map((v) =>
              resolveValue(typeof v === 'string' ? v : String(v), 'string', dictionary),
            );
          } else if (isArr) {
            obj[key] = [
              resolveValue(typeof val === 'string' ? val : String(val), 'string', dictionary),
            ];
          } else {
            obj[key] = resolveValue(
              typeof val === 'string' ? val : String(val),
              'string',
              dictionary,
            );
          }
        }
      }
      data.push(obj);
    }

    const document: TensTextDocument = {
      version,
      encoding,
      schemas,
      dictionary,
      rows,
    };

    return { data, document };
  }
}

// ============================================================================
// Internal Helpers
// ============================================================================

/** Map full TensType to short type names for schema definitions. */
function mapTypeToShort(type: TensType): string {
  switch (type) {
    case 'number':
      return 'num';
    case 'string':
      return 'str';
    case 'boolean':
      return 'bool';
    case 'null':
      return 'null';
    default:
      return 'str';
  }
}

/** Map short type names back to full TensType. */
function mapShortToType(short: string): TensType {
  switch (short) {
    case 'num':
    case 'int':
    case 'float':
    case 'number':
      return 'number';
    case 'str':
    case 'string':
      return 'string';
    case 'bool':
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    default:
      return 'string';
  }
}

/** Infer the TENS type of a JavaScript value. */
function inferFieldType(val: unknown): TensType {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean') return 'boolean';
  if (typeof val === 'number') return 'number';
  if (typeof val === 'string') return 'string';
  return 'string';
}

/**
 * Format a scalar value for TENS-Text output.
 * No arrays or objects — those are handled at a higher level.
 */
function formatScalarValue(val: unknown, dictIndex: Map<string, number>): string {
  // Null / undefined
  if (val === null || val === undefined) return '_';

  // Boolean
  if (typeof val === 'boolean') return val ? 'true' : 'false';

  // Number — handle edge cases
  if (typeof val === 'number') {
    if (Number.isNaN(val)) return '"NaN"';
    if (!Number.isFinite(val)) return val > 0 ? '"Infinity"' : '"-Infinity"';
    if (Object.is(val, -0)) return '-0';
    return String(val);
  }

  // String — check dictionary first
  if (typeof val === 'string') {
    const idx = dictIndex.get(val);
    if (idx !== undefined) return `@${idx}`;
    return quoteIfNeeded(val);
  }

  // Nested object — serialize as quoted JSON for safety
  if (typeof val === 'object') {
    return `"${escapeString(JSON.stringify(val))}"`;
  }

  return String(val);
}

/**
 * Quote a string value if it contains special characters or could be
 * mistaken for a keyword/number/reference.
 */
function quoteIfNeeded(val: string): string {
  // Must quote if:
  // - empty
  // - contains whitespace, special chars
  // - looks like a keyword, number, null, dict ref, or row marker
  if (
    val.length === 0 ||
    val === '_' ||
    val === 'true' ||
    val === 'false' ||
    /^\@\d+$/.test(val) ||
    /^#\d+$/.test(val) ||
    /^-?\d+(\.\d+)?$/.test(val) ||
    /[\s"\\|>,={}[\]@#]/.test(val) ||
    val.startsWith('@') ||
    val.startsWith('#')
  ) {
    return `"${escapeString(val)}"`;
  }
  return val;
}

/** Escape special characters inside a quoted string. */
function escapeString(val: string): string {
  return val
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/** Unescape a quoted string value. */
function unescapeString(val: string): string {
  let result = '';
  for (let i = 0; i < val.length; i++) {
    if (val[i] === '\\' && i + 1 < val.length) {
      i++;
      switch (val[i]) {
        case '"':
          result += '"';
          break;
        case '\\':
          result += '\\';
          break;
        case 'n':
          result += '\n';
          break;
        case 'r':
          result += '\r';
          break;
        case 't':
          result += '\t';
          break;
        default:
          result += val[i];
          break;
      }
    } else {
      result += val[i];
    }
  }
  return result;
}

/**
 * Parse a @schema line.
 * Format: @schema <name> field1:type field2:type? ...
 */
function parseSchemaLine(line: string): TensTextSchema | null {
  const parts = line.substring(8).trim().split(/\s+/);
  if (parts.length === 0) return null;

  const name = parts[0];
  const fields = parts.slice(1).map((f) => {
    let rest = f;
    // Check for optional suffix
    const optional = rest.endsWith('?');
    if (optional) rest = rest.slice(0, -1);
    // Check for array suffix
    const isArray = rest.endsWith('[]');
    if (isArray) rest = rest.slice(0, -2);
    // Split name:type
    const colonIdx = rest.lastIndexOf(':');
    if (colonIdx === -1) {
      return { name: rest, type: 'string' as TensType, optional, isArray };
    }
    return {
      name: rest.substring(0, colonIdx),
      type: mapShortToType(rest.substring(colonIdx + 1)),
      optional,
      isArray,
    };
  });

  return { name, fields };
}

/**
 * Parse a @dict line.
 * Format: @dict val1 val2 "quoted val" ...
 */
function parseDictLine(line: string): string[] {
  const inner = line.substring(6).trim();
  if (inner.length === 0) return [];

  const entries: string[] = [];
  let i = 0;

  while (i < inner.length) {
    // Skip whitespace
    while (i < inner.length && inner[i] === ' ') i++;
    if (i >= inner.length) break;

    if (inner[i] === '"') {
      // Quoted string
      i++; // skip opening quote
      let val = '';
      while (i < inner.length && inner[i] !== '"') {
        if (inner[i] === '\\' && i + 1 < inner.length) {
          i++;
          switch (inner[i]) {
            case '"':
              val += '"';
              break;
            case '\\':
              val += '\\';
              break;
            case 'n':
              val += '\n';
              break;
            case 'r':
              val += '\r';
              break;
            case 't':
              val += '\t';
              break;
            default:
              val += inner[i];
              break;
          }
        } else {
          val += inner[i];
        }
        i++;
      }
      if (i < inner.length) i++; // skip closing quote
      entries.push(val);
    } else {
      // Unquoted value — read until whitespace
      let val = '';
      while (i < inner.length && inner[i] !== ' ') {
        val += inner[i];
        i++;
      }
      entries.push(val);
    }
  }

  return entries;
}

/**
 * Resolve a raw string value into a typed JavaScript value.
 * Uses type-directed parsing to avoid accidental coercion.
 */
function resolveValue(raw: string, fieldType: TensType, dictionary: string[]): unknown {
  const trimmed = raw.trim();

  // Null
  if (trimmed === '_') return null;

  // Dictionary reference @N
  if (/^@\d+$/.test(trimmed)) {
    const idx = Number.parseInt(trimmed.substring(1), 10);
    return idx < dictionary.length ? dictionary[idx] : null;
  }

  // Quoted string — ALWAYS a string, regardless of fieldType
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return unescapeString(trimmed.slice(1, -1));
  }

  // ---- Type-Directed Resolution ----

  // Boolean (only when field type is bool or auto-detect)
  if (fieldType === 'boolean' || fieldType === 'null') {
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
  }

  // Number (only when field type is number)
  if (fieldType === 'number') {
    if (trimmed === '-0') return -0;
    const num = Number(trimmed);
    if (!Number.isNaN(num)) return num;
  }

  // For string fields, bare values stay as strings
  if (fieldType === 'string') return trimmed;

  // Auto-detect for untyped / null-typed fields
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    if (!Number.isNaN(num)) return num;
  }

  // Bare booleans for auto-detection
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  // Default: string
  return trimmed;
}
