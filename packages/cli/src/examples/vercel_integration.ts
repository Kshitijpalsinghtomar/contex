import { contex } from '@contex/core/vercel';
import type { VercelMessage } from '@contex/core/vercel';

// Mock Vercel AI SDK Message structure
const messages: VercelMessage[] = [
    {
        role: 'system',
        content: 'You are a helpful assistant.'
    },
    {
        role: 'user',
        content: JSON.stringify([
            { id: 1, name: 'Product A', category: 'Widget' },
            { id: 2, name: 'Product B', category: 'Widget' },
            { id: 3, name: 'Product C', category: 'Gadget' }
        ])
    }
];

console.log('--- Original Last Message ---');
console.log(messages[messages.length - 1].content);

// Apply Contex Middleware
console.log('\n--- Applying Contex Middleware ---');
const optimizedMessages = contex(messages, { model: 'gpt-4o' });

const lastMsg = optimizedMessages[optimizedMessages.length - 1];
console.log('--- Optimized Last Message ---');
console.log(lastMsg.content);

// Verification
if (typeof lastMsg.content === 'string' && lastMsg.content.includes('@dict') && lastMsg.content.includes('Widget')) {
    console.log('\n✅ Vercel Integration Verified: Content optimized and compressed.');
} else {
    console.error('\n❌ Vercel Integration Failed.');
}
