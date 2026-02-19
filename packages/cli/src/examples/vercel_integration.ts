import { contex } from '@contex-llm/core/vercel';
import type { VercelMessage } from '@contex-llm/core/vercel';

// Mock Vercel AI SDK Message structure
const messages: VercelMessage[] = [
  {
    role: 'system',
    content: 'You are a helpful assistant.',
  },
  {
    role: 'user',
    content: JSON.stringify([
      { id: 1, name: 'Product A', category: 'Widget' },
      { id: 2, name: 'Product B', category: 'Widget' },
      { id: 3, name: 'Product C', category: 'Gadget' },
    ]),
  },
];

console.log('--- Original Last Message ---');
console.log(messages[messages.length - 1].content);

// Apply Contex Middleware
console.log('\n--- Applying Contex Middleware ---');
const optimizedMessages = contex(messages, { model: 'gpt-4o' });

const lastMsg = optimizedMessages[optimizedMessages.length - 1];
console.log('--- Optimized Last Message ---');
console.log(lastMsg.content);

// Verification: Check for Contex Compact format markers
// Dictionary entries appear as @d line, values use @0/@1 refs, booleans are T/F
const original = messages[messages.length - 1].content as string;
const optimized = lastMsg.content as string;
const savings = ((1 - optimized.length / original.length) * 100).toFixed(1);

console.log(`\nOriginal: ${original.length} chars`);
console.log(`Optimized: ${optimized.length} chars`);
console.log(`Savings: ${savings}%`);

if (typeof lastMsg.content === 'string' && optimized.includes('\t')) {
  console.log('\n✅ Vercel Integration Verified: Content optimized with Contex Compact.');
} else {
  console.error('\n❌ Vercel Integration Failed.');
}
