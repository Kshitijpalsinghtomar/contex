import { TokenizerManager } from './tokenizer.js';
import {
  ARRAY_LEN_BASE,
  CTRL,
  DICT_REF_BASE,
  MASK_CHUNK_BASE,
  MASK_CHUNK_BITS,
  TENS_MAGIC,
  TENS_VERSION,
} from './types.js';
import type { TensSchema, TokenId, TokenStream, TokenizerEncoding } from './types.js';

/**
 * TENS v2 Token Stream Decoder.
 *
 * Reconstructs JavaScript objects from a TENS binary token stream.
 * Supports all Phase 2 optimizations:
 * - Recursive Flattening (Output is flattened; use unflattenObject() to restore)
 * - Schema Unification
 * - Value Dictionaries
 * - Presence Masks
 * - Fixed Arrays
 */
export class TokenStreamDecoder {
  private tokenizer: TokenizerManager;
  private buffer: Uint8Array = new Uint8Array(0);
  private view: DataView = new DataView(new ArrayBuffer(0));
  private offset = 0;
  private encoding: TokenizerEncoding = 'cl100k_base';
  private schemas: TensSchema[] = [];
  private dictionary = new Map<number, string>(); // ID -> Value

  constructor() {
    this.tokenizer = new TokenizerManager();
  }

  /**
   * Decode a TENS v2 binary buffer back into an array of objects.
   */
  decode(buffer: Uint8Array): unknown[] {
    this.buffer = buffer;
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.offset = 0;
    this.schemas = [];
    this.dictionary.clear();

    this.readHeader();
    const tokenStream = this.readTokenStream();
    return this.processTokens(tokenStream);
  }

  private readHeader() {
    const magic = [0x54, 0x45, 0x4e, 0x53];
    for (let i = 0; i < magic.length; i++) {
      if (this.buffer[this.offset++] !== magic[i]) {
        throw new Error('Invalid TENS magic bytes');
      }
    }

    const version = this.buffer[this.offset++];
    if (version !== TENS_VERSION) {
      throw new Error(`Unsupported TENS version: ${version} (expected ${TENS_VERSION})`);
    }

    const encodingLen = this.buffer[this.offset++];
    const encodingBytes = this.buffer.subarray(this.offset, this.offset + encodingLen);
    this.offset += encodingLen;
    this.encoding = new TextDecoder().decode(encodingBytes) as TokenizerEncoding;

    // Skip token count (4 bytes)
    this.offset += 4;
  }

  private readTokenStream(): TokenStream {
    const stream: TokenStream = [];
    const tokenBytes = this.buffer.byteLength - this.offset;
    const count = tokenBytes / 4;

    for (let i = 0; i < count; i++) {
      stream.push(this.view.getUint32(this.offset, true));
      this.offset += 4;
    }
    return stream;
  }

  private processTokens(tokens: TokenStream): unknown[] {
    const rows: unknown[] = [];
    let ptr = 0;

    // --- 1. Read Definitions (Dictionary & Schemas) ---
    while (ptr < tokens.length) {
      const token = tokens[ptr];

      if (token === CTRL.DICT_DEF) {
        ptr++; // Skip DEF

        // Read ID (terminated by SEPARATOR)
        const idResult = this.readLiteral(tokens, ptr);
        const idStr = idResult.value as string; // Tokenizer always returns string for literal, we parse int
        const id = Number.parseInt(idStr, 10);
        ptr = idResult.newPtr;

        if (tokens[ptr] === CTRL.SEPARATOR) ptr++; // Consume SEP after ID

        // Read Value (terminated by SEPARATOR)
        const valResult = this.readLiteral(tokens, ptr);
        const val = valResult.value as string;
        ptr = valResult.newPtr;

        if (tokens[ptr] === CTRL.SEPARATOR) ptr++; // Consume SEP after Value

        this.dictionary.set(id, val);
      } else if (token === CTRL.SCHEMA_DEF) {
        ptr++; // Skip DEF
        const fields: string[] = [];

        while (ptr < tokens.length) {
          const t = tokens[ptr];
          if (this.isCtrl(t) && t !== CTRL.SEPARATOR) {
            break; // End of schema def (hit next DEF or ROW_BREAK etc)
          }

          const res = this.readLiteral(tokens, ptr);
          fields.push(res.value as string);
          ptr = res.newPtr;

          if (tokens[ptr] === CTRL.SEPARATOR) {
            ptr++;
          }
        }

        this.schemas.push({
          id: this.schemas.length,
          fields,
          fieldTypes: Array(fields.length).fill('string'), // Types implied by usage
        });
      } else {
        // Not a definition -> Start of Data
        break;
      }
    }

    // --- 2. Read Rows ---
    const defaultSchema = this.schemas.length > 0 ? this.schemas[0] : undefined;

    while (ptr < tokens.length) {
      const token = tokens[ptr];

      if (token === CTRL.ROW_BREAK) {
        ptr++;
        // ROW_BREAK is just a separator/delimiter.
        // We consume it and let the loop handle the next token (Mask or Data).
        continue;
      } else if (token === CTRL.PRESENCE_MASK) {
        ptr++;
        if (!defaultSchema) throw new Error('PRESENCE_MASK but no default schema');
        const res = this.readMaskedRow(tokens, ptr, defaultSchema);
        rows.push(res.row);
        ptr = res.newPtr;
      } else if (token === CTRL.SCHEMA_REF) {
        ptr++;
        const schemaId = tokens[ptr++]; // Schema ID is passed as raw token (not tokenized string)
        // Wait, encoder pushes row.schemaId (number). This fits in token stream if < 4B.
        // It's technically "CTRL" range if > 200k? No, schema ID is 0, 1, 2...
        const schema = this.schemas[schemaId];
        if (!schema) throw new Error(`Unknown Schema ID ${schemaId}`);

        if (tokens[ptr++] !== CTRL.OBJ_START)
          throw new Error('Expected OBJ_START after SCHEMA_REF');

        const res = this.readDelimitedRow(tokens, ptr, schema);
        rows.push(res.row);
        ptr = res.newPtr;
      } else {
        // Implicit start of first row in single-schema mode?
        if (defaultSchema && (!this.isCtrl(token) || this.isValueToken(token))) {
          const res = this.readPositionalRow(tokens, ptr, defaultSchema);
          rows.push(res.row);
          ptr = res.newPtr;
        } else {
          // Probably padding or end of stream or known CTRL like OBJ_END (shouldn't be here)
          ptr++;
        }
      }
    }

    return rows;
  }

  private readPositionalRow(
    tokens: TokenStream,
    ptr: number,
    schema: TensSchema,
  ): { row: any; newPtr: number } {
    const row: any = {};

    for (let i = 0; i < schema.fields.length; i++) {
      const field = schema.fields[i];
      const res = this.readValue(tokens, ptr);

      row[field] = res.value;
      ptr = res.newPtr;

      if (i < schema.fields.length - 1) {
        if (tokens[ptr] === CTRL.SEPARATOR) ptr++;
      }
    }
    return { row, newPtr: ptr };
  }

  private readMaskedRow(
    tokens: TokenStream,
    ptr: number,
    schema: TensSchema,
  ): { row: any; newPtr: number } {
    const fieldCount = schema.fields.length;
    const chunkCount = Math.ceil(fieldCount / MASK_CHUNK_BITS);
    const presentFields: boolean[] = [];

    // Read chunks
    for (let c = 0; c < chunkCount; c++) {
      const chunkToken = tokens[ptr++];
      const bits = chunkToken - MASK_CHUNK_BASE;
      for (let b = 0; b < MASK_CHUNK_BITS; b++) {
        if (presentFields.length < fieldCount) {
          presentFields.push(!!(bits & (1 << b)));
        }
      }
    }

    const row: any = {};
    const presentCount = presentFields.filter((p) => p).length;
    let readCount = 0;

    for (let i = 0; i < fieldCount; i++) {
      const field = schema.fields[i];
      if (presentFields[i]) {
        const res = this.readValue(tokens, ptr);
        row[field] = res.value;
        ptr = res.newPtr;
        readCount++;

        // Consume separator if not last *present* value
        if (readCount < presentCount) {
          if (tokens[ptr] === CTRL.SEPARATOR) ptr++;
        }
      } else {
        row[field] = null;
      }
    }
    return { row, newPtr: ptr };
  }

  private readDelimitedRow(
    tokens: TokenStream,
    ptr: number,
    schema: TensSchema,
  ): { row: any; newPtr: number } {
    const row: any = {};
    for (let i = 0; i < schema.fields.length; i++) {
      const field = schema.fields[i];
      const res = this.readValue(tokens, ptr);
      row[field] = res.value;
      ptr = res.newPtr;

      if (tokens[ptr] === CTRL.SEPARATOR) {
        ptr++;
      }
    }
    if (tokens[ptr] === CTRL.OBJ_END) ptr++;
    return { row, newPtr: ptr };
  }

  private readValue(tokens: TokenStream, ptr: number): { value: any; newPtr: number } {
    const token = tokens[ptr];

    if (token === CTRL.NULL_VAL) return { value: null, newPtr: ptr + 1 };
    if (token === CTRL.BOOL_TRUE) return { value: true, newPtr: ptr + 1 };
    if (token === CTRL.BOOL_FALSE) return { value: false, newPtr: ptr + 1 };

    if (token === CTRL.FIXED_ARRAY) {
      ptr++;
      const lenToken = tokens[ptr++];
      const len = lenToken - ARRAY_LEN_BASE;
      const arr = [];
      for (let i = 0; i < len; i++) {
        const res = this.readValue(tokens, ptr);
        arr.push(res.value);
        ptr = res.newPtr;
        // Arrays also use separators
        if (i < len - 1) {
          if (tokens[ptr] === CTRL.SEPARATOR) ptr++;
        }
      }
      return { value: arr, newPtr: ptr };
    }

    if (token >= DICT_REF_BASE && token < DICT_REF_BASE + 100000) {
      const id = token - DICT_REF_BASE;
      const val = this.dictionary.get(id);
      return { value: val, newPtr: ptr + 1 };
    }

    // Literal (string/number)
    return this.readLiteral(tokens, ptr);
  }

  // Reads a sequence of tokens until SEPARATOR or CTRL, returns detokenized string
  private readLiteral(tokens: TokenStream, ptr: number): { value: unknown; newPtr: number } {
    const literalTokens: TokenStream = [];
    while (ptr < tokens.length && !this.isCtrl(tokens[ptr])) {
      literalTokens.push(tokens[ptr++]);
    }
    const str = this.tokenizer.detokenize(literalTokens, this.encoding);

    // Try to infer type?
    // Encoder sends numbers as strings.
    // We can try parsing as number if it looks like one.
    // Or just return string.
    // For round-trip exactness, "123" input string vs 123 input number is lost?
    // Encoder: `tokenize(String(value))` for numbers.
    // So strict type is lost unless schema stores it.
    // Current v2 Schema Def doesn't transmit type!
    // So everything comes back as string (or null/bool).
    // This is a known limitation of current TENS v2 (like CSV).
    // We can try to guess:
    const num = Number(str);
    if (!isNaN(num) && str.trim() !== '') {
      return { value: num, newPtr: ptr };
    }
    return { value: str, newPtr: ptr };
  }

  private isValueToken(token: number): boolean {
    // Explicitly allowed value-starting control tokens
    if (token === CTRL.NULL_VAL) return true;
    if (token === CTRL.BOOL_TRUE) return true;
    if (token === CTRL.BOOL_FALSE) return true;
    if (token === CTRL.ARR_START) return true;
    if (token === CTRL.OBJ_START) return true;
    if (token === CTRL.FIXED_ARRAY) return true;
    return false;
  }

  private isCtrl(token: number): boolean {
    // CTRL range 200000-299999
    // Also MASK_CHUNK_BASE 300000+, ARRAY_LEN_BASE 400000+, DICT_REF 500000+
    // But for "End of Literal", we care about Separators, Row Breaks, etc.
    // SEPARATOR is 200xxx.
    if (token >= 200000 && token <= 299999) return true;
    return false;
  }

  /** Dispose of tokenizer resources. */
  dispose(): void {
    this.tokenizer.dispose();
  }
}
