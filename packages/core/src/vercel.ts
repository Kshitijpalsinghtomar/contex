import { compile } from './contex.js';
import type { CompileOptions } from './contex.js';

/**
 * Minimal interface matching Vercel AI SDK's CoreMessage/Message.
 * We avoid a hard dependency on 'ai' to keep the core package light.
 */
export interface VercelMessage {
  role: string;
  content: string | unknown;
  // ... other fields ignored
}

/**
 * Contex Middleware for Vercel AI SDK.
 *
 * Automatically detects and compiles structured JSON in the last user message.
 *
 * @example
 * ```typescript
 * import { streamText } from 'ai';
 * import { contex } from '@contex-llm/core/vercel';
 *
 * await streamText({
 *   model: openai('gpt-4o'),
 *   messages: contex(messages) // <--- Drop-in optimization
 * });
 * ```
 */
export function contex(messages: VercelMessage[], options?: CompileOptions): VercelMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    return messages;
  }

  // Clone to avoid mutating original array (best practice)
  const newMessages = [...messages];
  const lastIndex = newMessages.length - 1;
  const lastMsg = newMessages[lastIndex];

  // Only optimize if it's a user message
  if (lastMsg.role !== 'user') {
    return messages;
  }

  // Attempt to parse and compile content
  if (typeof lastMsg.content === 'string') {
    // Heuristic: Does it look like a JSON array/object?
    const trimmed = lastMsg.content.trim();
    if (
      (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
      (trimmed.startsWith('{') && trimmed.endsWith('}'))
    ) {
      try {
        const data = JSON.parse(trimmed);
        // Only compile if it's an array of objects (our sweet spot for now)
        if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
          const optimizedParams = compile(data, options);

          // Replace content with optimized Contex Compact format
          newMessages[lastIndex] = {
            ...lastMsg,
            content: optimizedParams,
          };
        }
      } catch (e) {
        // Not valid JSON, ignore
      }
    }
  } else if (Array.isArray(lastMsg.content)) {
    // Handle if content is already an object/array (Vercel CoreMessage can be mixed)
    if (lastMsg.content.length > 0 && typeof lastMsg.content[0] === 'object') {
      try {
        const optimizedParams = compile(lastMsg.content as Record<string, unknown>[], options);
        newMessages[lastIndex] = {
          ...lastMsg,
          content: optimizedParams,
        };
      } catch (e) {
        // ignore
      }
    }
  }

  return newMessages;
}
