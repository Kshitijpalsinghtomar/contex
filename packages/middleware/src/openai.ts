import type { OpenAI } from 'openai';
import { ContexContext, messageHasPlaceholder } from './core.js';
import type { ContexMiddlewareOptions } from './types.js';

// ============================================================================
// @contex/middleware v3 — OpenAI Integration
// ============================================================================
// Intercepts OpenAI chat completions to inject canonical IR-backed context.
// Uses the v3 IR pipeline: data → encodeIR → materialize → canonical JSON.
// Guarantees deterministic tokenization for prefix cache hits.
// ============================================================================

/**
 * Creates a middleware wrapper around an OpenAI client that automatically
 * replaces `{{CONTEX:collection}}` placeholders with canonical IR-backed data.
 *
 * @example
 * ```ts
 * import OpenAI from 'openai';
 * import { createContexOpenAI } from '@contex/middleware';
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
 * const response = await openai.chat.completions.create({
 *   model: 'gpt-4o',
 *   messages: [
 *     { role: 'user', content: 'Analyze these tickets: {{CONTEX:tickets}}' }
 *   ],
 * });
 * ```
 */
export function createContexOpenAI(client: OpenAI, options: ContexMiddlewareOptions = {}): OpenAI {
  const ctx = new ContexContext(options);
  const originalCreate = client.chat.completions.create.bind(client.chat.completions);

  // @ts-ignore — Dynamic proxy typing; runtime behavior is correct
  client.chat.completions.create = async (body: any, reqOptions?: any) => {
    const model: string = body.model;

    // Check if any messages contain CONTEX placeholders
    let hasPlaceholders = false;
    for (const msg of body.messages) {
      if (messageHasPlaceholder(msg.content)) {
        hasPlaceholders = true;
        break;
      }
    }

    if (!hasPlaceholders) {
      return originalCreate(body, reqOptions);
    }

    // Process messages — replace placeholders with canonical JSON
    const newMessages = body.messages.map((msg: any) => {
      if (!messageHasPlaceholder(msg.content)) return msg;
      return processMessage(msg, ctx, model);
    });

    return originalCreate({ ...body, messages: newMessages }, reqOptions);
  };

  // Attach dispose method for cleanup
  (client as any).__contex_dispose = () => ctx.dispose();

  return client;
}

/**
 * Process a single message, replacing all CONTEX placeholders.
 */
function processMessage(msg: any, ctx: ContexContext, model: string): any {
  if (typeof msg.content === 'string') {
    return {
      ...msg,
      content: ctx.replacePlaceholders(msg.content, model),
    };
  }

  if (Array.isArray(msg.content)) {
    return {
      ...msg,
      content: msg.content.map((part: any) => {
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
