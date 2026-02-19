// ============================================================================
// @contex-llm/core — TENS String Dictionary
// ============================================================================
//
// Dictionary encoding for TENS binary format. All unique strings (both keys
// and values) are stored once in a string table. The encoder references
// strings by their table index, eliminating duplication.
//
// This is the core of TENS structural deduplication for string data.
// ============================================================================

/**
 * Dictionary of unique strings for TENS binary encoding.
 *
 * Assigns a unique integer ID to each string on first insertion.
 * Subsequent insertions of the same string return the existing ID.
 * The dictionary is serialized into the TENS binary header.
 *
 * @example
 * ```ts
 * const table = new StringTable();
 * const id1 = table.add('hello');  // → 0
 * const id2 = table.add('world');  // → 1
 * const id3 = table.add('hello');  // → 0 (reused)
 * ```
 */
export class StringTable {
  private strToId = new Map<string, number>();
  private idToStr: string[] = [];

  /**
   * Add a string to the table. Returns the existing ID if already present.
   * @param str - String to add
   * @returns The string's unique ID
   */
  add(str: string): number {
    let id = this.strToId.get(str);
    if (id === undefined) {
      id = this.idToStr.length;
      this.idToStr.push(str);
      this.strToId.set(str, id);
    }
    return id;
  }

  /** Look up a string by its ID. */
  get(id: number): string | undefined {
    return this.idToStr[id];
  }

  /** Get all strings in insertion order. */
  getAll(): string[] {
    return this.idToStr;
  }

  /** Clear the dictionary. */
  clear() {
    this.strToId.clear();
    this.idToStr = [];
  }
}
