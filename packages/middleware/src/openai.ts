import type { OpenAI } from 'openai';
import type { ChatCompletion, ChatCompletionChunk } from 'openai/resources/index.js';
import { ContexContext, messageHasPlaceholder } from './core.js';
import type { ContexMiddlewareOptions } from './types.js';

type OpenAIMessagePart = {
  type?: string;
  text?: string;
  [key: string]: unknown;
};

type OpenAIMessage = {
  role: string;
  content: string | OpenAIMessagePart[];
  [key: string]: unknown;
};

type OpenAICreateBody = {
  model: string;
  stream?: boolean;
  messages: OpenAIMessage[];
  [key: string]: unknown;
};

type DisposableOpenAI = OpenAI & { __contex_dispose?: () => void };

// ============================================================================
// @contex-llm/middleware v3 — OpenAI Integration
// ============================================================================
// Intercepts OpenAI chat completions to inject canonical IR-backed context.
// Uses the v3 IR pipeline: data → encodeIR → materialize → canonical JSON.
// Guarantees deterministic tokenization for prefix cache hits.
// Supports streaming with proper context injection.
// ============================================================================

/**
 * Creates a middleware wrapper around an OpenAI client that automatically
 * replaces `{{CONTEX:collection}}` placeholders with canonical IR-backed data.
 *
 * @example
 * ```ts
 * import OpenAI from 'openai';
 * import { createContexOpenAI } from '@contex-llm/middleware';
 *
 * const openai = createContexOpenAI(new OpenAI(), {
 *   data: {
 *     tickets: [
 *       { id: 1, title: 'Login bug', priority: 'high' },
 *       { id: 2, title: 'Signup crash', priority: 'critical' },
 *     ],
 *   },
 *   onInject: (info) => console.log(`Injected ${info.tokenCount} tokens for ${info.collection}`),
 * });
 *
 * // Non-streaming
 * const response = await openai.chat.completions.create({
 *   model: 'gpt-4o',
 *   messages: [
 *     { role: 'user', content: 'Analyze these tickets: {{CONTEX:tickets}}' }
 *   ],
 * });
 *
 * // Streaming (still injects context for prefix caching)
 * const stream = await openai.chat.completions.create({
 *   model: 'gpt-4o',
 *   messages: [
 *     { role: 'user', content: 'Analyze these tickets: {{CONTEX:tickets}}' }
 *   ],
 *   stream: true,
 * });
 * for await (const chunk of stream) {
 *   console.log(chunk.choices[0]?.delta?.content || '');
 * }
 * ```
 */
export function createContexOpenAI(client: OpenAI, options: ContexMiddlewareOptions = {}): OpenAI {
  const ctx = new ContexContext(options);
  const originalCreate = client.chat.completions.create.bind(client.chat.completions);
  const invokeCreate = (body: OpenAICreateBody, reqOptions?: unknown) => {
    return originalCreate(
      body as Parameters<typeof originalCreate>[0],
      reqOptions as Parameters<typeof originalCreate>[1],
    );
  };

  // @ts-ignore — Dynamic proxy typing; runtime behavior is correct
  client.chat.completions.create = async (
    body: OpenAICreateBody,
    reqOptions?: unknown,
  ): Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>> => {
    const model: string = body.model;
    const isStreaming = body.stream === true;

    // Check if any messages contain CONTEX placeholders
    let hasPlaceholders = false;
    for (const msg of body.messages) {
      if (messageHasPlaceholder(msg.content)) {
        hasPlaceholders = true;
        break;
      }
    }

    if (!hasPlaceholders) {
      return invokeCreate(body, reqOptions);
    }

    // Process messages — replace placeholders with canonical JSON
    // This works for both streaming and non-streaming - the context is injected
    // as text before being sent, which enables prefix caching on the provider side
    const newMessages = body.messages.map((msg) => {
      if (!messageHasPlaceholder(msg.content)) return msg;
      return processMessage(msg, ctx, model);
    });

    // For streaming, we inject context but return the raw stream
    // The context text is still deterministic, enabling prefix cache hits
    if (isStreaming) {
      // Note: OpenAI streaming responses can't be modified by middleware
      // But the injected context text is deterministic, so prefix caching still works
      return invokeCreate({ ...body, messages: newMessages }, reqOptions);
    }

    return invokeCreate({ ...body, messages: newMessages }, reqOptions);
  };

  // Attach dispose method for cleanup
  (client as DisposableOpenAI).__contex_dispose = () => ctx.dispose();

  return client;
}

/**
 * Process a single message, replacing all CONTEX placeholders.
 */
function processMessage(msg: OpenAIMessage, ctx: ContexContext, model: string): OpenAIMessage {
  if (typeof msg.content === 'string') {
    return {
      ...msg,
      content: ctx.replacePlaceholders(msg.content, model),
    };
  }

  if (Array.isArray(msg.content)) {
    return {
      ...msg,
      content: msg.content.map((part) => {
        if (part.type === 'text' && part.text?.includes('{{CONTEX:')) {
          return {
            ...part,
            text: ctx.replacePlaceholders(part.text, model),
          };
        }
        return part;
      }),
    };
  }

  return msg;
}
