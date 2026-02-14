use std::collections::{BTreeMap, HashMap};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use serde::{Deserialize, Serialize};

pub type SchemaId = u32;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Schema {
    pub id: SchemaId,
    pub keys: Vec<String>,
}

pub struct SchemaRegistry {
    // fast lookup: hash(sorted_keys) -> SchemaId
    lookup: HashMap<u64, SchemaId>,
    // storage: SchemaId -> Schema
    schemas: BTreeMap<SchemaId, Schema>,
    next_id: SchemaId,
}

impl SchemaRegistry {
    pub fn new() -> Self {
        SchemaRegistry {
            lookup: HashMap::new(),
            schemas: BTreeMap::new(),
            next_id: 1, // Start at 1, 0 is reserved/null
        }
    }

    pub fn get_or_register(&mut self, keys: &[String]) -> (SchemaId, bool) {
        // Sort keys to ensure canonical representation
        // Note: In TENS v2, input keys are assumed sorted by the flattener?
        // Or should we sort here? To be safe and canonical, we sort here.
        let mut sorted_keys = keys.to_vec();
        sorted_keys.sort();

        let hash = self.calculate_hash(&sorted_keys);

        if let Some(&id) = self.lookup.get(&hash) {
            return (id, false); // Existing
        }

        let id = self.next_id;
        self.next_id += 1;

        let schema = Schema {
            id,
            keys: sorted_keys,
        };

        self.lookup.insert(hash, id);
        self.schemas.insert(id, schema);

        (id, true) // New
    }

    pub fn get(&self, id: SchemaId) -> Option<&Schema> {
        self.schemas.get(&id)
    }

    fn calculate_hash(&self, keys: &[String]) -> u64 {
        let mut hasher = DefaultHasher::new();
        // Hash the joined keys to simulate what we did in TS (SHA-256 is overkill here, FNV/SipHash is fine for HashMap)
        // But for persistent stability across runs/languages, we might want SHA-256. 
        // For the in-memory registry, standard hash is sufficient.
        for key in keys {
            key.hash(&mut hasher);
        }
        hasher.finish()
    }
}
