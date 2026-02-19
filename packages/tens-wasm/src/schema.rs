use std::collections::{BTreeMap, HashMap};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use serde::{Deserialize, Serialize};

pub type SchemaId = u32;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Schema {
    pub id: SchemaId,
    /// Sorted field names (canonical order)
    pub keys: Vec<String>,
    /// Parallel array of inferred type labels
    pub field_types: Vec<String>,
}

pub struct SchemaRegistry {
    /// hash(sorted_keys) → SchemaId
    lookup: HashMap<u64, SchemaId>,
    /// SchemaId → Schema
    schemas: BTreeMap<SchemaId, Schema>,
    next_id: SchemaId,
}

impl SchemaRegistry {
    pub fn new() -> Self {
        SchemaRegistry {
            lookup: HashMap::new(),
            schemas: BTreeMap::new(),
            next_id: 1,
        }
    }

    /// Register or retrieve a schema for the given (unsorted) keys.
    /// Returns (schema_id, is_new).
    pub fn get_or_register(&mut self, keys: &[String], types: &[String]) -> (SchemaId, bool) {
        let mut sorted: Vec<(String, String)> = keys
            .iter()
            .cloned()
            .zip(types.iter().cloned())
            .collect();
        sorted.sort_by(|a, b| a.0.cmp(&b.0));

        let sorted_keys: Vec<String> = sorted.iter().map(|p| p.0.clone()).collect();
        let sorted_types: Vec<String> = sorted.iter().map(|p| p.1.clone()).collect();

        let hash = Self::calculate_hash(&sorted_keys);

        if let Some(&id) = self.lookup.get(&hash) {
            return (id, false);
        }

        let id = self.next_id;
        self.next_id += 1;

        let schema = Schema {
            id,
            keys: sorted_keys,
            field_types: sorted_types,
        };

        self.lookup.insert(hash, id);
        self.schemas.insert(id, schema);

        (id, true)
    }

    pub fn get(&self, id: SchemaId) -> Option<&Schema> {
        self.schemas.get(&id)
    }

    pub fn all(&self) -> impl Iterator<Item = &Schema> {
        self.schemas.values()
    }

    fn calculate_hash(keys: &[String]) -> u64 {
        let mut hasher = DefaultHasher::new();
        for key in keys {
            key.hash(&mut hasher);
        }
        hasher.finish()
    }
}

