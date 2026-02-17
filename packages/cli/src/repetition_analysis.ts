import type { TokenizerManager } from '@contex/core';

export interface RepetitionStats {
  uniqueStrings: number;
  totalStrings: number;
  stringReuseRatio: number; // 0-1
  avgStringLength: number;
  entropy: number; // Shannon entropy estimation
  tokenRepetitionFrequency: number; // ratio of repeated tokens
}

export function analyzeRepetition(data: unknown[], tokenizer: TokenizerManager): RepetitionStats {
  const strings: string[] = [];

  // Recursive extraction of all string values
  function extract(obj: unknown) {
    if (typeof obj === 'string') {
      strings.push(obj);
    } else if (Array.isArray(obj)) {
      for (const item of obj) {
        extract(item);
      }
    } else if (typeof obj === 'object' && obj !== null) {
      for (const value of Object.values(obj)) {
        extract(value);
      }
    }
  }

  extract(data);

  if (strings.length === 0) {
    return {
      uniqueStrings: 0,
      totalStrings: 0,
      stringReuseRatio: 0,
      avgStringLength: 0,
      entropy: 0,
      tokenRepetitionFrequency: 0,
    };
  }

  const counts = new Map<string, number>();
  let totalLen = 0;

  for (const s of strings) {
    counts.set(s, (counts.get(s) || 0) + 1);
    totalLen += s.length;
  }

  // String-level entropy
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / strings.length;
    entropy -= p * Math.log2(p);
  }

  // Token repetition frequency: tokenize all strings concatenated, count repeated token IDs
  const allText = strings.join(' ');
  const tokens = tokenizer.tokenize(allText, 'o200k_base');
  const tokenCounts = new Map<number, number>();
  for (const t of tokens) {
    tokenCounts.set(t, (tokenCounts.get(t) || 0) + 1);
  }
  let repeatedTokens = 0;
  for (const count of tokenCounts.values()) {
    if (count > 1) repeatedTokens += count;
  }
  const tokenRepetitionFrequency = tokens.length > 0 ? repeatedTokens / tokens.length : 0;

  return {
    uniqueStrings: counts.size,
    totalStrings: strings.length,
    stringReuseRatio: 1 - counts.size / strings.length,
    avgStringLength: totalLen / strings.length,
    entropy,
    tokenRepetitionFrequency: Math.round(tokenRepetitionFrequency * 10000) / 10000,
  };
}
