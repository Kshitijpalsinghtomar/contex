mod utils;
mod schema;
mod encoder;

use wasm_bindgen::prelude::*;
use serde_json::Value;
use crate::encoder::TokenStreamEncoder;

use wasm_bindgen::prelude::*;
use serde_json::Value;
use crate::encoder::TokenStreamEncoder;

#[wasm_bindgen]
pub struct TensEncoder {
    inner: TokenStreamEncoder,
}

#[wasm_bindgen]
impl TensEncoder {
    #[wasm_bindgen(constructor)]
    pub fn new() -> TensEncoder {
        TensEncoder {
            inner: TokenStreamEncoder::new(),
        }
    }

    /// Encodes a generic JavaScript value (JSON) into TENS binary tokens
    #[wasm_bindgen]
    pub fn encode(&mut self, val: JsValue) -> Result<Vec<u32>, JsValue> {
        // deserializing from JS value to Serde Value
        let json_val: Value = serde_wasm_bindgen::from_value(val)?;
        
        // Use our rust implementation
        self.inner.encode(&json_val);
        
        Ok(self.inner.get_tokens())
    }
}

#[wasm_bindgen]
pub fn decode_tens(binary: &[u8]) -> Result<JsValue, JsValue> {
    // Placeholder for decoder
    Ok(JsValue::NULL)
}
