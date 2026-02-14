// ============================================================================
// contex Schema Registry
// ============================================================================

import { Pager } from '../storage/pager.js';

export interface SchemaDefinition {
  version: number;
  fields: Record<string, string>; // fieldName -> type
  created: number;
}

export class SchemaRegistry {
  private schemas = new Map<string, SchemaDefinition[]>();

  constructor() {
    // TODO: Load schemas from storage
  }

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

    // TODO: Persist schema change
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
