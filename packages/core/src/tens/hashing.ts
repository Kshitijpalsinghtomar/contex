// ============================================================================
// @contex/core — TENS Structural Hashing
// ============================================================================
//
// Computes SHA-256 hashes of TENS binary data for content-addressable caching.
// Because TENS is canonical (sorted keys, deterministic binary layout),
// the same data always produces the same hash regardless of input key order.
// ============================================================================

import { createHash } from 'node:crypto';

/**
 * Compute a SHA-256 hash of TENS binary data.
 *
 * Since TENS encoding is canonical, this produces a stable content hash:
 * `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` produce the same TENS binary
 * and therefore the same hash.
 *
 * @param data - TENS binary data (Uint8Array from TensEncoder.encode())
 * @returns Hex-encoded SHA-256 hash string
 */
export function computeStructuralHash(data: Uint8Array): string {
  const hash = createHash('sha256');
  hash.update(data);
  return hash.digest('hex');
}
