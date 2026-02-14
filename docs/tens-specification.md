# TENS Specification

**Token Encoded Native Structure**
Version 2.0 · February 2026

---

## 1. What is TENS?

TENS is a **binary intermediate representation** designed specifically for LLM context pipelines. It is the canonical internal format of the Contex engine.

**TENS is not:**
- A replacement for JSON (JSON is human-readable; TENS is machine-native)
- A general-purpose serialization format (like MessagePack or Protobuf)
- A transport protocol
- A database storage format

**TENS is:**
- A **canonical IR** for structured data flowing into LLM systems
- A **schema-indexed, dictionary-encoded** binary format with deterministic layout
- A **structural deduplication** system that compresses repeated patterns
- The single internal representation from which all output formats (TOON, CSV, Markdown) are generated

### The Core Insight

JSON, MessagePack, Protobuf, CBOR, Avro, and FlatBuffers all solve **serialization**. They optimize for size, speed, or schema evolution.

TENS optimizes for a different problem: **LLM context efficiency**. It provides guarantees that no other format offers simultaneously:

| Guarantee | What It Means | Why It Matters |
|---|---|---|
| **Canonical** | Same data → same bytes, always | Content-addressable caching, deduplication |
| **Schema-indexed** | Object shapes stored once | Eliminates repeated key tokens |
| **Dictionary-encoded** | Strings deduplicated across rows | Reduces repetitive data |
| **Deterministic layout** | Sorted keys, stable ordering | Prefix cache compatibility (vLLM/SGLang) |
| **Multi-tokenizer aware** | Encoding name embedded in header | Works with any LLM's tokenizer |

---

## 2. Strategic Position

### The Contex Pipeline

TENS sits at the center of the Contex data pipeline:

```
┌──────────┐      ┌──────────┐     ┌──────────────┐
│   Input  │─────►│   TENS   │────►│  LLM Output  │
│ JSON/CSV │      │ Canon IR │     │ TOON/CSV/MD  │
└──────────┘      └─────┬────┘     └──────────────┘
                        │
               ┌────────┼─────────┐
               ▼        ▼         ▼
              Hash     Dedup     Budget
              Cache    Keys      Engine
```

Every operation in Contex flows through TENS:

- **Insert** → Data is canonicalized into TENS
- **Query** → TENS is filtered and transformed
- **Serve** → TENS is converted to the optimal text format for the target LLM
- **Cache** → TENS provides deterministic hashing for KV cache reuse
- **Store** → TENS binary is the on-disk representation

### Why Not Just Use...?

| Format | Missing Capability |
|---|---|
| **JSON** | Not canonical. Order-sensitive. No schema deduplication. 60% structural overhead. |
| **MessagePack** | Not canonical. No schema dedup. No LLM token alignment. Just "compact JSON". |
| **Protobuf** | Requires schema files (.proto). Not self-describing. No dictionary encoding. |
| **CBOR** | No schema dedup. No structural dedup. No token alignment. |
| **Avro** | Schema evolution focus. Heavy runtime. Not designed for LLM pipelines. |
| **FlatBuffers** | Zero-copy access focus. No dictionary encoding. Not canonical. |

**TENS differentiator**: It is the only format built for the `data → LLM` pipeline, where the goal is maximizing **information density per token** while maintaining **structural integrity** for caching and deduplication.

---

## 3. Binary Layout (v2)

### Header

```
Offset    Size       Field
────────────────────────────────────────────────────────────
0         4B         Magic: "TENS" (0x54454E53)
4         1B         Version: 2
5         1B         Encoding name length (N)
6         NB         Encoding name (UTF-8, e.g. "o200k_base")
6+N       4B         Token count (T) — uint32le
10+N      Tx4B       Token stream — uint32le each
```

### Control Token Vocabulary

Tokens ≥ `200000` are structural markers, placed well above any real tokenizer vocabulary (the largest, `o200k_base`, has ~200K entries) to avoid collisions:

| Token | Value | Meaning |
|---|---|---|
| `NULL_VAL` | `200000` | Null value |
| `BOOL_TRUE` | `200001` | Boolean true |
| `BOOL_FALSE` | `200002` | Boolean false |
| `ARR_START` | `200003` | Begin array |
| `ARR_END` | `200004` | End array |
| `OBJ_START` | `200005` | Begin object value sequence |
| `OBJ_END` | `200006` | End object value sequence |
| `SCHEMA_DEF` | `200007` | Begin schema definition (followed by key name tokens) |
| `SCHEMA_REF` | `200008` | Reference previously defined schema by ID |
| `SEPARATOR` | `200009` | Field/element delimiter |
| `DOC_START` | `200010` | Document boundary start |
| `DOC_END` | `200011` | Document boundary end |
| `ROW_BREAK` | `200012` | Lightweight row separator (single-schema documents) |
| `PRESENCE_MASK` | `200013` | Signals that ⌈fieldCount/16⌉ mask chunks follow |
| `FIXED_ARRAY` | `200014` | Fixed-length array — followed by 1 length token, then N values |
| `DICT_DEF` | `200015` | Dictionary entry definition — followed by ID + value |

### Extended Token Ranges

Beyond the 16 control tokens, TENS uses additional ranges for encoding structured data:

| Range | Base Value | Purpose |
|---|---|---|
| Mask chunks | `300000 + v` | Presence mask bits (v = 16-bit chunk, 0–65535) |
| Array lengths | `400000 + n` | Fixed-length array with `n` elements |
| Dictionary refs | `500000 + id` | Reference to dictionary entry `id` (0–99999) |

### Schema Deduplication

When encoding an array of objects, TENS scans all object shapes:

1. **First occurrence**: Emit `SCHEMA_DEF` followed by all key names (tokenized), then assign a schema ID
2. **Subsequent rows with same shape**: Emit `SCHEMA_REF` + schema ID (1 token instead of N key tokens)

For 1,000 rows with 6 keys each, this saves ~5,000 tokens of key repetition.

### Dictionary Encoding

String values that appear more than once across the dataset are dictionary-encoded:

1. **Dictionary table**: Written once in the header
2. **References**: Subsequent occurrences reference the dictionary entry by index

This is particularly effective for:
- Enum-like fields (`"status"`: `"active"`, `"pending"`, `"deleted"`)
- Category fields with limited cardinality
- Repeated metadata values

---

## 4. Core Capabilities

### 4.1 Canonical Representation

**Problem**: JSON is not canonical. `{"a":1,"b":2}` and `{"b":2,"a":1}` are semantically identical but produce different bytes and different tokens.

**TENS solution**: Sorted keys + deterministic layout. Same data always produces the same binary output, regardless of input key order.

**Enables**:
- Content-addressable storage (hash TENS bytes → unique content ID)
- Deduplication at the storage layer
- Reproducible builds and CI verification
- Context fingerprinting for inference cache keys

### 4.2 Structural Deduplication

**Problem**: In repetitive datasets, JSON repeats all keys for every row. CSV doesn't support nesting. Neither can dictionary-encode repeated values.

**TENS solution**:
- Schema dedup: Object shapes stored once, referenced by ID
- Dictionary encoding: Repeated strings stored once, referenced by index
- Bit-packing: Booleans use 1 control token instead of 4-5 text tokens
- Schema reuse: Across documents in the same collection

### 4.3 Fast Encode / Decode

Current performance (TypeScript implementation, 10K records):

| Operation | Speed | Throughput |
|---|---|---|
| Encoding | 233,000 ops/sec | 13.43 MB/s |
| Decoding | 870,610 ops/sec | 50.20 MB/s |

This makes TENS viable as a real-time IR — data can be encoded/decoded on every request without becoming a bottleneck.

### 4.4 Internal IR for Contex

TENS provides the clean architecture:

```
JSON → TENS → Optimal LLM Format
```

This means:
- **One internal format** instead of format-specific logic everywhere
- **Deterministic transformation** from TENS to any output format
- **Controlled output generation** — all formatting decisions are based on TENS structure
- **Safe format conversion** — TENS preserves full type information (nulls, booleans, numbers, strings)

---

## 5. TENS vs TOON vs CSV

These are **not competitors**. They operate at different layers:

```
Storage Layer    ──►  TENS (binary, canonical)
                          │
Conversion Layer ──►  Format selector (based on model, data shape, budget)
                          │
                   ┌──────┴────────────┐
Output Layer    ──►│TOON│ CSV│ Markdown│
                   └───────────────────┘
```

| Dimension | TENS | TOON | CSV |
|---|---|---|---|
| **Layer** | Storage & IR | LLM Output | LLM Output |
| **Readable** | ❌ Binary | ✅ Text | ✅ Text |
| **Token efficiency** | N/A (binary) | Good (tab-separated) | Best (minimal syntax) |
| **Nesting support** | ✅ Full | ❌ Flat only | ❌ Flat only |
| **Type preservation** | ✅ Full | ❌ Strings only | ❌ Strings only |
| **Schema preserved** | ✅ Embedded | ❌ Header row | ❌ Header row |
| **Lossless roundtrip** | ✅ Yes | ❌ No | ❌ No |
| **Canonical** | ✅ Yes | ❌ No | ❌ No |

**When to use each**:
- **TENS**: Internal storage, caching, deduplication, cross-system transfer
- **TOON**: LLM prompt injection for nested/typed data
- **CSV**: LLM prompt injection for flat, tabular data (best token density)

---

## 6. Future Directions

### 6.1 LLM-Aware Structural Segmentation

TENS could store structural boundaries aligned to token segmentation:
- Precompute prefix boundaries for streaming
- Track row-level token cost metadata
- Enable efficient chunk streaming to LLMs

### 6.2 Context-Diff Encoding

Instead of re-encoding the full dataset on every mutation:
- Structural diff blocks for incremental updates
- Prefix-stable mutation representation
- Direct improvement to KV cache reuse

### 6.3 TENS-Text Language Specification (`.tens`)

**Status: Implemented (v1)**

TENS-Text is a lossless, human-readable text serialization of TENS data. It uses an indentation-based, field-per-line syntax with `@`-directives for structural metadata.

> **Relationship to TENS Binary (sections 1–5):** TENS Binary is a machine-native token-stream IR. TENS-Text is a separate, human-readable format that maps 1:1 to the same logical data. They share the same data model but have completely different encodings — binary tokens vs. indented text. This section is the complete language specification for the text format only.

---

#### 6.3.1 Lexical Grammar (Tokens)

The lexical grammar defines the atomic building blocks ("tokens") of TENS-Text.

##### Whitespace & Comments

| Rule | Behavior |
|---|---|
| **Indent** | Exactly 2 spaces (`"  "`), semantic — signals a field value line |
| **Blank lines** | Ignored; may appear between records or after directives for readability |
| **Trailing whitespace** | Stripped during parsing |
| **Comments** | **Not supported** — intentional design choice for determinism (same data → same bytes, no comment variance) |

> **Why no comments?** TENS-Text is designed for machine-generated, canonical output. Comments would break the `encode(decode(text)) === text` invariant and prevent content-addressable caching. Use external documentation instead.

##### Identifiers

Identifiers name schemas, fields, and record markers:

```ebnf
IDENT       = LETTER { LETTER | DIGIT | "_" } ;
LETTER      = "a"..."z" | "A"..."Z" | "_" ;
DIGIT       = "0"..."9" ;
```

**Examples:** `users`, `field_name`, `mySchema2`, `_private`

##### Keywords & Reserved Words

The following bare words have special meaning and **must be quoted** when used as string values:

| Keyword | Role |
|---|---|
| `true` | Boolean literal |
| `false` | Boolean literal |
| `_` | Null sentinel |
| `@version` | Directive prefix |
| `@encoding` | Directive prefix |
| `@schema` | Directive prefix |
| `@dict` | Directive prefix |

Any string value that collides with a keyword (e.g., the string `"true"`) is automatically double-quoted by the encoder: `  flag "true"`.

##### Literals

```ebnf
(* Numbers *)
NUMBER      = ["-"] DIGIT { DIGIT } ["." DIGIT { DIGIT }] ;
             (* e.g., 42, -3.14, 0.001 *)
             (* Special: NaN → "NaN", Infinity → "Infinity", -0 → -0 *)

(* Booleans *)
BOOLEAN     = "true" | "false" ;

(* Null *)
NULL        = "_" ;

(* Dictionary Reference *)
DICT_REF    = "@" DIGIT { DIGIT } ;
             (* e.g., @0, @12 — resolves to dictionary entry at that index *)

(* Strings *)
BARE_STRING   = IDENT ;
               (* only when no special characters present *)
QUOTED_STRING = '"' { CHAR | ESCAPE } '"' ;
ESCAPE        = "\\" ( '"' | "\\" | "n" | "r" | "t" ) ;
```

**Quoting rules** — A string value must be double-quoted when it:
- Contains whitespace, `"`, `\`, `|`, `>`, `,`, `=`, `{`, `}`, `[`, `]`, `@`, or `#`
- Matches a keyword (`true`, `false`, `_`)
- Looks like a number (`42`, `-3.14`)
- Looks like a dictionary reference (`@0`)
- Is an empty string

**Escape sequences** (inside double-quoted strings):

| Sequence | Meaning |
|---|---|
| `\"` | Literal double quote |
| `\\` | Literal backslash |
| `\n` | Newline (U+000A) |
| `\r` | Carriage return (U+000D) |
| `\t` | Tab (U+0009) |

##### Newlines

```ebnf
NL = "\n" | "\r\n" ;     (* LF or CRLF, normalized to LF in output *)
WS = " " { " " } ;       (* one or more ASCII spaces *)
```

---

#### 6.3.2 Syntactic Grammar (EBNF)

This is the complete context-free grammar for TENS-Text files.

```ebnf
(* ──────────────── Top-Level ──────────────── *)

file            = { directive } { record } ;

(* ──────────────── Directives ──────────────── *)

directive       = version | encoding | schema | dict ;
version         = "@version" WS NUMBER NL ;
encoding        = "@encoding" WS IDENT NL ;
schema          = "@schema" WS IDENT WS field_def { WS field_def } NL ;
field_def       = IDENT ":" type ;
type            = base_type [ "[]" ] [ "?" ] ;
base_type       = "str" | "num" | "bool" ;
dict            = "@dict" WS value { WS value } NL ;

(* ──────────────── Records ──────────────── *)

record          = IDENT NL { field_line } ;
field_line      = INDENT IDENT WS value NL ;

(* ──────────────── Values ──────────────── *)

value           = NUMBER | BOOLEAN | NULL | DICT_REF
                | BARE_STRING | QUOTED_STRING ;
```

##### Directive Reference

| Directive | Purpose | Syntax | Example |
|---|---|---|---|
| `@version N` | Format version (currently 1) | `@version` WS NUMBER | `@version 1` |
| `@encoding NAME` | Tokenizer encoding | `@encoding` WS IDENT | `@encoding o200k_base` |
| `@schema NAME fields...` | Schema with typed fields | `@schema` WS IDENT WS field_defs | `@schema ticket id:num title:str tag:str[]` |
| `@dict values...` | Dictionary of repeated strings | `@dict` WS values | `@dict admin user editor` |

##### Type System

| Short | Full JS Type | Array Form | Optional | Example |
|---|---|---|---|---|
| `num` | `number` | `num[]` | `num?` | `score:num` |
| `str` | `string` | `str[]` | `str?` | `name:str` |
| `bool` | `boolean` | `bool[]` | `bool?` | `active:bool` |

- Append `[]` for array fields: `tag:str[]`
- Append `?` for optional (nullable) fields: `email:str?`
- Combine both: `tag:str[]?` (optional array field)

> **Why only 3 types?** TENS-Text targets LLM data pipelines where data is overwhelmingly strings, numbers, and booleans. No `date`, `bigint`, or nested object types — those are serialized as quoted strings. This keeps the parser trivially simple and the format deterministic.

##### Array Assembly Rule (Field Repetition)

Arrays are **implicit** — if the same field name appears multiple times in a record, the values are collected into an ordered array:

```
ticket
  id 1
  tag security       ← tag[0]
  tag backend         ← tag[1]
```

Decodes to: `{ id: 1, tag: ["security", "backend"] }`

| Repetition Count | Result |
|---|---|
| 0 repetitions | Empty array `[]` |
| 1 repetition | Single-element array `["x"]` |
| N repetitions | N-element array `["a", "b", ...]` |

The schema `[]` suffix signals the decoder to always produce an array, even for 0 or 1 occurrences.

---

#### 6.3.3 Syntax Design Checklist

##### Operator Precedence

**Not applicable.** TENS-Text is a data format, not an expression language. There are no arithmetic, logical, or comparison operators. All values are atomic literals or references. This is a deliberate design choice — no ambiguity, no parser complexity.

##### Scope Rules

| Concept | Rule |
|---|---|
| **Record scope** | Each record (IDENT line + its indented fields) is an independent flat namespace |
| **Field visibility** | Fields are visible only within their parent record |
| **Schema scope** | Schemas are file-global — defined once, referenced by all matching records |
| **Dictionary scope** | Dictionary entries are file-global — available to all records |
| **No nesting** | Records cannot contain sub-records; nested objects serialize as quoted JSON strings |

> **Why flat scope?** TENS-Text is optimized for tabular data flowing into LLM context windows. Flat structure avoids indentation ambiguity and keeps parsing linear-time.

##### Error Handling

The decoder follows a **lenient, fail-safe** strategy:

| Scenario | Behavior |
|---|---|
| Missing `@version` | Defaults to version 1 |
| Missing `@encoding` | Defaults to `o200k_base` |
| Missing `@schema` | Infers types from values (auto-detect mode) |
| Out-of-range `@N` ref | Resolves to `null` |
| Missing optional field | Resolves to `null` |
| Missing required field | Resolves to `undefined` |
| Extra blank lines | Skipped silently |
| Unknown directive | Skipped (forward compatibility) |
| Malformed field line | Skipped |

> **Why lenient?** In LLM pipelines, partial data is better than a crash. The encoder guarantees well-formed output; the decoder is tolerant of hand-edited or corrupted input.

##### Imports / Modules

**Not supported.** Each `.tens` file is fully self-contained — schema, dictionary, and data are all in one file. This is deliberate: TENS-Text files are generated programmatically and consumed as single units. There is no `@import` or `@include` directive.

> **Why no imports?** Self-contained files simplify caching, hashing, and transfer. A `.tens` file can be content-addressed (hash the bytes → unique ID) without resolving external dependencies.

---

#### 6.3.4 Implementation Pipeline

TENS-Text processing follows a 3-stage pipeline:

```
┌─────────────────────────────────────────────────────────┐
│                    ENCODING PIPELINE                    │
│                                                         │
│  JavaScript Objects                                     │
│        │                                                │
│        ▼                                                │
│  ┌──────────┐   Schema analysis: collect all keys,      │
│  │  ANALYZE │   infer types, detect arrays              │
│  └────┬─────┘                                           │
│       ▼                                                 │
│  ┌──────────┐   Find strings appearing 2+ times,        │
│  │   DICT   │   assign dictionary indices               │
│  └────┬─────┘                                           │
│       ▼                                                 │
│  ┌──────────┐   Emit @directives, then records          │
│  │   EMIT   │   with field values (scalar/array)        │
│  └────┬─────┘                                           │
│       ▼                                                 │
│  TENS-Text String (.tens file)                          │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    DECODING PIPELINE                    │
│                                                         │
│  TENS-Text String                                       │
│        │                                                │
│        ▼                                                │
│  ┌──────────┐   Line-by-line scan: extract              │
│  │   LEX    │   directives, record markers, field lines │
│  └────┬─────┘                                           │
│       ▼                                                 │
│  ┌──────────┐   Build schemas, dictionary; group        │
│  │  PARSE   │   field lines into records                │
│  └────┬─────┘                                           │
│       ▼                                                 │
│  ┌──────────┐   Type-directed value parsing:            │
│  │ RESOLVE  │   num→number, bool→boolean, str→string    │
│  └────┬─────┘   Dict refs → resolved strings            │
│       ▼                                                 │
│  JavaScript Objects                                     │
└─────────────────────────────────────────────────────────┘
```

##### Stage Details

| Stage | Encoder | Decoder |
|---|---|---|
| **1. Lex/Analyze** | Scan all rows to collect field names, infer types, detect array fields | Split text into lines, classify each as directive / record marker / field line / blank |
| **2. Dict/Parse** | Count string value frequency, build dictionary for ≥2 occurrences | Parse `@schema`, `@dict`, `@version`, `@encoding`; group field lines under records |
| **3. Emit/Resolve** | Write `@directives`, then records with formatted values | For each record, resolve raw strings to typed values using schema type hints |

##### Type-Directed Parsing (Decoder)

The decoder uses the schema's type annotation to parse bare values correctly:

| Schema Type | Bare Value `42` | Bare Value `true` |
|---|---|---|
| `num` | `42` (number) | Error (not a number) |
| `str` | `"42"` (string) | `"true"` (string) |
| `bool` | Error (not a boolean) | `true` (boolean) |
| No schema | `42` (number, auto-detected) | `true` (boolean, auto-detected) |

> **Why type-directed?** Without it, a ZIP code field containing `"90210"` would silently become the number `90210`, losing its string semantics. The schema prevents this class of bugs.

---

#### 6.3.5 Dictionary Compression

Strings appearing 2+ times across all rows are stored in `@dict` and referenced by index:

```
@dict admin user

data
  role @0    ← resolves to "admin"
data
  role @1    ← resolves to "user"
data
  role @0    ← resolves to "admin"
```

> **Why dictionary encoding?** In LLM pipelines, enum-like fields (status, role, category) repeat across hundreds of rows. Dictionary compression replaces multi-token strings with 2-character references (`@N`), reducing token count significantly.

---

#### 6.3.6 Special Values

| Syntax | Meaning | When Generated |
|---|---|---|
| `_` | Null | `null` or `undefined` JS value |
| `@N` | Dictionary reference (index N) | String appearing 2+ times |
| `true` / `false` | Boolean | Boolean JS value |
| `"NaN"` | Not-a-Number | `NaN` JS value |
| `"Infinity"` / `"-Infinity"` | Infinity | `±Infinity` JS value |
| `-0` | Negative zero | `-0` JS value |

---

#### 6.3.7 Complete Example

```
@version 1
@encoding o200k_base
@schema ticket id:num title:str status:str priority:num? assignee:str? tag:str[]

@dict open closed

ticket
  id 1
  title "Bug in auth"
  status @0
  priority 1
  assignee Alice
  tag security
  tag backend
ticket
  id 2
  title "UI polish"
  status @0
  priority _
  assignee _
ticket
  id 3
  title "Deploy script"
  status @1
  priority 2
  assignee Bob
  tag devops
  tag ci
```

**Reading this example:**
- Line 1: Format version is 1
- Line 2: Uses `o200k_base` tokenizer encoding
- Line 3: Schema named `ticket` with 6 fields — `priority` is optional (`num?`), `assignee` is optional (`str?`), `tag` is an array (`str[]`)
- Line 5: Dictionary with 2 entries — index 0 = "open", index 1 = "closed"
- Lines 7–14: First record — `@0` resolves to "open", two `tag` lines form array `["security", "backend"]`
- Lines 15–19: Second record — `_` means null for `priority` and `assignee`, no `tag` lines means empty array `[]`
- Lines 20–25: Third record — `@1` resolves to "closed"

---

#### 6.3.8 Programmatic Usage

```typescript
import { TensTextEncoder, TensTextDecoder } from '@contex/core';

// ── Encode ──────────────────────────────────────────────
const encoder = new TensTextEncoder('o200k_base');
const text = encoder.encode(data, 'ticket');
// → Human-readable .tens file
// encoder.encode([]) → valid file with empty schema

// ── Decode ──────────────────────────────────────────────
const decoder = new TensTextDecoder();
const { data, document } = decoder.decode(text);
// → data: original JavaScript objects (lossless roundtrip)
// → document.version: 1
// → document.encoding: 'o200k_base'
// → document.schemas: [{ name, fields }]
// → document.dictionary: ['open', 'closed']
// → document.rows: [{ rowNum, fields: Map }]
```

---

#### 6.3.9 Design Principles & Rationale

| Principle | Implementation | Why |
|---|---|---|
| **No brackets, no commas** | Indentation-based, space-delimited | Simpler than YAML, fewer tokens than JSON, more deterministic |
| **Schema defined once** | `@schema` directive at file top | Eliminates key repetition across rows (same as TENS binary schema dedup) |
| **Arrays via repetition** | Same field name repeated | No `[]` syntax in data section — avoids bracket tokens, keeps parsing trivial |
| **Dictionary visible** | `@dict` in plaintext | Compression is inspectable, debuggable — unlike opaque binary encoding |
| **1:1 lossless roundtrip** | `encode(decode(text)) === text` | Canonical output enables content-addressable caching |
| **Deterministic** | Sorted fields, stable dict order | Same input → identical bytes → prefix cache compatibility |
| **Type-directed parsing** | Schema types prevent coercion | `str`-typed `"42"` stays string, never silently becomes number |
| **No comments** | Intentionally omitted | Preserves canonical invariant — no variation in output |
| **Self-contained** | No imports, no external refs | Single file = single hash = simple caching |
| **`fn` over `function` principle** | `str`/`num`/`bool` not `string`/`number`/`boolean` | Saves keystrokes in schema definitions without ambiguity |

---

## 7. Code Examples

### Encoding

```typescript
import { TensEncoder } from '@contex/core';

const encoder = new TensEncoder();
const data = [
  { id: 1, name: 'Alice', role: 'admin' },
  { id: 2, name: 'Bob', role: 'user' }
];

const binary = encoder.encode(data);
// binary: Uint8Array — canonical, deterministic
```

### Decoding

```typescript
import { TensDecoder } from '@contex/core';

const decoder = new TensDecoder();
const restored = decoder.decode(binary);
// restored === data (lossless roundtrip)
```

### Token Stream

```typescript
import { TokenStreamEncoder } from '@contex/core';

const stream = new TokenStreamEncoder();
const tokens = stream.encodeToTokenStream(data);
// tokens: number[] — token IDs for the TENS representation
const stats = stream.getStats();
// stats: { schemaCount, tokenCount, byteCount }
```
