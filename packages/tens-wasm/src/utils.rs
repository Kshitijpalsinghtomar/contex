use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    pub fn log(s: &str);
}

pub fn set_panic_hook() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

#[macro_export]
macro_rules! console_log {
    ($($t:tt)*) => (crate::utils::log(&format_args!($($t)*).to_string()))
}

// ── LEB128 unsigned varint encoding ──

/// Encode an unsigned integer as LEB128 varint bytes (matches JS encoder).
pub fn encode_varint(mut val: u32) -> Vec<u8> {
    let mut out = Vec::new();
    loop {
        let mut byte = (val & 0x7F) as u8;
        val >>= 7;
        if val > 0 {
            byte |= 0x80;
        }
        out.push(byte);
        if val == 0 {
            break;
        }
    }
    out
}

/// Decode a LEB128 unsigned varint from a byte slice, returning (value, bytes_consumed).
pub fn decode_varint(bytes: &[u8]) -> (u32, usize) {
    let mut val: u32 = 0;
    let mut shift: u32 = 0;
    let mut i = 0;
    loop {
        if i >= bytes.len() {
            break;
        }
        let byte = bytes[i];
        val |= ((byte & 0x7F) as u32) << shift;
        i += 1;
        if byte & 0x80 == 0 {
            break;
        }
        shift += 7;
    }
    (val, i)
}

