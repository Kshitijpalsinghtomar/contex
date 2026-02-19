mod utils;
mod schema;
mod encoder;

use wasm_bindgen::prelude::*;
use serde_json::Value;
use crate::encoder::{TensEncoder as InnerEncoder, TensDecoder, encode_tens_text, hash_tens_binary};

#[wasm_bindgen(start)]
pub fn init() {
    utils::set_panic_hook();
}

/// WASM-exposed TENS v2 encoder.
#[wasm_bindgen]
pub struct TensEncoder {
    inner: InnerEncoder,
}

#[wasm_bindgen]
impl TensEncoder {
    #[wasm_bindgen(constructor)]
    pub fn new() -> TensEncoder {
        TensEncoder {
            inner: InnerEncoder::new(),
        }
    }

    /// Encode a JavaScript value → TENS v2 binary (Uint8Array).
    #[wasm_bindgen]
    pub fn encode(&mut self, val: JsValue) -> Result<Vec<u8>, JsValue> {
        let json_val: Value = serde_wasm_bindgen::from_value(val)
            .map_err(|e| JsValue::from_str(&format!("Deserialization error: {}", e)))?;

        Ok(self.inner.encode(&json_val))
    }

    /// Encode a JavaScript value → TENS-Text format string.
    #[wasm_bindgen(js_name = "encodeText")]
    pub fn encode_text(&mut self, val: JsValue, encoding: Option<String>) -> Result<String, JsValue> {
        let json_val: Value = serde_wasm_bindgen::from_value(val)
            .map_err(|e| JsValue::from_str(&format!("Deserialization error: {}", e)))?;

        encode_tens_text(&json_val, encoding.as_deref())
            .map_err(|e| JsValue::from_str(&e))
    }

    /// Encode + SHA-256 hash → hex string.
    #[wasm_bindgen]
    pub fn hash(&mut self, val: JsValue) -> Result<String, JsValue> {
        let json_val: Value = serde_wasm_bindgen::from_value(val)
            .map_err(|e| JsValue::from_str(&format!("Deserialization error: {}", e)))?;

        let binary = self.inner.encode(&json_val);
        Ok(hash_tens_binary(&binary))
    }

    /// Hash pre-encoded binary bytes.
    #[wasm_bindgen(js_name = "hashBinary")]
    pub fn hash_binary(&self, bytes: &[u8]) -> String {
        hash_tens_binary(bytes)
    }
}

/// Decode TENS v2 binary (Uint8Array) → JavaScript value.
#[wasm_bindgen(js_name = "decodeTens")]
pub fn decode_tens(binary: &[u8]) -> Result<JsValue, JsValue> {
    let mut decoder = TensDecoder::new();
    let value = decoder.decode(binary)
        .map_err(|e| JsValue::from_str(&e))?;

    serde_wasm_bindgen::to_value(&value)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

/// Decode TENS-Text string → JavaScript value.
#[wasm_bindgen(js_name = "decodeTensText")]
pub fn decode_tens_text_wasm(text: &str) -> Result<JsValue, JsValue> {
    let value = encoder::decode_tens_text(text)
        .map_err(|e| JsValue::from_str(&e))?;

    serde_wasm_bindgen::to_value(&value)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

