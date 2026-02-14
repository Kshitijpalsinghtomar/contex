import fs from 'fs';
import { generateRealWorld } from './generators.js';

// Configuration
const COUNT = 50;
const OUTPUT_FILE = 'accuracy_test.jsonl';

console.log(`Generating ${COUNT} accuracy test cases for LLM retrieval evaluation...`);

// Generate real-world data
const data = generateRealWorld(COUNT);

// Create Q&A pairs
const testCases = data.flatMap((ticket) => {
  // 1. Status Retrieval
  const statusQuery = {
    id: `q_status_${ticket.id}`,
    type: 'retrieval',
    context: JSON.stringify(ticket),
    question: `What is the current status of ticket #${ticket.id}?`,
    ideal_answer: ticket.status,
    metrics: ['exact_match'],
  };

  // 2. Priority Retrieval
  const priorityQuery = {
    id: `q_priority_${ticket.id}`,
    type: 'retrieval',
    context: JSON.stringify(ticket),
    question: `What is the priority level of this ticket?`,
    ideal_answer: ticket.priority,
    metrics: ['exact_match'],
  };

  return [statusQuery, priorityQuery];
});

// Write to JSONL
fs.writeFileSync(OUTPUT_FILE, testCases.map((tc) => JSON.stringify(tc)).join('\n'));

console.log(`\nSuccessfully generated ${testCases.length} test cases.`);
console.log(`File saved to: ${OUTPUT_FILE}`);
console.log(`\nUsage:`);
console.log(
  `  Feed this file to your LLM evaluation pipeline (e.g., prompted with context and question).`,
);
console.log(`  Compare generated answer vs 'ideal_answer'.`);
