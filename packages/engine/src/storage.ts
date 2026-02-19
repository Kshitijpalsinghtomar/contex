// ============================================================================
// @contex-llm/engine — Persistent Storage
// ============================================================================
//
// Block-based storage engine with WAL for crash safety.
// Data is stored in 4KB pages and organized by collection.
// ============================================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Pager } from './storage/pager.js';
import { WAL, WalRecordType } from './storage/wal.js';

interface Batch {
  startPageId: number;
  pageCount: number;
  byteLength: number;
}

interface CollectionMeta {
  batches: Batch[];
  count: number;
}

/**
 * ContextStorage: Persistent storage engine.
 *
 * - 4KB pages via Pager
 * - Write-Ahead Log for crash safety
 * - Simple linked-list of pages for now (until B-Tree is fully ready)
 */
export class ContextStorage {
  private pager: Pager;
  private wal: WAL;
  private metadataPath: string;
  private collections = new Map<string, CollectionMeta>();

  constructor(dataDir = './data') {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.pager = new Pager(path.join(dataDir, 'contex.db'));
    this.wal = new WAL(path.join(dataDir, 'contex.wal'));
    this.metadataPath = path.join(dataDir, 'contex.meta');

    this.loadMetadata();
  }

  /**
   * Write data to a collection. Appends a new batch of pages.
   * Data is first written to WAL for crash safety, then to disk.
   *
   * @param collection - Collection name
   * @param data - Array of objects to store
   */
  write(collection: string, data: Record<string, unknown>[]): void {
    const json = JSON.stringify(data);
    const bytes = new TextEncoder().encode(json);

    // Write to WAL first
    this.wal.append(WalRecordType.BEGIN_TX, 1);
    this.wal.append(WalRecordType.WRITE_PAGE, 1, bytes);
    this.wal.append(WalRecordType.COMMIT_TX, 1);
    this.wal.sync();

    // Calculate pages needed
    const totalBytes = bytes.length;
    const pageSize = 4096;
    const pageCount = Math.ceil(totalBytes / pageSize);
    const startPageId = this.pager.allocatePage();

    // Allocate contiguous pages (mocking contiguous allocation by calling allocate loop)
    for (let i = 1; i < pageCount; i++) {
      this.pager.allocatePage();
    }

    // Write chunks
    for (let i = 0; i < pageCount; i++) {
      const offset = i * pageSize;
      const end = Math.min(offset + pageSize, totalBytes);
      const chunk = bytes.slice(offset, end);

      const pageBuffer = new Uint8Array(pageSize);
      pageBuffer.set(chunk); // Copy chunk to 4KB page buffer

      this.pager.writePage(startPageId + i, pageBuffer);
    }

    const meta = this.collections.get(collection) || { batches: [], count: 0 };
    meta.batches.push({ startPageId, pageCount, byteLength: totalBytes });
    meta.count += data.length;
    this.collections.set(collection, meta);

    this.saveMetadata();
  }

  /**
   * Read all data from a collection.
   * Reassembles data from pages across all batches.
   *
   * @param collection - Collection name
   * @returns Array of stored objects (empty array if collection doesn't exist)
   */
  read(collection: string): Record<string, unknown>[] {
    const meta = this.collections.get(collection);
    if (!meta) return [];

    const allData: Record<string, unknown>[] = [];
    const pageSize = 4096;

    for (const batch of meta.batches) {
      const batchBuffer = new Uint8Array(batch.pageCount * pageSize);

      for (let i = 0; i < batch.pageCount; i++) {
        const page = this.pager.readPage(batch.startPageId + i);
        batchBuffer.set(page, i * pageSize);
      }

      // Slice actual data
      const validBytes = batchBuffer.slice(0, batch.byteLength);
      const json = new TextDecoder().decode(validBytes);
      try {
        const parsed = JSON.parse(json);
        if (Array.isArray(parsed)) {
          allData.push(...parsed);
        } else {
          allData.push(parsed);
        }
      } catch (e) {
        console.error(`Error parsing batch at page ${batch.startPageId}:`, e);
      }
    }

    return allData;
  }

  listCollections(): string[] {
    return [...this.collections.keys()];
  }

  drop(collection: string): boolean {
    const deleted = this.collections.delete(collection);
    this.saveMetadata();
    return deleted;
  }

  private loadMetadata() {
    if (fs.existsSync(this.metadataPath)) {
      try {
        const json = fs.readFileSync(this.metadataPath, 'utf-8');
        const raw = JSON.parse(json);
        for (const [k, v] of Object.entries(raw)) {
          // Migration for old metadata format if needed
          const candidate = v as { headPageId?: unknown; count?: unknown };
          if (candidate.headPageId !== undefined) {
            this.collections.set(k, {
              batches: [],
              count: typeof candidate.count === 'number' ? candidate.count : 0,
            });
          } else {
            this.collections.set(k, v as CollectionMeta);
          }
        }
      } catch (e) {
        console.error('Failed to load metadata', e);
      }
    }
  }

  private saveMetadata() {
    const obj = Object.fromEntries(this.collections);
    fs.writeFileSync(this.metadataPath, JSON.stringify(obj, null, 2));
  }
}
