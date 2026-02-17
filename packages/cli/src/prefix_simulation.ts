import type { TokenizerManager } from '@contex/core';
import { formatOutput } from '@contex/core';
import { formatPrefixAware } from '@contex/engine';
import { seededRandom } from './generators.js';

export type MutationType =
  | 'append'
  | 'prepend'
  | 'insert'
  | 'update_middle'
  | 'delete_first'
  | 'shuffle_tail'
  | 'single_field_change';

export function runPrefixSimulation(
  initialData: Record<string, unknown>[],
  mutation: MutationType,
  count: number,
  tokenizer: TokenizerManager,
  seed = 42,
) {
  const data = structuredClone(initialData);
  const rng = seededRandom(seed);

  // Apply mutation
  switch (mutation) {
    case 'append':
      for (let i = 0; i < count; i++) {
        data.push({ id: `new-append-${i}`, val: 'new', ts: i });
      }
      break;
    case 'prepend':
      for (let i = 0; i < count; i++) {
        data.unshift({ id: `new-prepend-${i}`, val: 'new', ts: i });
      }
      break;
    case 'insert': {
      const mid = Math.floor(data.length / 2);
      for (let i = 0; i < count; i++) {
        data.splice(mid, 0, { id: `new-insert-${i}`, val: 'new', ts: i });
      }
      break;
    }
    case 'update_middle': {
      // Update rows in the middle of the dataset
      const startIdx = Math.floor(data.length / 3);
      for (let i = 0; i < Math.min(count, data.length - startIdx); i++) {
        data[startIdx + i] = {
          ...data[startIdx + i],
          updated: true,
          update_val: `modified_${i}`,
        };
      }
      break;
    }
    case 'delete_first':
      data.splice(0, Math.min(count, data.length));
      break;
    case 'shuffle_tail': {
      // Shuffle last 20% of data using seeded RNG
      const shuffleStart = Math.floor(data.length * 0.8);
      const tail = data.slice(shuffleStart);
      // Fisher-Yates shuffle with seeded RNG
      for (let i = tail.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [tail[i], tail[j]] = [tail[j], tail[i]];
      }
      data.splice(shuffleStart, tail.length, ...tail);
      break;
    }
    case 'single_field_change': {
      // Change one field in one row
      const idx = Math.floor(data.length / 2);
      if (data[idx]) {
        data[idx] = { ...data[idx], modified_field: `changed_${seed}` };
      }
      break;
    }
  }

  // Compare prefix overlap for Naive vs Prefix-Aware TOON
  const naive1 = formatOutput(initialData, 'toon');
  const naive2 = formatOutput(data, 'toon');

  // For prefix-aware, we assume ID sort
  const aware1 = formatPrefixAware(initialData, { format: 'toon', sortBy: 'id' });
  const aware2 = formatPrefixAware(data, { format: 'toon', sortBy: 'id' });

  return {
    mutation,
    naiveOverlap: measureOverlap(naive1, naive2, tokenizer),
    awareOverlap: measureOverlap(aware1, aware2, tokenizer),
  };
}

function measureOverlap(s1: string, s2: string, tokenizer: TokenizerManager): number {
  const t1 = tokenizer.tokenize(s1, 'o200k_base');
  const t2 = tokenizer.tokenize(s2, 'o200k_base');

  let overlap = 0;
  const minLen = Math.min(t1.length, t2.length);
  for (let i = 0; i < minLen; i++) {
    if (t1[i] === t2[i]) overlap++;
    else break;
  }
  return overlap;
}
