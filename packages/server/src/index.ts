import { TokenMemory, encodeIR } from '@contex-llm/core';
import { Contex as contex } from '@contex-llm/engine';
import { createContexAnthropic, createContexGemini, createContexOpenAI } from '@contex-llm/middleware';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';

// ============================================================================
// @contex-llm/server — Production REST API
// ============================================================================
//
// Singleton engine instance, proper validation, CORS, structured errors.
// ============================================================================

export const app = new Hono();
const memory = new TokenMemory('.contex');

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

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
});

const decodeSchema = z.object({
  hash: z.string().min(1).max(128),
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

const providerDataSchema = z.record(z.array(z.record(z.unknown())).max(50000)).optional();

const openaiChatSchema = z.object({
  model: z.string().min(1).max(100),
  messages: z.array(z.record(z.unknown())).min(1),
  data: providerDataSchema,
});

const anthropicMessagesSchema = z.object({
  model: z.string().min(1).max(100),
  messages: z.array(z.record(z.unknown())).min(1),
  max_tokens: z.number().int().min(1).max(1_000_000).optional().default(1024),
  system: z.union([z.string(), z.array(z.record(z.unknown()))]).optional(),
  data: providerDataSchema,
});

const geminiGenerateSchema = z.object({
  model: z.string().min(1).max(100),
  prompt: z.string().min(1),
  data: providerDataSchema,
});

// --- Routes ---

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'contex-api',
    version: '0.1.0',
    collections: engine.listCollections(),
    providerGateway: {
      middlewareConnected: true,
      openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
      anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
      geminiConfigured: Boolean(process.env.GOOGLE_API_KEY),
    },
  }),
);

app.post('/v1/encode', zValidator('json', encodeSchema), async (c) => {
  const { data } = c.req.valid('json');
  try {
    const input = Array.isArray(data) ? data : [data];
    const ir = encodeIR(input);
    const stored = memory.storeIR(ir);

    return c.json({
      hash: ir.hash,
      ir: Buffer.from(ir.ir).toString('base64'),
      rowCount: ir.data.length,
      irByteSize: ir.ir.byteLength,
      isNew: stored.isNew,
      irVersion: ir.irVersion,
      canonicalizationVersion: ir.canonicalizationVersion,
    });
  } catch (err: unknown) {
    return c.json(
      {
        error: { code: 'ENCODE_ERROR', message: errorMessage(err) },
      },
      422,
    );
  }
});

app.post('/v1/decode', zValidator('json', decodeSchema), async (c) => {
  const { hash } = c.req.valid('json');
  try {
    const ir = memory.load(hash);

    return c.json({
      hash: ir.hash,
      data: ir.data,
      rowCount: ir.data.length,
      irVersion: ir.irVersion,
      canonicalizationVersion: ir.canonicalizationVersion,
    });
  } catch (err: unknown) {
    return c.json(
      {
        error: { code: 'DECODE_ERROR', message: errorMessage(err) },
      },
      422,
    );
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
  } catch (err: unknown) {
    return c.json(
      {
        error: { code: 'OPTIMIZE_ERROR', message: errorMessage(err) },
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
  } catch (err: unknown) {
    return c.json(
      {
        error: { code: 'INSERT_ERROR', message: errorMessage(err) },
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
  } catch (err: unknown) {
    return c.json(
      {
        error: { code: 'QUERY_ERROR', message: errorMessage(err) },
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
  } catch (err: unknown) {
    return c.json(
      {
        error: { code: 'ANALYZE_ERROR', message: errorMessage(err) },
      },
      422,
    );
  }
});

// --- Provider gateway routes (middleware-connected) ---

app.post('/v1/providers/openai/chat', zValidator('json', openaiChatSchema), async (c) => {
  const { model, messages, data } = c.req.valid('json');

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return c.json(
        {
          error: {
            code: 'PROVIDER_CONFIG_ERROR',
            message: 'OPENAI_API_KEY is not configured',
          },
        },
        400,
      );
    }

    const { default: OpenAI } = await import('openai');
    const rawClient = new OpenAI({ apiKey });
    const client = createContexOpenAI(rawClient, { data });

    const response = await client.chat.completions.create({
      model,
      messages,
      stream: false,
    } as any);

    return c.json({
      provider: 'openai',
      model,
      response,
    });
  } catch (err: unknown) {
    return c.json(
      {
        error: { code: 'OPENAI_ROUTE_ERROR', message: errorMessage(err) },
      },
      422,
    );
  }
});

app.post('/v1/providers/anthropic/messages', zValidator('json', anthropicMessagesSchema), async (c) => {
  const { model, messages, max_tokens, system, data } = c.req.valid('json');

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return c.json(
        {
          error: {
            code: 'PROVIDER_CONFIG_ERROR',
            message: 'ANTHROPIC_API_KEY is not configured',
          },
        },
        400,
      );
    }

    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const rawClient = new Anthropic({ apiKey });
    const client = createContexAnthropic(rawClient, { data });

    const response = await client.messages.create({
      model,
      max_tokens,
      system,
      messages,
    } as any);

    return c.json({
      provider: 'anthropic',
      model,
      response,
    });
  } catch (err: unknown) {
    return c.json(
      {
        error: { code: 'ANTHROPIC_ROUTE_ERROR', message: errorMessage(err) },
      },
      422,
    );
  }
});

app.post('/v1/providers/gemini/generate', zValidator('json', geminiGenerateSchema), async (c) => {
  const { model, prompt, data } = c.req.valid('json');

  try {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return c.json(
        {
          error: {
            code: 'PROVIDER_CONFIG_ERROR',
            message: 'GOOGLE_API_KEY is not configured',
          },
        },
        400,
      );
    }

    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const rawModel = genAI.getGenerativeModel({ model });
    const wrappedModel = createContexGemini(rawModel as any, model, { data });

    const response = await wrappedModel.generateContent(prompt);
    const text = response && typeof response === 'object' && 'response' in response
      ? (response.response as { text?: () => string }).text?.()
      : undefined;

    return c.json({
      provider: 'gemini',
      model,
      text,
    });
  } catch (err: unknown) {
    return c.json(
      {
        error: { code: 'GEMINI_ROUTE_ERROR', message: errorMessage(err) },
      },
      422,
    );
  }
});

// --- Start ---
export function startServer(port = Number(process.env.PORT ?? 3000)) {
  console.log(`[contex-api] Server starting on port ${port}`);
  serve({
    fetch: app.fetch,
    port,
  });

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Graceful shutdown
function shutdown() {
  console.log('[contex-api] Shutting down...');
  engine.dispose();
  process.exit(0);
}

const isDirectExecution = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isDirectExecution) {
  startServer();
}
