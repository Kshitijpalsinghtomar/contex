// ============================================================================
// @contex-llm/engine — Write-Ahead Log (WAL)
// ============================================================================
//
// Provides crash-safe writes to the Contex database. All mutations are first
// written to the WAL before being applied to the data file. On crash recovery,
// uncommitted transactions are replayed or rolled back.
//
// WAL Record Format (binary):
//   [CRC32: 4 bytes] [Type: 1 byte] [TxId: 4 bytes] [Length: 2 bytes] [Payload: var]
//
// CRC32 covers: Type + TxId + Length + Payload
// ============================================================================

import * as fs from 'node:fs';

/** WAL record types. */
export enum WalRecordType {
  /** Start of a transaction */
  BEGIN_TX = 1,
  /** Commit (durable) */
  COMMIT_TX = 2,
  /** Rollback */
  ROLLBACK_TX = 3,
  /** Data page write — payload = page data */
  WRITE_PAGE = 4,
}

// ---- CRC32 Implementation ----

/** Pre-computed CRC32 lookup table (IEEE polynomial). */
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let crc = i;
  for (let j = 0; j < 8; j++) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  CRC32_TABLE[i] = crc;
}

/**
 * Compute CRC32 checksum over a byte sequence.
 * @param data - Input bytes
 * @returns 32-bit CRC checksum
 */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Write-Ahead Log for crash-safe storage.
 *
 * @example
 * ```ts
 * const wal = new WAL('./data/contex.wal');
 * wal.append(WalRecordType.BEGIN_TX, 1);
 * wal.append(WalRecordType.WRITE_PAGE, 1, pageData);
 * wal.append(WalRecordType.COMMIT_TX, 1);
 * wal.sync();
 * ```
 */
export class WAL {
  private fd: number;

  constructor(filePath: string) {
    this.fd = fs.openSync(filePath, 'a+');
  }

  /**
   * Append a record to the WAL.
   *
   * @param type - Record type (BEGIN_TX, COMMIT_TX, WRITE_PAGE, etc.)
   * @param txId - Transaction ID
   * @param payload - Optional page data for WRITE_PAGE records
   */
  append(type: WalRecordType, txId: number, payload: Uint8Array = new Uint8Array(0)): void {
    // Build the record body (Type + TxId + Length + Payload) for CRC
    const bodySize = 1 + 4 + 2 + payload.length;
    const body = new Uint8Array(bodySize);
    const bodyView = new DataView(body.buffer);
    bodyView.setUint8(0, type);
    bodyView.setUint32(1, txId, true);
    bodyView.setUint16(5, payload.length, true);
    if (payload.length > 0) {
      body.set(payload, 7);
    }

    // Compute CRC32 over the body
    const checksum = crc32(body);

    // Write: [CRC32: 4 bytes] + [body]
    const record = new Uint8Array(4 + bodySize);
    const recordView = new DataView(record.buffer);
    recordView.setUint32(0, checksum, true);
    record.set(body, 4);

    fs.writeSync(this.fd, record);
  }

  /** Force sync WAL to disk (fsync). */
  sync(): void {
    fs.fsyncSync(this.fd);
  }

  /** Close the WAL file handle. */
  close(): void {
    fs.closeSync(this.fd);
  }

  /**
   * Truncate the WAL (used after checkpoint).
   * Removes all WAL records — only safe after all committed
   * transactions have been applied to the main data file.
   */
  truncate(): void {
    fs.ftruncateSync(this.fd, 0);
  }
}
