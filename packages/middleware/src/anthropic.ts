import type { Anthropic } from '@anthropic-ai/sdk';
import { ContexContext, messageHasPlaceholder } from './core.js';
import type { ContexMiddlewareOptions } from './types.js';

type AnthropicContentBlock = {
  type?: string;
  text?: string;
  cache_control?: { type: string };
  [key: string]: unknown;
};

type AnthropicMessage = {
  role: string;
  content: string | AnthropicContentBlock[];
  [key: string]: unknown;
};

type AnthropicCreateBody = {
  model: string;
  stream?: boolean;
  max_tokens?: number;
  system?: unknown;
  messages: AnthropicMessage[];
  [key: string]: unknown;
};

type DisposableAnthropic = Anthropic & { __contex_dispose?: () => void };

// ============================================================================
// @contex-llm/middleware v3 — Anthropic Integration
// ============================================================================
// Intercepts Anthropic message creation to inject canonical IR-backed context.
// Handles Anthropic-specific patterns:
//   - Separate `system` parameter (not a message role)
//   - Content blocks array format
//   - Streaming with beta header support
// ============================================================================

/**
 * Creates a middleware wrapper around an Anthropic client that automatically
 * replaces `{{CONTEX:collection}}` placeholders with canonical IR-backed data.
 *
 * @example
 * ```ts
 * import Anthropic from '@anthropic-ai/sdk';
 * import { createContexAnthropic } from '@contex-llm/middleware';
 *
 * const client = createContexAnthropic(new Anthropic(), {
 *   data: { tickets: myTickets },
 *   onInject: (info) => console.log(`Injected ${info.collection}`),
 * });
 *
 * // Non-streaming
 * const response = await client.messages.create({
 *   model: 'claude-sonnet-4-20250514',
 *   messages: [{ role: 'user', content: 'Analyze: {{CONTEX:tickets}}' }],
 *   max_tokens: 1024,
 * });
 *
 * // Streaming
 * const stream = await client.messages.create({
 *   model: 'claude-sonnet-4-20250514',
 *   messages: [{ role: 'user', content: 'Analyze: {{CONTEX:tickets}}' }],
 *   max_tokens: 1024,
 *   stream: true,
 * });
 * for await (const chunk of stream) {
 *   console.log(chunk.type, chunk.delta?.text);
 * }
 * ```
 */
export function createContexAnthropic(
  client: Anthropic,
  options: ContexMiddlewareOptions = {},
): Anthropic {
  const ctx = new ContexContext(options);
  const originalCreate = client.messages.create.bind(client.messages);
  const invokeCreate = (body: AnthropicCreateBody, reqOptions?: unknown) => {
    return originalCreate(
      body as Parameters<typeof originalCreate>[0],
      reqOptions as Parameters<typeof originalCreate>[1],
    );
  };

  // @ts-ignore — Dynamic proxy typing; runtime behavior is correct
  client.messages.create = async (body: AnthropicCreateBody, reqOptions?: unknown) => {
    const model: string = body.model;
    const isStreaming = body.stream === true;

    // Check system and messages for placeholders
    const systemHasPlaceholder =
      typeof body.system === 'string' && body.system.includes('{{CONTEX:');
    let messagesHavePlaceholder = false;
    for (const msg of body.messages) {
      if (messageHasPlaceholder(msg.content)) {
        messagesHavePlaceholder = true;
        break;
      }
    }

    if (!systemHasPlaceholder && !messagesHavePlaceholder) {
      return invokeCreate(body, reqOptions);
    }

    const newBody = { ...body };

    // Process system prompt
    if (systemHasPlaceholder && typeof body.system === 'string') {
      newBody.system = ctx.replacePlaceholders(body.system, model);
    }

    // Process messages
    if (messagesHavePlaceholder) {
      newBody.messages = body.messages.map((msg) => {
        if (!messageHasPlaceholder(msg.content)) return msg;
        return processMessage(msg, ctx, model, isStreaming);
      });
    }

    // For streaming, context is still injected before sending
    // The deterministic canonical text enables Anthropic's cache to work
    return invokeCreate(newBody, reqOptions);
  };

  (client as DisposableAnthropic).__contex_dispose = () => ctx.dispose();

  return client;
}

function processMessage(
  msg: AnthropicMessage,
  ctx: ContexContext,
  model: string,
  _isStreaming = false,
): AnthropicMessage {
  if (typeof msg.content === 'string') {
    const newContent = ctx.replacePlaceholders(msg.content, model);
    if (newContent !== msg.content) {
      // Heuristic: If content is large (>~1000 tokens), enable caching
      // 3500 chars is roughly 800-1000 tokens. Anthropic minimum is 1024.
      // Note: Cache control works in streaming too with proper beta headers
      if (newContent.length > 3500) {
        return {
          ...msg,
          content: [
            {
              type: 'text',
              text: newContent,
              cache_control: { type: 'ephemeral' },
            },
          ],
        };
      }
      return {
        ...msg,
        content: newContent,
      };
    }
    return msg;
  }

  if (Array.isArray(msg.content)) {
    return {
      ...msg,
      content: msg.content.map((block) => {
        if (block.type === 'text' && block.text?.includes('{{CONTEX:')) {
          const newText = ctx.replacePlaceholders(block.text, model);
          if (newText !== block.text && newText.length > 3500) {
            return {
              ...block,
              text: newText,
              cache_control: { type: 'ephemeral' },
            };
          }
          return { ...block, text: newText };
        }
        return block;
      }),
    };
  }

  return msg;
}
