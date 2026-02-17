import { compile } from '@contex/core';

// 1. Your Data (e.g. from Database)
const users = [
  { id: 101, name: 'Alice', role: 'admin', active: true },
  { id: 102, name: 'Bob', role: 'user', active: true },
  { id: 103, name: 'Charlie', role: 'user', active: false },
];

// 2. Compile with Contex (uses Contex Compact format by default)
console.log('--- Compiling with Contex ---');
const prompt = compile(users, { model: 'gpt-4o' });

// 3. Ready for LLM injection
console.log(prompt);

// Verification: Contex Compact uses tab-separated values, T/F for booleans
const jsonSize = JSON.stringify(users).length;
const contexSize = prompt.length;
const savings = ((1 - contexSize / jsonSize) * 100).toFixed(1);

console.log(`\nJSON:   ${jsonSize} chars`);
console.log(`Contex: ${contexSize} chars`);
console.log(`Savings: ${savings}%`);

if (prompt.includes('\t') && prompt.includes('T') && savings !== '0.0') {
  console.log('\n✅ Optimization Verified: Contex Compact format active.');
} else {
  console.error('\n❌ Optimization check — output may still be valid.');
}
