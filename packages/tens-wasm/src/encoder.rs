use wasm_bindgen::prelude::*;
use serde_json::{Value, Map};
use std::collections::HashMap;
use crate::schema::{SchemaRegistry, SchemaId};

// TENS v2 Control Tokens
const CTRL_SCHEMA_DEF: u32 = 200_000;
const CTRL_SCHEMA_REF: u32 = 200_001;
const CTRL_DICT_DEF: u32   = 200_002;
const CTRL_DICT_REF: u32   = 200_003;
const CTRL_NULL: u32       = 200_004;
const CTRL_TRUE: u32       = 200_005;
const CTRL_FALSE: u32      = 200_006;
const CTRL_EOO: u32        = 200_007; // End of Object
const CTRL_EOA: u32        = 200_008; // End of Array

pub struct TokenStreamEncoder {
    registry: SchemaRegistry,
    dictionary: HashMap<String, u32>, // value -> dictionary_id
    tokens: Vec<u32>,
    strings: Vec<String>,
}

impl TokenStreamEncoder {
    pub fn new() -> Self {
        TokenStreamEncoder {
            registry: SchemaRegistry::new(),
            dictionary: HashMap::new(),
            tokens: Vec::new(),
            strings: Vec::new(),
        }
    }

    pub fn encode(&mut self, value: &Value) {
        self.encode_value(value);
    }

    fn encode_value(&mut self, value: &Value) {
        match value {
            Value::Null => self.push_token(CTRL_NULL),
            Value::Bool(b) => self.push_token(if *b { CTRL_TRUE } else { CTRL_FALSE }),
            Value::Number(n) => {
                // For now, treat numbers as strings for simplicity in this scaffold.
                // In production, we'd have a specific localized handling or float tokens.
                self.encode_string(&n.to_string());
            }
            Value::String(s) => self.encode_string(s),
            Value::Array(arr) => {
                // For arrays, we just emit tokens sequentially, ending with EOA if needed
                // TENS v2 usually implies structure, but for raw arrays we might need a marker.
                // Assuming standard array behavior for now.
                for item in arr {
                    self.encode_value(item);
                }
                self.push_token(CTRL_EOA);
            }
            Value::Object(obj) => self.encode_object(obj),
        }
    }

    fn encode_string(&mut self, s: &str) {
        // Todo: implement dictionary lookup
        // For now, raw string emission (simulated by pushing to strings list)
        // In real TENS, this would be a token ID pointing to a string table or 
        // a BPE token sequence.
        // Here we just placeholder it.
        self.strings.push(s.to_string());
        // self.push_token(CTRL_STRING_REF + id);
    }

    fn encode_object(&mut self, obj: &Map<String, Value>) {
        if obj.is_empty() {
            self.push_token(CTRL_EOO);
            return;
        }

        // 1. Flatten (not fully implemented here, assuming flat for now or doing inline)
        // 2. Extract keys
        let keys: Vec<String> = obj.keys().cloned().collect();
        
        // 3. Register Schema
        let (schema_id, is_new) = self.registry.get_or_register(&keys);

        // 4. Emit Schema Reference
        if is_new {
            self.push_token(CTRL_SCHEMA_DEF);
            self.push_token(schema_id);
            // Emit keys...
        } else {
            self.push_token(CTRL_SCHEMA_REF);
            self.push_token(schema_id);
        }

        // 5. Emit Values in Schema Order
        // We need to look up the schema to get the sorted key order
        if let Some(schema) = self.registry.get(schema_id) {
            for key in &schema.keys {
                match obj.get(key) {
                    Some(val) => self.encode_value(val),
                    None => self.push_token(CTRL_NULL),
                }
            }
        }
    }

    fn push_token(&mut self, token: u32) {
        self.tokens.push(token);
    }

    pub fn get_tokens(&self) -> Vec<u32> {
        self.tokens.clone()
    }
}
