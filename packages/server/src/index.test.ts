import assert from 'node:assert/strict';
import test from 'node:test';

import { app } from './index.js';

test('GET /health returns service metadata', async () => {
  const response = await app.request('/health');
  assert.equal(response.status, 200);

  const body = (await response.json()) as {
    status: string;
    service: string;
    version: string;
    providerGateway: {
      middlewareConnected: boolean;
      openaiConfigured: boolean;
      anthropicConfigured: boolean;
      geminiConfigured: boolean;
    };
  };

  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'contex-api');
  assert.equal(body.version, '0.1.0');
  assert.equal(body.providerGateway.middlewareConnected, true);
  assert.equal(typeof body.providerGateway.openaiConfigured, 'boolean');
  assert.equal(typeof body.providerGateway.anthropicConfigured, 'boolean');
  assert.equal(typeof body.providerGateway.geminiConfigured, 'boolean');
});

test('POST /v1/encode and /v1/decode round trip', async () => {
  const data = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }];

  const encodeResponse = await app.request('/v1/encode', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data }),
  });

  assert.equal(encodeResponse.status, 200);
  const encodeBody = (await encodeResponse.json()) as { hash: string; rowCount: number };
  assert.equal(encodeBody.rowCount, 2);
  assert.ok(encodeBody.hash.length > 0);

  const decodeResponse = await app.request('/v1/decode', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hash: encodeBody.hash }),
  });

  assert.equal(decodeResponse.status, 200);
  const decodeBody = (await decodeResponse.json()) as {
    rowCount: number;
    data: Array<{ id: number; name: string }>;
  };

  assert.equal(decodeBody.rowCount, 2);
  assert.equal(decodeBody.data[0]?.name, 'Alice');
  assert.equal(decodeBody.data[1]?.name, 'Bob');
});

test('POST /v1/collections/:name and /v1/query return filtered data', async () => {
  const collectionName = `tickets_${Date.now()}`;
  const data = [
    { id: 1, status: 'open', priority: 'high' },
    { id: 2, status: 'closed', priority: 'low' },
  ];

  const insertResponse = await app.request(`/v1/collections/${collectionName}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data }),
  });

  assert.equal(insertResponse.status, 200);

  const queryResponse = await app.request('/v1/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pql: `GET ${collectionName} WHERE status = open FORMAT json` }),
  });

  assert.equal(queryResponse.status, 200);

  const queryBody = (await queryResponse.json()) as {
    count: number;
    data: Array<{ id: number; status: string }>;
  };

  assert.equal(queryBody.count, 1);
  assert.equal(queryBody.data[0]?.status, 'open');
});

test('POST /v1/optimize returns optimized context payload', async () => {
  const response = await app.request('/v1/optimize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      data: [
        { id: 1, item: 'Keyboard', price: 99 },
        { id: 2, item: 'Mouse', price: 49 },
      ],
      model: 'gpt-4o-mini',
      systemPromptTokens: 50,
      userPromptTokens: 20,
      responseReserve: 100,
    }),
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as { usedRows: number; context: unknown };

  assert.equal(body.usedRows, 2);
  assert.ok(body.context !== undefined);
});

test('POST /v1/providers/openai/chat returns config error without API key', async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  try {
    const response = await app.request('/v1/providers/openai/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hello {{CONTEX:tickets}}' }],
        data: { tickets: [{ id: 1, status: 'open' }] },
      }),
    });

    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'PROVIDER_CONFIG_ERROR');
  } finally {
    if (previous !== undefined) {
      process.env.OPENAI_API_KEY = previous;
    }
  }
});

test('POST /v1/providers/anthropic/messages returns config error without API key', async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  try {
    const response = await app.request('/v1/providers/anthropic/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet',
        max_tokens: 128,
        messages: [{ role: 'user', content: 'Hello {{CONTEX:tickets}}' }],
        data: { tickets: [{ id: 1, status: 'open' }] },
      }),
    });

    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'PROVIDER_CONFIG_ERROR');
  } finally {
    if (previous !== undefined) {
      process.env.ANTHROPIC_API_KEY = previous;
    }
  }
});

test('POST /v1/providers/gemini/generate returns config error without API key', async () => {
  const previous = process.env.GOOGLE_API_KEY;
  delete process.env.GOOGLE_API_KEY;

  try {
    const response = await app.request('/v1/providers/gemini/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-2.5-pro',
        prompt: 'Hello {{CONTEX:tickets}}',
        data: { tickets: [{ id: 1, status: 'open' }] },
      }),
    });

    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'PROVIDER_CONFIG_ERROR');
  } finally {
    if (previous !== undefined) {
      process.env.GOOGLE_API_KEY = previous;
    }
  }
});
