// ============================================================================
// contex Pager — 4KB Page Management
// ============================================================================

import * as fs from 'node:fs';

export const PAGE_SIZE = 4096;

export class Pager {
  private fd: number;
  private fileLength: number;

  constructor(filePath: string) {
    // Open file in read/write mode, create if not exists
    this.fd = fs.openSync(filePath, 'a+');
    const stats = fs.statSync(filePath);
    this.fileLength = stats.size;
  }

  /**
   * Read a page from disk.
   */
  readPage(pageId: number): Uint8Array {
    const offset = pageId * PAGE_SIZE;
    const buffer = new Uint8Array(PAGE_SIZE);

    if (offset >= this.fileLength) {
      // Return empty page if reading beyond file (new page)
      return buffer;
    }

    fs.readSync(this.fd, buffer, 0, PAGE_SIZE, offset);

    // If partial read (EOF), the rest is already zero-filled
    return buffer;
  }

  /**
   * Write a page to disk.
   */
  writePage(pageId: number, data: Uint8Array): void {
    if (data.length !== PAGE_SIZE) {
      throw new Error(`Page data must be exactly ${PAGE_SIZE} bytes`);
    }

    const offset = pageId * PAGE_SIZE;
    fs.writeSync(this.fd, data, 0, PAGE_SIZE, offset);

    // Update file length if we wrote past the end
    if (offset + PAGE_SIZE > this.fileLength) {
      this.fileLength = offset + PAGE_SIZE;
    }
  }

  /**
   * Allocate a new page ID (append to end).
   */
  allocatePage(): number {
    const pageId = Math.floor(this.fileLength / PAGE_SIZE);
    // Determine if we need to actually write bytes now or just reserve the ID.
    // For now, we just return the ID. Actual expansion happens on write.
    return pageId;
  }

  /**
   * Sync changes to disk.
   */
  sync(): void {
    fs.fsyncSync(this.fd);
  }

  /**
   * Close the file descriptor.
   */
  close(): void {
    fs.closeSync(this.fd);
  }

  get pageCount(): number {
    return Math.ceil(this.fileLength / PAGE_SIZE);
  }
}
