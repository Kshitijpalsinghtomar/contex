import * as fs from 'node:fs';
import { Contex } from './engine.js';

const DB_PATH = './test-rag-data';
if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH, { recursive: true, force: true });

const db = new Contex();
const data = Array.from({ length: 100 }, (_, i) => ({
  id: i,
  title: `Document ${i}`,
  content: `This is a long content string for document ${i} to consume tokens. `.repeat(10),
  tags: ['rag', 'test'],
}));

console.log('Inserting 100 docs...');
db.insert('docs', data);

console.log('Requesting context for GPT-4o with tight budget...');
const result = db.getOptimizedContext('docs', {
  model: 'gpt-4o',
  systemPrompt: 100,
  userPrompt: 50,
  reserve: 120000,
});

console.log(`\nRecommended Format: ${result.debug.recommendedFormat}`);
console.log(`Available Tokens: ${result.debug.availableTokens}`);
console.log(`Max Rows that fit: ${result.debug.maxRows}`);
console.log(`Used Rows: ${result.usedRows}`);
console.log(`Output length: ${result.output.length} chars`);

if (result.usedRows < 100 && result.usedRows > 0) {
  console.log('SUCCESS: Contex optimized the context window!');
} else {
  console.error('FAILURE: Optimization logic failed (either 0 or all rows).');
}
