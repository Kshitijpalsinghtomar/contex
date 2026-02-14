import { compile } from '@contex/core';

// 1. Your Data (e.g. from Database)
const users = [
    { id: 101, name: 'Alice', role: 'admin', active: true },
    { id: 102, name: 'Bob', role: 'user', active: true },
    { id: 103, name: 'Charlie', role: 'user', active: false }
];

// 2. Contex It (Invisible Infra)
console.log('--- Compiling with Contex ---');
const prompt = compile(users, { model: 'gpt-4o' });

// 3. Ready for LLM
console.log(prompt);

// Verification: Check for compression artifacts
if (prompt.includes('@dict') && prompt.includes('user')) {
    console.log('\n✅ Optimization Verified: Dictionary compression active.');
} else {
    console.error('\n❌ Optimization Failed.');
}
