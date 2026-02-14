import * as fs from 'node:fs';
import { ContextStorage } from './storage.js';

const DB_PATH = './test-data';

// Clean up previous run
if (fs.existsSync(DB_PATH)) {
  fs.rmSync(DB_PATH, { recursive: true, force: true });
}

console.log('Initializing storage...');
const storage = new ContextStorage(DB_PATH);

console.log('Writing data...');
storage.write('users', [{ id: 1, name: 'Alice' }]);
storage.write('users', [{ id: 2, name: 'Bob' }]);

console.log('Collections:', storage.listCollections());

// "Close" simply by letting it go out of scope or just re-opening
// Since we don't have a close method on ContextStorage yet (we should add one),
// we rely on file system state.

console.log('Re-opening storage...');
const storage2 = new ContextStorage(DB_PATH);
console.log('Collections after reopen:', storage2.listCollections());

if (storage2.listCollections().includes('users')) {
  console.log('SUCCESS: Persistence works!');
} else {
  console.error('FAILURE: Data lost!');
  process.exit(1);
}
