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
| `PRESENCE_MASK` | `200013` | Signals that ❌ˆfieldCount/16❌‰ mask chunks follow |
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

## 5. TENS vs Output Formats

These are **not competitors**. They operate at different layers:

```
Storage Layer    ──►  TENS (binary, canonical)
                          │
Conversion Layer ──►  Format selector (based on model, data shape, budget)
                          │
                   ┌──────┴──────────────────────────┐
Output Layer    ──►│Contex Compact│ TOON│ CSV│ Markdown│
                   └─────────────────────────────────┘
```

| Dimension | TENS | Contex Compact | TOON | CSV |
|---|---|---|---|---|
| **Layer** | Storage & IR | LLM Output (best) | LLM Output | LLM Output |
| **Readable** | ❌ Binary | ✅ Text | ✅ Text | ✅ Text |
| **Token efficiency** | N/A (binary) | Best (dict+field compression) | Good (tab-separated) | Good (minimal syntax) |
| **Nesting support** | ✅ Full | ✅ Deep flattening | ❌ Flat only | ❌ Flat only |
| **Type preservation** | ✅ Full | ✅ Bool/null abbreviation | ❌ Strings only | ❌ Strings only |
| **Schema preserved** | ✅ Embedded | ✅ @f field map | ❌ Header row | ❌ Header row |
| **Dictionary compression** | ✅ Binary dict | ✅ @d/@0 refs | ❌ None | ❌ None |
| **Lossless roundtrip** | ✅ Yes | ❌ No | ❌ No | ❌ No |
| **Canonical** | ✅ Yes | ❌ No | ❌ No | ❌ No |
| **Avg savings vs JSON** | N/A | 72% (best overall) | ~25% | ~38% |

**When to use each**:
- **TENS**: Internal storage, caching, deduplication, cross-system transfer
- **Contex Compact**: LLM prompt injection (recommended default — best overall token efficiency)
- **TOON**: Simple tabular LLM output (no dictionary compression)
- **CSV**: LLM prompt injection for flat, tabular data

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
import { TensTextEncoder, TensTextDecoder } from '@contex-llm/core';

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

### High-Level API (Recommended)

```typescript
import { Tens } from '@contex-llm/core';

const data = [
  { id: 1, name: 'Alice', role: 'admin' },
  { id: 2, name: 'Bob', role: 'user' }
];

// Encode to TENS IR
const tens = Tens.encode(data);

// Get canonical text (Contex Compact format)
const text = tens.toString();

// Materialize tokens for a specific model
const result = tens.materialize('gpt-4o');
console.log(result.tokenCount);

// Content hash for caching/dedup
console.log(tens.hash);  // SHA-256
```

### Direct Format Output

```typescript
import { formatOutput } from '@contex-llm/core';

// Contex Compact (best overall — 72% avg savings)
const compact = formatOutput(data, 'contex');

// Other formats
const csv = formatOutput(data, 'csv');
const toon = formatOutput(data, 'toon');
const markdown = formatOutput(data, 'markdown');
```

### Token Stream (Advanced)

```typescript
import { TokenStreamEncoder } from '@contex-llm/core';

const stream = new TokenStreamEncoder();
const tokens = stream.encodeToTokenStream(data);
// tokens: number[] — token IDs for the TENS representation
const stats = stream.getStats();
// stats: { schemaCount, tokenCount, byteCount }
```

### TENS-Text (Human-Readable IR)

```typescript
import { TensTextEncoder, TensTextDecoder } from '@contex-llm/core';

// Encode to TENS-Text
const encoder = new TensTextEncoder('o200k_base');
const text = encoder.encode(data, 'ticket');

// Decode back (lossless roundtrip)
const decoder = new TensTextDecoder();
const { data: restored } = decoder.decode(text);
```

---

## 8. Error Codes

All TENS operations use structured error codes for programmatic handling. Error codes
follow the pattern `TENS_XXX` where XXX is a 3-digit category code.

### 8.1 Encoding Errors (1xx)

| Code | Name | Description |
|------|------|-------------|
| `TENS_100` | `INVALID_INPUT` | Input data is not a valid JavaScript value (undefined at top level) |
| `TENS_101` | `UNSUPPORTED_TYPE` | Value type not representable in TENS (e.g., Symbol, Function, BigInt) |
| `TENS_102` | `CIRCULAR_REFERENCE` | Circular reference detected during value tree traversal |
| `TENS_103` | `STRING_TOO_LONG` | String exceeds maximum LEB128-addressable length (2^28 bytes) |
| `TENS_104` | `SCHEMA_OVERFLOW` | More than 65,535 distinct object schemas in a single encoding |
| `TENS_105` | `DICT_OVERFLOW` | Dictionary exceeds 99,999 entries |

### 8.2 Decoding Errors (2xx)

| Code | Name | Description |
|------|------|-------------|
| `TENS_200` | `INVALID_MAGIC` | First 4 bytes are not "TENS" (0x54454E53) |
| `TENS_201` | `UNSUPPORTED_VERSION` | Version byte is not a supported version (currently only v2) |
| `TENS_202` | `TRUNCATED_INPUT` | Buffer ends before expected based on declared lengths |
| `TENS_203` | `INVALID_OPCODE` | Encountered an undefined opcode in the value tree |
| `TENS_204` | `INVALID_STRING_REF` | String reference index exceeds string table size |
| `TENS_205` | `INVALID_VARINT` | LEB128 varint exceeds 5 bytes (overflow) |
| `TENS_206` | `MALFORMED_STRUCTURE` | Structural inconsistency (e.g., OBJECT_START without matching key count) |

### 8.3 Pipeline Errors (3xx)

| Code | Name | Description |
|------|------|-------------|
| `TENS_300` | `HASH_MISMATCH` | Stored hash does not match re-computed hash (data corruption) |
| `TENS_301` | `MODEL_NOT_FOUND` | Requested model is not in the model registry |
| `TENS_302` | `TOKENIZER_UNAVAILABLE` | Tokenizer for the requested encoding is not available |
| `TENS_303` | `BUDGET_EXCEEDED` | Token count exceeds the specified budget limit |
| `TENS_304` | `CACHE_MISS` | Requested hash not found in the store |

### 8.4 TENS-Text Errors (4xx)

| Code | Name | Description |
|------|------|-------------|
| `TENS_400` | `SYNTAX_ERROR` | TENS-Text parsing failed (invalid indentation, missing directive) |
| `TENS_401` | `UNKNOWN_DIRECTIVE` | Unrecognized `@`-directive |
| `TENS_402` | `SCHEMA_MISMATCH` | Row field count does not match `@schema` field count |
| `TENS_403` | `INVALID_TYPE_TAG` | Unknown type tag in `@schema` (not str/int/float/bool/null/arr/obj) |

---

## 9. Versioning & Migration

### 9.1 Version History

| Version | Date | Changes |
|---------|------|---------|
| **v1** | Jan 2026 | Initial format. Magic + version + schema list + row data. No string table, no dictionary encoding. |
| **v2** | Feb 2026 | Current version. Added string table, opcode-based value tree, LEB128 varints, schema dedup, dictionary encoding, control token vocabulary. Breaking change from v1. |

### 9.2 Version Detection

The version byte at offset 4 determines the decoder to use:

```
bytes[0..3] = "TENS"  →  TENS format confirmed
bytes[4]    = 0x01    →  v1 decoder (legacy, not recommended)
bytes[4]    = 0x02    →  v2 decoder (current)
bytes[4]    = other   →  reject with TENS_201
```

### 9.3 Migration Guide

**v1 → v2:** No automated migration path. Re-encode source data with the v2 encoder.
v1 and v2 are not wire-compatible. The v2 string table and opcode-based value tree
are fundamentally different from the v1 row-oriented layout.

### 9.4 Stability Guarantees

- **v2 binary format** is frozen. No new opcodes or structural changes without a
  version bump to v3.
- **Control token vocabulary** (200000–200015) is frozen. New control tokens will
  use values ≥200016.
- **SHA-256 hash computation** is frozen: `sha256(tens_v2_binary_bytes).hex()`.
  Any change to the binary layout would change all hashes and is a breaking change.
- **String table ordering** is frozen: DFS traversal with sorted object keys.
- **Key sorting** is frozen: lexicographic (codepoint order).
- **Number canonicalization** is frozen: `-0 → 0`, `NaN → null`, `±Infinity → null`.
- **String normalization** is frozen: NFKC.

---

## 10. WASM Binding Specification

### 10.1 Overview

The `contex-tens-wasm` package provides a Rust-compiled WASM implementation of the
TENS v2 encoder/decoder. It is designed for environments where Node.js native crypto
is unavailable (browsers, edge workers, Cloudflare Workers, Deno Deploy).

### 10.2 Build Target

```bash
wasm-pack build --target nodejs --release   # Node.js
wasm-pack build --target web --release      # Browser ESM
wasm-pack build --target bundler --release  # Webpack/Vite
```

### 10.3 API Surface

```typescript
// TensEncoder class — stateful encoder with string table reuse
class TensEncoder {
  constructor();
  encode(val: any): Uint8Array;           // JSON value → TENS v2 binary
  encodeText(val: any, encoding?: string): string;  // JSON value → TENS-Text
  hash(val: any): string;                 // JSON value → SHA-256 hex (encode + hash)
  hashBinary(bytes: Uint8Array): string;  // Pre-encoded bytes → SHA-256 hex
}

// Standalone decoder functions
function decodeTens(bytes: Uint8Array): any;    // TENS v2 binary → JSON value
function decodeTensText(text: string): any;     // TENS-Text string → JSON value
```

### 10.4 Parity Requirements

The WASM encoder MUST produce byte-for-byte identical output to the TypeScript
`TensEncoder` for all inputs. This is verified by the shared protocol test vectors at
`packages/core/src/__tests__/fixtures/protocol-vectors.json`.

Specifically:
- Same string table ordering (DFS, sorted keys)
- Same opcode selection (INT8 for -128..127, INT32 for larger, FLOAT64 for non-integer)
- Same LEB128 varint encoding
- Same SHA-256 hash for identical bytes

### 10.5 Package Structure

```
packages/tens-wasm/
  Cargo.toml          # Rust manifest
  src/
    lib.rs            # WASM entry point, #[wasm_bindgen] exports
    encoder.rs        # TENS v2 binary encoder + decoder
    schema.rs         # Schema registry (string table, dedup)
    utils.rs          # LEB128 helpers, panic hook
  pkg/                # wasm-pack output (generated)
    contex_tens_wasm.js
    contex_tens_wasm.d.ts
    contex_tens_wasm_bg.wasm
```

---

## 11. Interoperability Test Vectors

### 11.1 Purpose

Test vectors are the formal contract between TENS implementations. Every encoder
(TypeScript, Rust/WASM, future Python/Go) MUST produce identical bytes for each vector.

### 11.2 Vector Format

Vectors are stored in `packages/core/src/__tests__/fixtures/protocol-vectors.json`:

```json
[
  {
    "name": "descriptive_name",
    "input": <any JSON value>,
    "expected_hex": "<lowercase hex of TENS v2 binary>",
    "expected_hash": "<sha256 hex of the binary>",
    "byte_length": <integer>
  }
]
```

### 11.3 Current Vectors (v2.0)

| # | Name | Input | Bytes | Description |
|---|------|-------|-------|-------------|
| 1 | `null` | `null` | 7 | Header + NULL opcode |
| 2 | `true` | `true` | 7 | Header + TRUE opcode |
| 3 | `false` | `false` | 7 | Header + FALSE opcode |
| 4 | `int_42` | `42` | 8 | INT8 encoding |
| 5 | `int_neg1` | `-1` | 8 | Signed INT8 (0xFF) |
| 6 | `int_1000` | `1000` | 11 | INT32 encoding (> 127) |
| 7 | `float_3_14` | `3.14` | 15 | FLOAT64 encoding |
| 8 | `string_hello` | `"hello"` | 14 | String table + STRING_REF |
| 9 | `empty_array` | `[]` | 8 | ARRAY_START with length 0 |
| 10 | `empty_object` | `{}` | 8 | OBJECT_START with 0 keys |
| 11 | `simple_object` | `{"a":1,"b":2}` | 18 | Key sorting, string table |
| 12 | `key_order_invariant` | `{"z":1,"a":2}` | 18 | Canonicalization proof |
| 13 | `mixed_types` | `{bool,null}` | 34 | All type opcodes in one object |
| 14 | `array_of_objects` | `[{id,name}x2]` | 42 | Multi-row with string dedup |
| 15 | `nested_object` | `{user:{...}}` | 36 | Nested object encoding |
| 16 | `neg_zero_canonicalized` | `0` | 8 | -0 → 0 canonicalization |

### 11.4 Adding New Vectors

1. Add the input/expected entry to `protocol-vectors.json`
2. Run `npx vitest run src/__tests__/protocol_vectors.test.ts` to verify
3. Run `cargo test` in `packages/tens-wasm/` to verify WASM parity
4. Update the table in this section

### 11.5 Conformance Levels

| Level | Requirement |
|-------|-------------|
| **MUST** | All 16 base vectors produce identical bytes and hash |
| **SHOULD** | Encode-twice idempotence for all vectors |
| **SHOULD** | Key order invariance (vector 12 = vector 11 byte-for-byte for matching keys) |
| **MAY** | NaN/Infinity handling (implementation-specific, canonicalize layer recommended) |
