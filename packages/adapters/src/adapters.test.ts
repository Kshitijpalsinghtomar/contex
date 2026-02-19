import { describe, expect, it } from 'vitest';

import { ContexLoader } from './langchain.js';
import { ContexReader } from './llamaindex.js';

describe('@contex-llm/adapters', () => {
  it('ContexLoader optimizes structured rows', () => {
    const loader = new ContexLoader({ model: 'gpt-4o-mini' });
    const result = loader.optimize([
      { id: 1, name: 'Alice', role: 'admin' },
      { id: 2, name: 'Bob', role: 'user' },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.pageContent.length).toBeGreaterThan(0);
    expect(result[0]?.metadata?._contex).toBeDefined();
  });

  it('ContexReader optimizes llamaindex-like nodes', () => {
    const reader = new ContexReader({ model: 'gpt-4o-mini' });
    const result = reader.optimizeNodes([
      { id_: 'n1', text: 'Ticket is open', metadata: { status: 'open' } },
      { id_: 'n2', text: 'Ticket is closed', metadata: { status: 'closed' } },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.id_).toBe('contex-optimized');
    expect(result[0]?.text.length).toBeGreaterThan(0);
    expect(result[0]?.metadata?._contex).toBeDefined();
  });
});
