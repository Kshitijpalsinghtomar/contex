import {
  type OutputFormat,
  TokenStreamDecoder,
  TokenStreamEncoder,
  type TokenizerEncoding,
  formatOutput,
} from '@contex/core';
import { Contex as contex } from '@contex/engine';
import { serve } from '@hono/node-server';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';

// ============================================================================
// @contex/server — Production REST API
// ============================================================================
//
// Singleton engine instance, proper validation, CORS, structured errors.
// ============================================================================

const app = new Hono();

// --- Singleton Engine ---
const engine = new contex('o200k_base');

// --- Middleware ---
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
);

// --- Error handling ---
app.onError((err, c) => {
  console.error(`[contex-api] ${c.req.method} ${c.req.path} — ${err.message}`);
  return c.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: err.message,
      },
    },
    500,
  );
});

// --- Schemas ---
const encodeSchema = z.object({
  data: z.union([z.array(z.record(z.unknown())).max(50000), z.record(z.unknown())]),
  encoding: z
    .enum(['cl100k_base', 'o200k_base', 'p50k_base', 'r50k_base'])
    .optional()
    .default('cl100k_base'),
});

const decodeSchema = z.object({
  tens: z.string().max(50_000_000), // ~50MB base64 limit
});

const contextSchema = z.object({
  data: z.array(z.record(z.unknown())).max(50000),
  model: z.string().min(1).max(100),
  systemPromptTokens: z.number().int().min(0).max(1_000_000).optional().default(0),
  userPromptTokens: z.number().int().min(0).max(1_000_000).optional().default(0),
  responseReserve: z.number().int().min(0).max(1_000_000).optional().default(1000),
  format: z.enum(['json', 'csv', 'toon', 'markdown']).optional(),
});

const insertSchema = z.object({
  data: z.array(z.record(z.unknown())).min(1).max(50000),
});

const querySchema = z.object({
  pql: z.string().min(1).max(1000),
});

// --- Routes ---

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'contex-api',
    version: '0.1.0',
    collections: engine.listCollections(),
  }),
);

app.post('/v1/encode', zValidator('json', encodeSchema), async (c) => {
  const { data, encoding } = c.req.valid('json');

  const encoder = new TokenStreamEncoder(encoding as TokenizerEncoding);
  try {
    const input = Array.isArray(data) ? data : [data];
    const binary = encoder.encode(input);
    const base64 = Buffer.from(binary).toString('base64');
    const stats = encoder.getStats(input);

    return c.json({ tens: base64, stats });
  } catch (err: any) {
    return c.json(
      {
        error: { code: 'ENCODE_ERROR', message: err.message },
      },
      422,
    );
  } finally {
    encoder.dispose();
  }
});

app.post('/v1/decode', zValidator('json', decodeSchema), async (c) => {
  const { tens } = c.req.valid('json');

  const decoder = new TokenStreamDecoder();
  try {
    const binary = new Uint8Array(Buffer.from(tens, 'base64'));
    const data = decoder.decode(binary);

    return c.json({ data });
  } catch (err: any) {
    return c.json(
      {
        error: { code: 'DECODE_ERROR', message: err.message },
      },
      422,
    );
  } finally {
    decoder.dispose();
  }
});

app.post('/v1/optimize', zValidator('json', contextSchema), async (c) => {
  const { data, model, systemPromptTokens, userPromptTokens, responseReserve } =
    c.req.valid('json');

  try {
    // Use a temporary collection name for stateless optimization
    const tempCollection = `_req_${Date.now()}`;
    engine.insert(tempCollection, data);

    const result = engine.getOptimizedContext(tempCollection, {
      model,
      systemPrompt: systemPromptTokens,
      userPrompt: userPromptTokens,
      reserve: responseReserve,
    });

    // Clean up temporary collection
    engine.drop(tempCollection);

    return c.json({
      budget: result.debug,
      context: result.output,
      usedRows: result.usedRows,
    });
  } catch (err: any) {
    return c.json(
      {
        error: { code: 'OPTIMIZE_ERROR', message: err.message },
      },
      422,
    );
  }
});

// --- Collection management ---

app.get('/v1/collections', (c) => {
  return c.json({ collections: engine.listCollections() });
});

app.post('/v1/collections/:name', zValidator('json', insertSchema), async (c) => {
  const name = c.req.param('name');
  const { data } = c.req.valid('json');

  try {
    engine.insert(name, data);
    return c.json({
      collection: name,
      inserted: data.length,
      total: engine.listCollections().includes(name) ? data.length : 0,
    });
  } catch (err: any) {
    return c.json(
      {
        error: { code: 'INSERT_ERROR', message: err.message },
      },
      422,
    );
  }
});

app.post('/v1/query', zValidator('json', querySchema), async (c) => {
  const { pql } = c.req.valid('json');

  try {
    const result = engine.query(pql);
    return c.json({
      data: result.data,
      format: result.format,
      output: result.output,
      count: result.count,
    });
  } catch (err: any) {
    return c.json(
      {
        error: { code: 'QUERY_ERROR', message: err.message },
      },
      422,
    );
  }
});

app.get('/v1/formats/:collection', async (c) => {
  const collection = c.req.param('collection');

  try {
    const analyses = engine.analyzeFormats(collection);
    return c.json({ collection, formats: analyses });
  } catch (err: any) {
    return c.json(
      {
        error: { code: 'ANALYZE_ERROR', message: err.message },
      },
      422,
    );
  }
});

// --- Start ---
const port = Number(process.env.PORT ?? 3000);
console.log(`[contex-api] Server starting on port ${port}`);

const server = serve({
  fetch: app.fetch,
  port,
});

// Graceful shutdown
function shutdown() {
  console.log('[contex-api] Shutting down...');
  engine.dispose();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
