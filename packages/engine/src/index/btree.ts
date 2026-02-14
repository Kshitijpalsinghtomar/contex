// ============================================================================
// @contex/engine — B-Tree Index (Phase 2)
// ============================================================================
//
// STATUS: STUB — Core structure is in place, but insert/search are not yet
// implemented. The engine currently uses sequential page scans.
//
// Phase 2 will add:
//   - Leaf and internal node splitting
//   - Key serialization and comparison
//   - Range queries
//   - Disk-backed node storage via Pager
// ============================================================================

import { PAGE_SIZE, type Pager } from '../storage/pager.js';

const HEADER_SIZE = 12; // Type (1) + Count (2) + Parent (4) + RightSibling (4) + Flags (1)
const NODE_TYPE_LEAF = 1;
const NODE_TYPE_INTERNAL = 2;

/**
 * B-Tree index for fast key-based lookups.
 *
 * **Status: Phase 2 stub.** The root node is initialized but
 * insert and search operations are not yet implemented.
 *
 * When complete, this will provide O(log n) lookups for collection
 * data, replacing the current sequential page scan.
 */
export class BTree {
  private pager: Pager;
  private rootPageId = 0;

  constructor(pager: Pager, rootPageId = 0) {
    this.pager = pager;
    this.rootPageId = rootPageId;

    // Initialize root if empty file
    if (pager.pageCount === 0) {
      this.initRoot();
    }
  }

  private initRoot() {
    this.rootPageId = this.pager.allocatePage();
    const node = new Uint8Array(PAGE_SIZE);
    const view = new DataView(node.buffer);
    view.setUint8(0, NODE_TYPE_LEAF); // Leaf by default
    view.setUint16(1, 0, true); // 0 keys
    view.setUint32(3, 0, true); // Parent 0 (root)
    this.pager.writePage(this.rootPageId, node);
  }

  /**
   * Insert a key-value pair into the B-Tree.
   * @todo Implement node splitting and rebalancing (Phase 2)
   */
  insert(key: string, value: Uint8Array): void {
    // Phase 2: Implement leaf insertion with split logic
    console.warn(`[BTree] insert() not yet implemented — key: ${key}`);
  }

  /**
   * Search for a value by key.
   * @todo Implement binary search through B-Tree nodes (Phase 2)
   * @returns The value if found, null otherwise
   */
  search(key: string): Uint8Array | null {
    // Phase 2: Implement B-Tree traversal
    return null;
  }
}
