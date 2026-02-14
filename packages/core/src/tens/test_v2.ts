import { TokenStreamEncoder } from '../token_stream_encoder.js';
import { computeStructuralHash } from './hashing.js';

const encoder = new TokenStreamEncoder();

const obj1 = {
  id: 1,
  name: 'Alice',
  tags: ['admin', 'staff'],
  meta: { active: true, level: 5 },
};

const obj2 = {
  meta: { level: 5, active: true },
  tags: ['admin', 'staff'],
  name: 'Alice',
  id: 1,
};

console.log('Encoding obj1...');
const bin1 = encoder.encode([obj1]);
const hash1 = computeStructuralHash(bin1);
console.log(`Hash 1: ${hash1}`);
console.log(`Size 1: ${bin1.length} bytes`);

console.log('Encoding obj2 (different key order)...');
const bin2 = encoder.encode([obj2]);
const hash2 = computeStructuralHash(bin2);
console.log(`Hash 2: ${hash2}`);
console.log(`Size 2: ${bin2.length} bytes`);

if (hash1 === hash2) {
  console.log('SUCCESS: Structural hashes match! TENS is canonical.');
} else {
  console.error('FAILURE: Hashes do not match!');
  process.exit(1);
}
