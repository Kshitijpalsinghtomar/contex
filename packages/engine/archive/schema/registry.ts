// ============================================================================
// @contex-llm/engine — Schema Registry (Archived)
// ============================================================================
//
// Archived from src/schema/registry.ts during structural consolidation.
// This file is intentionally excluded from runtime/build paths.
//
// ============================================================================

export interface SchemaDefinition {
  version: number;
  fields: Record<string, string>;
  created: number;
}

export class SchemaRegistry {
  private schemas = new Map<string, SchemaDefinition[]>();

  register(collection: string, fields: Record<string, string>): void {
    const history = this.schemas.get(collection) || [];
    const version = history.length + 1;

    const schema: SchemaDefinition = {
      version,
      fields,
      created: Date.now(),
    };

    history.push(schema);
    this.schemas.set(collection, history);
  }

  getLatest(collection: string): SchemaDefinition | undefined {
    const history = this.schemas.get(collection);
    return history ? history[history.length - 1] : undefined;
  }

  getVersion(collection: string, version: number): SchemaDefinition | undefined {
    const history = this.schemas.get(collection);
    return history ? history.find((s) => s.version === version) : undefined;
  }
}
