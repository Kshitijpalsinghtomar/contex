use serde_json::{Map, Value};
use std::collections::HashMap;
use unicode_normalization::UnicodeNormalization;

use crate::schema::SchemaRegistry;
use crate::utils::{encode_varint, decode_varint};

// ── TENS v2 Binary Opcodes (must match TS encoder.ts) ──

const OP_NULL: u8 = 0x00;
const OP_TRUE: u8 = 0x01;
const OP_FALSE: u8 = 0x02;
const OP_INT8: u8 = 0x03;
// OP_INT16 = 0x04 is reserved but unused in TS
const OP_INT32: u8 = 0x05;
const OP_FLOAT64: u8 = 0x06;
const OP_STRING_REF: u8 = 0x07;
const OP_ARRAY_START: u8 = 0x08;
const OP_OBJECT_START: u8 = 0x09;

/// TENS v2 header: "TENS" + version byte 0x02
const HEADER: &[u8; 5] = b"TENS\x02";

// ── String Table (Dictionary) ──

/// Insertion-order string table matching TS StringTable.
pub struct StringTable {
    map: HashMap<String, u32>,
    entries: Vec<String>,
}

impl StringTable {
    pub fn new() -> Self {
        StringTable {
            map: HashMap::new(),
            entries: Vec::new(),
        }
    }

    /// Add a string and return its ID. If already present, return existing ID.
    pub fn add(&mut self, s: &str) -> u32 {
        if let Some(&id) = self.map.get(s) {
            return id;
        }
        let id = self.entries.len() as u32;
        self.entries.push(s.to_string());
        self.map.insert(s.to_string(), id);
        id
    }

    pub fn entries(&self) -> &[String] {
        &self.entries
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }
}

// ── Canonicalization ──

/// Canonicalize a JSON value to match TS canonical.ts:
/// - Object keys sorted lexicographically
/// - Strings NFKC-normalized, trailing whitespace stripped per line
/// - Numbers: NaN/Infinity → null, -0 → 0
/// - Dates: left as strings (JSON has no Date type)
/// - Arrays: order preserved, null elements stay
pub fn canonicalize(value: &Value) -> Value {
    match value {
        Value::Null => Value::Null,
        Value::Bool(b) => Value::Bool(*b),
        Value::Number(n) => {
            if let Some(f) = n.as_f64() {
                if f.is_nan() || f.is_infinite() {
                    return Value::Null;
                }
                // -0 → 0
                if f == 0.0 && f.is_sign_negative() {
                    return serde_json::json!(0);
                }
                // Keep as-is (serde_json preserves int vs float)
                Value::Number(n.clone())
            } else {
                Value::Number(n.clone())
            }
        }
        Value::String(s) => {
            // NFKC normalize + strip trailing whitespace per line
            let normalized: String = s.nfkc().collect();
            let stripped: Vec<&str> = normalized
                .lines()
                .map(|line| line.trim_end())
                .collect();
            Value::String(stripped.join("\n"))
        }
        Value::Array(arr) => {
            Value::Array(arr.iter().map(canonicalize).collect())
        }
        Value::Object(obj) => {
            // Sort keys lexicographically
            let mut sorted: Vec<(&String, &Value)> = obj.iter().collect();
            sorted.sort_by(|a, b| a.0.cmp(b.0));

            let mut map = Map::new();
            for (k, v) in sorted {
                let canonical_val = canonicalize(v);
                // Omit undefined — JSON has no undefined, so nothing to do
                map.insert(k.clone(), canonical_val);
            }
            Value::Object(map)
        }
    }
}

// ── TENS v2 Binary Encoder ──

pub struct TensEncoder {
    pub registry: SchemaRegistry,
    string_table: StringTable,
}

impl TensEncoder {
    pub fn new() -> Self {
        TensEncoder {
            registry: SchemaRegistry::new(),
            string_table: StringTable::new(),
        }
    }

    /// Encode a JSON value into TENS v2 binary format.
    /// Returns the raw bytes (header + dictionary + value tree).
    pub fn encode(&mut self, value: &Value) -> Vec<u8> {
        // 1. Canonicalize
        let canonical = canonicalize(value);

        // 2. Scan pass: collect all strings in DFS order (keys sorted)
        self.string_table = StringTable::new();
        self.scan_strings(&canonical);

        // 3. Emit binary
        let mut out = Vec::new();

        // Header
        out.extend_from_slice(HEADER);

        // Dictionary: varint(count), then for each string: varint(utf8_len) + utf8_bytes
        out.extend_from_slice(&encode_varint(self.string_table.len() as u32));
        for entry in self.string_table.entries() {
            let bytes = entry.as_bytes();
            out.extend_from_slice(&encode_varint(bytes.len() as u32));
            out.extend_from_slice(bytes);
        }

        // Value tree
        self.encode_value(&canonical, &mut out);

        out
    }

    /// Scan all strings in DFS order to populate the string table.
    /// Object keys are visited in sorted order (canonical).
    fn scan_strings(&mut self, value: &Value) {
        match value {
            Value::String(s) => {
                self.string_table.add(s);
            }
            Value::Array(arr) => {
                for item in arr {
                    self.scan_strings(item);
                }
            }
            Value::Object(obj) => {
                // Keys are already sorted from canonicalize
                let mut keys: Vec<&String> = obj.keys().collect();
                keys.sort();
                for key in &keys {
                    self.string_table.add(key);
                }
                for key in &keys {
                    if let Some(val) = obj.get(*key) {
                        self.scan_strings(val);
                    }
                }
            }
            _ => {}
        }
    }

    /// Encode a single value into the output buffer.
    fn encode_value(&mut self, value: &Value, out: &mut Vec<u8>) {
        match value {
            Value::Null => {
                out.push(OP_NULL);
            }
            Value::Bool(b) => {
                out.push(if *b { OP_TRUE } else { OP_FALSE });
            }
            Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    if i >= -128 && i <= 127 {
                        out.push(OP_INT8);
                        out.push(i as i8 as u8);
                    } else if i >= i32::MIN as i64 && i <= i32::MAX as i64 {
                        out.push(OP_INT32);
                        out.extend_from_slice(&(i as i32).to_le_bytes());
                    } else {
                        // Large integer → float64
                        out.push(OP_FLOAT64);
                        out.extend_from_slice(&(i as f64).to_le_bytes());
                    }
                } else if let Some(f) = n.as_f64() {
                    // Check if it's actually an integer value stored as float
                    if f.fract() == 0.0 && f.abs() < (i32::MAX as f64) {
                        let i = f as i32;
                        if i >= -128 && i <= 127 {
                            out.push(OP_INT8);
                            out.push(i as i8 as u8);
                        } else {
                            out.push(OP_INT32);
                            out.extend_from_slice(&i.to_le_bytes());
                        }
                    } else {
                        out.push(OP_FLOAT64);
                        out.extend_from_slice(&f.to_le_bytes());
                    }
                }
            }
            Value::String(s) => {
                let id = self.string_table.add(s);
                out.push(OP_STRING_REF);
                out.extend_from_slice(&encode_varint(id));
            }
            Value::Array(arr) => {
                out.push(OP_ARRAY_START);
                out.extend_from_slice(&encode_varint(arr.len() as u32));
                for item in arr {
                    self.encode_value(item, out);
                }
            }
            Value::Object(obj) => {
                // Keys sorted (already canonical)
                let mut keys: Vec<&String> = obj.keys().collect();
                keys.sort();

                out.push(OP_OBJECT_START);
                out.extend_from_slice(&encode_varint(keys.len() as u32));
                for key in &keys {
                    let key_id = self.string_table.add(key);
                    out.extend_from_slice(&encode_varint(key_id));
                    if let Some(val) = obj.get(*key) {
                        self.encode_value(val, out);
                    }
                }
            }
        }
    }

    /// Get the string table entries (for inspection/testing).
    pub fn string_table_entries(&self) -> &[String] {
        self.string_table.entries()
    }
}

// ── TENS v2 Binary Decoder ──

pub struct TensDecoder {
    dictionary: Vec<String>,
}

impl TensDecoder {
    pub fn new() -> Self {
        TensDecoder {
            dictionary: Vec::new(),
        }
    }

    /// Decode TENS v2 binary bytes back into a JSON Value.
    pub fn decode(&mut self, bytes: &[u8]) -> Result<Value, String> {
        if bytes.len() < 5 {
            return Err("Input too short for TENS header".into());
        }
        if &bytes[0..4] != b"TENS" {
            return Err("Invalid TENS header magic".into());
        }
        if bytes[4] != 0x02 {
            return Err(format!("Unsupported TENS version: {}", bytes[4]));
        }

        let mut pos = 5;

        // Read dictionary
        let (dict_count, consumed) = decode_varint(&bytes[pos..]);
        pos += consumed;

        self.dictionary = Vec::with_capacity(dict_count as usize);
        for _ in 0..dict_count {
            let (str_len, consumed) = decode_varint(&bytes[pos..]);
            pos += consumed;
            let end = pos + str_len as usize;
            if end > bytes.len() {
                return Err("Dictionary string extends past end of input".into());
            }
            let s = String::from_utf8(bytes[pos..end].to_vec())
                .map_err(|e| format!("Invalid UTF-8 in dictionary: {}", e))?;
            self.dictionary.push(s);
            pos = end;
        }

        // Read value tree
        let (value, _consumed) = self.decode_value(&bytes[pos..])?;
        Ok(value)
    }

    fn decode_value(&self, bytes: &[u8]) -> Result<(Value, usize), String> {
        if bytes.is_empty() {
            return Err("Unexpected end of input".into());
        }

        let opcode = bytes[0];
        let mut pos = 1;

        match opcode {
            OP_NULL => Ok((Value::Null, pos)),

            OP_TRUE => Ok((Value::Bool(true), pos)),

            OP_FALSE => Ok((Value::Bool(false), pos)),

            OP_INT8 => {
                if bytes.len() < 2 {
                    return Err("INT8: missing byte".into());
                }
                let val = bytes[1] as i8 as i64;
                Ok((serde_json::json!(val), 2))
            }

            OP_INT32 => {
                if bytes.len() < 5 {
                    return Err("INT32: not enough bytes".into());
                }
                let val = i32::from_le_bytes([bytes[1], bytes[2], bytes[3], bytes[4]]) as i64;
                Ok((serde_json::json!(val), 5))
            }

            OP_FLOAT64 => {
                if bytes.len() < 9 {
                    return Err("FLOAT64: not enough bytes".into());
                }
                let val = f64::from_le_bytes([
                    bytes[1], bytes[2], bytes[3], bytes[4],
                    bytes[5], bytes[6], bytes[7], bytes[8],
                ]);
                Ok((serde_json::json!(val), 9))
            }

            OP_STRING_REF => {
                let (id, consumed) = decode_varint(&bytes[pos..]);
                pos += consumed;
                if (id as usize) >= self.dictionary.len() {
                    return Err(format!("String ref {} out of bounds (dict size {})", id, self.dictionary.len()));
                }
                Ok((Value::String(self.dictionary[id as usize].clone()), pos))
            }

            OP_ARRAY_START => {
                let (count, consumed) = decode_varint(&bytes[pos..]);
                pos += consumed;
                let mut arr = Vec::with_capacity(count as usize);
                for _ in 0..count {
                    let (val, consumed) = self.decode_value(&bytes[pos..])?;
                    pos += consumed;
                    arr.push(val);
                }
                Ok((Value::Array(arr), pos))
            }

            OP_OBJECT_START => {
                let (count, consumed) = decode_varint(&bytes[pos..]);
                pos += consumed;
                let mut map = Map::new();
                for _ in 0..count {
                    let (key_id, consumed) = decode_varint(&bytes[pos..]);
                    pos += consumed;
                    if (key_id as usize) >= self.dictionary.len() {
                        return Err(format!("Key ref {} out of bounds", key_id));
                    }
                    let key = self.dictionary[key_id as usize].clone();
                    let (val, consumed) = self.decode_value(&bytes[pos..])?;
                    pos += consumed;
                    map.insert(key, val);
                }
                Ok((Value::Object(map), pos))
            }

            _ => Err(format!("Unknown opcode: 0x{:02x}", opcode)),
        }
    }
}

// ── TENS-Text Encoder ──

/// Infer a TENS-Text type label from a JSON value.
fn infer_type(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::Number(_) => "num",
        Value::String(_) => "str",
        Value::Array(_) => "str[]", // arrays encoded as repeated fields
        Value::Object(_) => "str",  // nested objects serialized as string
    }
}

/// Check if a string needs quoting in TENS-Text.
fn needs_quoting(s: &str) -> bool {
    if s.is_empty() {
        return true;
    }
    if s == "_" || s == "true" || s == "false" {
        return true;
    }
    // Looks like a dict ref @N or #N
    if (s.starts_with('@') || s.starts_with('#')) && s[1..].parse::<u32>().is_ok() {
        return true;
    }
    // Looks like a number
    if s.parse::<f64>().is_ok() {
        return true;
    }
    // Contains special characters
    s.chars().any(|c| {
        c.is_whitespace() || matches!(c, '"' | '\\' | '|' | '>' | ',' | '=' | '{' | '}' | '[' | ']' | '@' | '#')
    })
}

/// Quote a string with TENS-Text escape rules.
fn quote_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Format a value for TENS-Text output.
fn format_tens_text_value(value: &Value, dict_map: &HashMap<String, usize>) -> String {
    match value {
        Value::Null => "_".to_string(),
        Value::Bool(true) => "true".to_string(),
        Value::Bool(false) => "false".to_string(),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                i.to_string()
            } else if let Some(f) = n.as_f64() {
                if f.is_nan() {
                    "\"NaN\"".to_string()
                } else if f.is_infinite() {
                    if f.is_sign_positive() {
                        "\"Infinity\"".to_string()
                    } else {
                        "\"-Infinity\"".to_string()
                    }
                } else if f == 0.0 && f.is_sign_negative() {
                    "-0".to_string()
                } else {
                    format!("{}", f)
                }
            } else {
                n.to_string()
            }
        }
        Value::String(s) => {
            // Check dictionary
            if let Some(&idx) = dict_map.get(s) {
                return format!("@{}", idx);
            }
            if needs_quoting(s) {
                quote_string(s)
            } else {
                s.clone()
            }
        }
        Value::Array(_) | Value::Object(_) => {
            // Shouldn't happen at field level — arrays handled externally
            let s = serde_json::to_string(value).unwrap_or_default();
            quote_string(&s)
        }
    }
}

/// Encode an array of objects into TENS-Text format.
pub fn encode_tens_text(data: &Value, encoding: Option<&str>) -> Result<String, String> {
    let canonical = canonicalize(data);
    let records = match &canonical {
        Value::Array(arr) => arr.clone(),
        Value::Object(_) => vec![canonical.clone()],
        _ => return Err("TENS-Text requires an array of objects or a single object".into()),
    };

    if records.is_empty() {
        return Ok("@version 1\n".to_string());
    }

    // 1. Extract schema from first record
    let first = records.first().unwrap();
    let obj = first.as_object().ok_or("Records must be objects")?;
    let mut keys: Vec<String> = obj.keys().cloned().collect();
    keys.sort();

    // Infer types from first record
    let types: Vec<&str> = keys.iter().map(|k| {
        infer_type(obj.get(k).unwrap_or(&Value::Null))
    }).collect();

    // Determine array fields across all records
    let mut is_array_field: Vec<bool> = vec![false; keys.len()];
    for record in &records {
        if let Some(obj) = record.as_object() {
            for (i, key) in keys.iter().enumerate() {
                if let Some(Value::Array(_)) = obj.get(key) {
                    is_array_field[i] = true;
                }
            }
        }
    }

    // 2. Build dictionary (strings appearing ≥2 times as values)
    let mut string_counts: HashMap<String, usize> = HashMap::new();
    for record in &records {
        if let Some(obj) = record.as_object() {
            for key in &keys {
                if let Some(Value::String(s)) = obj.get(key) {
                    *string_counts.entry(s.clone()).or_insert(0) += 1;
                }
            }
        }
    }

    let mut dict_entries: Vec<String> = string_counts
        .iter()
        .filter(|(_, &count)| count >= 2)
        .map(|(s, _)| s.clone())
        .collect();
    dict_entries.sort();

    let dict_map: HashMap<String, usize> = dict_entries
        .iter()
        .enumerate()
        .map(|(i, s)| (s.clone(), i))
        .collect();

    // 3. Build output
    let mut out = String::new();

    // Directives
    out.push_str("@version 1\n");
    if let Some(enc) = encoding {
        out.push_str(&format!("@encoding {}\n", enc));
    }

    // Schema line: @schema <name> field:type field:type?
    let schema_name = "data";
    out.push_str(&format!("@schema {}", schema_name));
    for (i, key) in keys.iter().enumerate() {
        let type_str = types[i];
        let suffix = if is_array_field[i] { "[]" } else { "" };
        out.push_str(&format!(" {}:{}{}", key, type_str, suffix));
    }
    out.push('\n');

    // Dictionary line
    if !dict_entries.is_empty() {
        out.push_str("@dict");
        for entry in &dict_entries {
            if needs_quoting(entry) {
                out.push_str(&format!(" {}", quote_string(entry)));
            } else {
                out.push_str(&format!(" {}", entry));
            }
        }
        out.push('\n');
    }

    // Records
    out.push('\n');
    for record in &records {
        if let Some(obj) = record.as_object() {
            out.push_str(&format!("{}\n", schema_name));
            for (i, key) in keys.iter().enumerate() {
                if let Some(val) = obj.get(key) {
                    if is_array_field[i] {
                        if let Value::Array(arr) = val {
                            for item in arr {
                                out.push_str(&format!("  {} {}\n", key, format_tens_text_value(item, &dict_map)));
                            }
                        }
                    } else {
                        out.push_str(&format!("  {} {}\n", key, format_tens_text_value(val, &dict_map)));
                    }
                }
            }
        }
    }

    Ok(out)
}

/// Decode TENS-Text format back into a JSON Value (array of objects).
pub fn decode_tens_text(input: &str) -> Result<Value, String> {
    let mut dict: Vec<String> = Vec::new();
    let mut schema_name = String::new();
    let mut schema_fields: Vec<(String, String)> = Vec::new(); // (name, type)
    let mut records: Vec<Value> = Vec::new();
    let mut current_record: Option<Map<String, Value>> = None;
    let mut array_fields: std::collections::HashSet<String> = std::collections::HashSet::new();

    for line in input.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        if trimmed.starts_with("@version") {
            continue;
        }
        if trimmed.starts_with("@encoding") {
            continue;
        }
        if trimmed.starts_with("@schema") {
            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            if parts.len() >= 2 {
                schema_name = parts[1].to_string();
                schema_fields.clear();
                for part in &parts[2..] {
                    if let Some((name, type_str)) = part.split_once(':') {
                        if type_str.ends_with("[]") {
                            array_fields.insert(name.to_string());
                            schema_fields.push((name.to_string(), type_str.trim_end_matches("[]").to_string()));
                        } else {
                            schema_fields.push((name.to_string(), type_str.to_string()));
                        }
                    }
                }
            }
            continue;
        }
        if trimmed.starts_with("@dict") {
            dict = parse_dict_line(trimmed);
            continue;
        }

        // Schema name line → start new record
        if trimmed == schema_name {
            if let Some(rec) = current_record.take() {
                records.push(Value::Object(rec));
            }
            current_record = Some(Map::new());
            continue;
        }

        // Field line (indented)
        if line.starts_with("  ") && current_record.is_some() {
            let field_line = trimmed;
            if let Some((field_name, raw_value)) = field_line.split_once(char::is_whitespace) {
                let raw_value = raw_value.trim();
                let parsed = parse_tens_text_value(raw_value, &dict);

                let rec = current_record.as_mut().unwrap();
                if array_fields.contains(field_name) {
                    let arr = rec.entry(field_name.to_string())
                        .or_insert_with(|| Value::Array(Vec::new()));
                    if let Value::Array(a) = arr {
                        a.push(parsed);
                    }
                } else {
                    rec.insert(field_name.to_string(), parsed);
                }
            }
        }
    }

    // Flush last record
    if let Some(rec) = current_record.take() {
        records.push(Value::Object(rec));
    }

    if records.len() == 1 {
        Ok(records.into_iter().next().unwrap())
    } else {
        Ok(Value::Array(records))
    }
}

/// Parse TENS-Text @dict line into list of entries.
fn parse_dict_line(line: &str) -> Vec<String> {
    let content = line.strip_prefix("@dict").unwrap_or("").trim();
    let mut entries = Vec::new();
    let mut chars = content.chars().peekable();

    while chars.peek().is_some() {
        // Skip whitespace
        while chars.peek().map(|c| c.is_whitespace()).unwrap_or(false) {
            chars.next();
        }
        if chars.peek().is_none() {
            break;
        }

        if chars.peek() == Some(&'"') {
            // Quoted string
            chars.next(); // consume opening quote
            let mut s = String::new();
            loop {
                match chars.next() {
                    Some('\\') => {
                        match chars.next() {
                            Some('n') => s.push('\n'),
                            Some('r') => s.push('\r'),
                            Some('t') => s.push('\t'),
                            Some(c) => s.push(c),
                            None => break,
                        }
                    }
                    Some('"') => break,
                    Some(c) => s.push(c),
                    None => break,
                }
            }
            entries.push(s);
        } else {
            // Unquoted token
            let mut s = String::new();
            while chars.peek().map(|c| !c.is_whitespace()).unwrap_or(false) {
                s.push(chars.next().unwrap());
            }
            entries.push(s);
        }
    }

    entries
}

/// Parse a single TENS-Text value string.
fn parse_tens_text_value(raw: &str, dict: &[String]) -> Value {
    match raw {
        "_" => Value::Null,
        "true" => Value::Bool(true),
        "false" => Value::Bool(false),
        s if s.starts_with('@') => {
            if let Ok(idx) = s[1..].parse::<usize>() {
                if idx < dict.len() {
                    return Value::String(dict[idx].clone());
                }
            }
            Value::String(s.to_string())
        }
        s if s.starts_with('"') && s.ends_with('"') => {
            // Unquote
            let inner = &s[1..s.len() - 1];
            let mut result = String::new();
            let mut chars = inner.chars();
            loop {
                match chars.next() {
                    Some('\\') => match chars.next() {
                        Some('n') => result.push('\n'),
                        Some('r') => result.push('\r'),
                        Some('t') => result.push('\t'),
                        Some(c) => result.push(c),
                        None => break,
                    },
                    Some(c) => result.push(c),
                    None => break,
                }
            }
            // Check for special number strings
            match result.as_str() {
                "NaN" | "Infinity" | "-Infinity" => Value::String(result),
                _ => Value::String(result),
            }
        }
        s => {
            // Try parsing as number
            if let Ok(i) = s.parse::<i64>() {
                serde_json::json!(i)
            } else if let Ok(f) = s.parse::<f64>() {
                serde_json::json!(f)
            } else {
                Value::String(s.to_string())
            }
        }
    }
}

// ── SHA-256 Hashing ──

use sha2::{Sha256, Digest};

/// Compute SHA-256 hex hash of TENS binary bytes (matches TS hashing.ts).
pub fn hash_tens_binary(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let result = hasher.finalize();
    hex_encode(&result)
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use crate::utils::{encode_varint, decode_varint};

    // ── Varint tests ──

    #[test]
    fn test_varint_single_byte() {
        let encoded = encode_varint(0);
        assert_eq!(encoded, vec![0]);
        let (val, len) = decode_varint(&encoded);
        assert_eq!(val, 0);
        assert_eq!(len, 1);
    }

    #[test]
    fn test_varint_127() {
        let encoded = encode_varint(127);
        assert_eq!(encoded, vec![127]);
        let (val, _) = decode_varint(&encoded);
        assert_eq!(val, 127);
    }

    #[test]
    fn test_varint_128() {
        let encoded = encode_varint(128);
        assert_eq!(encoded, vec![0x80, 0x01]);
        let (val, len) = decode_varint(&encoded);
        assert_eq!(val, 128);
        assert_eq!(len, 2);
    }

    #[test]
    fn test_varint_300() {
        let encoded = encode_varint(300);
        let (val, _) = decode_varint(&encoded);
        assert_eq!(val, 300);
    }

    #[test]
    fn test_varint_large() {
        let encoded = encode_varint(100_000);
        let (val, _) = decode_varint(&encoded);
        assert_eq!(val, 100_000);
    }

    // ── Header tests ──

    #[test]
    fn test_binary_header() {
        let mut enc = TensEncoder::new();
        let bytes = enc.encode(&json!(null));
        assert_eq!(&bytes[0..5], b"TENS\x02");
    }

    // ── Null encoding ──

    #[test]
    fn test_encode_null() {
        let mut enc = TensEncoder::new();
        let bytes = enc.encode(&json!(null));
        // Header(5) + dict_count varint(1 byte = 0) + OP_NULL(1)
        assert_eq!(bytes.len(), 7);
        assert_eq!(bytes[5], 0); // dict count = 0
        assert_eq!(bytes[6], OP_NULL);
    }

    // ── Boolean encoding ──

    #[test]
    fn test_encode_true() {
        let mut enc = TensEncoder::new();
        let bytes = enc.encode(&json!(true));
        assert_eq!(bytes[6], OP_TRUE);
    }

    #[test]
    fn test_encode_false() {
        let mut enc = TensEncoder::new();
        let bytes = enc.encode(&json!(false));
        assert_eq!(bytes[6], OP_FALSE);
    }

    // ── Number encoding ──

    #[test]
    fn test_encode_int8_zero() {
        let mut enc = TensEncoder::new();
        let bytes = enc.encode(&json!(0));
        assert_eq!(bytes[6], OP_INT8);
        assert_eq!(bytes[7], 0u8);
    }

    #[test]
    fn test_encode_int8_positive() {
        let mut enc = TensEncoder::new();
        let bytes = enc.encode(&json!(42));
        assert_eq!(bytes[6], OP_INT8);
        assert_eq!(bytes[7], 42u8);
    }

    #[test]
    fn test_encode_int8_negative() {
        let mut enc = TensEncoder::new();
        let bytes = enc.encode(&json!(-1));
        assert_eq!(bytes[6], OP_INT8);
        assert_eq!(bytes[7], 0xFFu8); // -1 as i8 = 0xFF
    }

    #[test]
    fn test_encode_int8_max() {
        let mut enc = TensEncoder::new();
        let bytes = enc.encode(&json!(127));
        assert_eq!(bytes[6], OP_INT8);
        assert_eq!(bytes[7], 127u8);
    }

    #[test]
    fn test_encode_int8_min() {
        let mut enc = TensEncoder::new();
        let bytes = enc.encode(&json!(-128));
        assert_eq!(bytes[6], OP_INT8);
        assert_eq!(bytes[7], 0x80u8); // -128 as i8 = 0x80
    }

    #[test]
    fn test_encode_int32() {
        let mut enc = TensEncoder::new();
        let bytes = enc.encode(&json!(1000));
        assert_eq!(bytes[6], OP_INT32);
        let val = i32::from_le_bytes([bytes[7], bytes[8], bytes[9], bytes[10]]);
        assert_eq!(val, 1000);
    }

    #[test]
    fn test_encode_int32_negative() {
        let mut enc = TensEncoder::new();
        let bytes = enc.encode(&json!(-500));
        assert_eq!(bytes[6], OP_INT32);
        let val = i32::from_le_bytes([bytes[7], bytes[8], bytes[9], bytes[10]]);
        assert_eq!(val, -500);
    }

    #[test]
    fn test_encode_float64() {
        let mut enc = TensEncoder::new();
        let bytes = enc.encode(&json!(3.14));
        assert_eq!(bytes[6], OP_FLOAT64);
        let val = f64::from_le_bytes([
            bytes[7], bytes[8], bytes[9], bytes[10],
            bytes[11], bytes[12], bytes[13], bytes[14],
        ]);
        assert!((val - 3.14).abs() < f64::EPSILON);
    }

    // ── String encoding ──

    #[test]
    fn test_encode_string() {
        let mut enc = TensEncoder::new();
        let bytes = enc.encode(&json!("hello"));
        // Dict: 1 entry "hello"
        assert_eq!(bytes[5], 1); // dict count
        // Dict[0]: varint(5) + "hello"
        assert_eq!(bytes[6], 5); // string length
        assert_eq!(&bytes[7..12], b"hello");
        // Value: STRING_REF + varint(0)
        assert_eq!(bytes[12], OP_STRING_REF);
        assert_eq!(bytes[13], 0); // string table index 0
    }

    #[test]
    fn test_string_dedup() {
        let mut enc = TensEncoder::new();
        let bytes = enc.encode(&json!(["hello", "hello", "world"]));
        // Should have 2 dict entries: "hello" and "world"
        assert_eq!(bytes[5], 2); // dict count
    }

    // ── Array encoding ──

    #[test]
    fn test_encode_empty_array() {
        let mut enc = TensEncoder::new();
        let bytes = enc.encode(&json!([]));
        assert_eq!(bytes[6], OP_ARRAY_START);
        assert_eq!(bytes[7], 0); // length 0
    }

    #[test]
    fn test_encode_array() {
        let mut enc = TensEncoder::new();
        let bytes = enc.encode(&json!([1, 2, 3]));
        assert_eq!(bytes[6], OP_ARRAY_START);
        assert_eq!(bytes[7], 3); // length 3
        // Each element: OP_INT8 + byte
        assert_eq!(bytes[8], OP_INT8);
        assert_eq!(bytes[9], 1);
        assert_eq!(bytes[10], OP_INT8);
        assert_eq!(bytes[11], 2);
        assert_eq!(bytes[12], OP_INT8);
        assert_eq!(bytes[13], 3);
    }

    // ── Object encoding ──

    #[test]
    fn test_encode_empty_object() {
        let mut enc = TensEncoder::new();
        let bytes = enc.encode(&json!({}));
        assert_eq!(bytes[6], OP_OBJECT_START);
        assert_eq!(bytes[7], 0); // 0 fields
    }

    #[test]
    fn test_encode_object_sorted_keys() {
        let mut enc = TensEncoder::new();
        let bytes = enc.encode(&json!({"b": 2, "a": 1}));
        // Dict should be: "a", "b" (sorted key scan order)
        let entries = enc.string_table_entries();
        assert_eq!(entries, &["a", "b"]);
    }

    // ── Canonicalization tests ──

    #[test]
    fn test_canonicalize_sorts_keys() {
        let val = json!({"c": 3, "a": 1, "b": 2});
        let canonical = canonicalize(&val);
        let obj = canonical.as_object().unwrap();
        let keys: Vec<&String> = obj.keys().collect();
        assert_eq!(keys, vec!["a", "b", "c"]);
    }

    #[test]
    fn test_canonicalize_nested_sort() {
        let val = json!({"z": {"b": 1, "a": 2}, "m": 3});
        let canonical = canonicalize(&val);
        let outer_keys: Vec<&String> = canonical.as_object().unwrap().keys().collect();
        assert_eq!(outer_keys, vec!["m", "z"]);
        let inner_keys: Vec<&String> = canonical["z"].as_object().unwrap().keys().collect();
        assert_eq!(inner_keys, vec!["a", "b"]);
    }

    // ── Round-trip tests ──

    #[test]
    fn test_roundtrip_null() {
        let mut enc = TensEncoder::new();
        let mut dec = TensDecoder::new();
        let bytes = enc.encode(&json!(null));
        let decoded = dec.decode(&bytes).unwrap();
        assert_eq!(decoded, json!(null));
    }

    #[test]
    fn test_roundtrip_bool() {
        let mut enc = TensEncoder::new();
        let mut dec = TensDecoder::new();
        let bytes = enc.encode(&json!(true));
        assert_eq!(dec.decode(&bytes).unwrap(), json!(true));

        let bytes = enc.encode(&json!(false));
        assert_eq!(dec.decode(&bytes).unwrap(), json!(false));
    }

    #[test]
    fn test_roundtrip_integers() {
        let mut enc = TensEncoder::new();
        for val in &[0, 1, -1, 42, -128, 127, 128, -500, 1000, 100_000, -100_000] {
            let bytes = enc.encode(&json!(val));
            let mut dec = TensDecoder::new();
            let decoded = dec.decode(&bytes).unwrap();
            assert_eq!(decoded.as_i64().unwrap(), *val as i64, "roundtrip failed for {}", val);
        }
    }

    #[test]
    fn test_roundtrip_float() {
        let mut enc = TensEncoder::new();
        let bytes = enc.encode(&json!(3.14159));
        let mut dec = TensDecoder::new();
        let decoded = dec.decode(&bytes).unwrap();
        assert!((decoded.as_f64().unwrap() - 3.14159).abs() < f64::EPSILON);
    }

    #[test]
    fn test_roundtrip_string() {
        let mut enc = TensEncoder::new();
        let bytes = enc.encode(&json!("hello world"));
        let mut dec = TensDecoder::new();
        let decoded = dec.decode(&bytes).unwrap();
        assert_eq!(decoded.as_str().unwrap(), "hello world");
    }

    #[test]
    fn test_roundtrip_array() {
        let mut enc = TensEncoder::new();
        let original = json!([1, "two", true, null, 3.5]);
        let bytes = enc.encode(&original);
        let mut dec = TensDecoder::new();
        let decoded = dec.decode(&bytes).unwrap();

        let arr = decoded.as_array().unwrap();
        assert_eq!(arr.len(), 5);
        assert_eq!(arr[0].as_i64().unwrap(), 1);
        assert_eq!(arr[1].as_str().unwrap(), "two");
        assert_eq!(arr[2].as_bool().unwrap(), true);
        assert!(arr[3].is_null());
    }

    #[test]
    fn test_roundtrip_object() {
        let mut enc = TensEncoder::new();
        let original = json!({"name": "Alice", "age": 30, "active": true});
        let bytes = enc.encode(&original);
        let mut dec = TensDecoder::new();
        let decoded = dec.decode(&bytes).unwrap();

        assert_eq!(decoded["name"].as_str().unwrap(), "Alice");
        assert_eq!(decoded["age"].as_i64().unwrap(), 30);
        assert_eq!(decoded["active"].as_bool().unwrap(), true);
    }

    #[test]
    fn test_roundtrip_nested() {
        let mut enc = TensEncoder::new();
        let original = json!({
            "users": [
                {"name": "Alice", "scores": [100, 95, 88]},
                {"name": "Bob", "scores": [72, 85]}
            ],
            "meta": {"version": 2, "format": "tens"}
        });
        let bytes = enc.encode(&original);
        let mut dec = TensDecoder::new();
        let decoded = dec.decode(&bytes).unwrap();

        assert_eq!(decoded["users"][0]["name"].as_str().unwrap(), "Alice");
        assert_eq!(decoded["users"][1]["scores"][0].as_i64().unwrap(), 72);
        assert_eq!(decoded["meta"]["version"].as_i64().unwrap(), 2);
    }

    // ── Hash tests ──

    #[test]
    fn test_hash_deterministic() {
        let mut enc = TensEncoder::new();
        let bytes1 = enc.encode(&json!({"a": 1}));
        let bytes2 = enc.encode(&json!({"a": 1}));
        assert_eq!(hash_tens_binary(&bytes1), hash_tens_binary(&bytes2));
    }

    #[test]
    fn test_hash_different_for_different_values() {
        let mut enc = TensEncoder::new();
        let bytes1 = enc.encode(&json!({"a": 1}));
        let bytes2 = enc.encode(&json!({"a": 2}));
        assert_ne!(hash_tens_binary(&bytes1), hash_tens_binary(&bytes2));
    }

    #[test]
    fn test_hash_length() {
        let mut enc = TensEncoder::new();
        let bytes = enc.encode(&json!({"test": "data"}));
        let hash = hash_tens_binary(&bytes);
        assert_eq!(hash.len(), 64); // SHA-256 = 32 bytes = 64 hex chars
    }

    // ── TENS-Text tests ──

    #[test]
    fn test_tens_text_basic() {
        let data = json!([
            {"name": "Alice", "age": 30},
            {"name": "Bob", "age": 25}
        ]);
        let text = encode_tens_text(&data, None).unwrap();
        assert!(text.starts_with("@version 1"));
        assert!(text.contains("@schema"));
        assert!(text.contains("Alice"));
        assert!(text.contains("Bob"));
    }

    #[test]
    fn test_tens_text_dict_dedup() {
        let data = json!([
            {"status": "active", "name": "A"},
            {"status": "active", "name": "B"},
            {"status": "active", "name": "C"}
        ]);
        let text = encode_tens_text(&data, None).unwrap();
        assert!(text.contains("@dict"));
        assert!(text.contains("active"));
        // "active" appears 3 times → should be in dict
        // Records should reference @0
        assert!(text.contains("@0"));
    }

    #[test]
    fn test_tens_text_roundtrip() {
        let data = json!([
            {"name": "Alice", "score": 95},
            {"name": "Bob", "score": 88}
        ]);
        let text = encode_tens_text(&data, None).unwrap();
        let decoded = decode_tens_text(&text).unwrap();
        let arr = decoded.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["name"].as_str().unwrap(), "Alice");
        assert_eq!(arr[1]["score"].as_i64().unwrap(), 88);
    }

    #[test]
    fn test_tens_text_null_value() {
        let data = json!([{"val": null}]);
        let text = encode_tens_text(&data, None).unwrap();
        assert!(text.contains("  val _"));
    }

    // ── Decoder error handling ──

    #[test]
    fn test_decode_empty_input() {
        let mut dec = TensDecoder::new();
        assert!(dec.decode(&[]).is_err());
    }

    #[test]
    fn test_decode_bad_magic() {
        let mut dec = TensDecoder::new();
        assert!(dec.decode(b"NOPE\x02\x00").is_err());
    }

    #[test]
    fn test_decode_bad_version() {
        let mut dec = TensDecoder::new();
        assert!(dec.decode(b"TENS\x99\x00").is_err());
    }
}

