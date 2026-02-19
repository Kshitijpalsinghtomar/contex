// ============================================================================
// @contex-llm/engine — B-Tree Index (Archived)
// ============================================================================
//
// Archived from src/index/btree.ts during structural consolidation.
// This file is intentionally excluded from runtime/build paths.
//
// ============================================================================

import { PAGE_SIZE, type Pager } from '../../src/storage/pager.js';

const NODE_TYPE_LEAF = 1;

export class BTree {
  private pager: Pager;
  private rootPageId = 0;

  constructor(pager: Pager, rootPageId = 0) {
    this.pager = pager;
    this.rootPageId = rootPageId;

    if (pager.pageCount === 0) {
      this.initRoot();
    }
  }

  private initRoot() {
    this.rootPageId = this.pager.allocatePage();
    const node = new Uint8Array(PAGE_SIZE);
    const view = new DataView(node.buffer);
    view.setUint8(0, NODE_TYPE_LEAF);
    view.setUint16(1, 0, true);
    view.setUint32(3, 0, true);
    this.pager.writePage(this.rootPageId, node);
  }

  insert(key: string, _value: Uint8Array): void {
    console.warn(`[BTree] insert() not yet implemented — key: ${key}`);
  }

  search(_key: string): Uint8Array | null {
    return null;
  }
}
