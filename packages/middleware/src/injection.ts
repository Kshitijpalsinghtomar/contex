import { Tens, TokenMemory } from '@contex/core';
import { providerSupportsTokens } from './config.js';

export type TensReference = { tensHash: string };
export type TensOrRef = Tens | TensReference;

/**
 * Inject Contex content (TENS) into an LLM call.
 *
 * This function abstracts the decision between injecting canonical text
 * or raw tokens based on provider capabilities and configuration.
 *
 * @param client - The LLM provider client (e.g. Anthropic, OpenAI)
 * @param modelId - The target model ID
 * @param tensOrRef - The TENS object or a reference hash
 * @param executionCallback - Callback to execute the actual API call.
 *                            Receives the final payload (text or tokens).
 *
 * @example
 * ```ts
 * const result = await injectContexContent(
 *   anthropic,
 *   'claude-3-5-sonnet',
 *   myTens,
 *   (payload) => anthropic.messages.create({ ...baseParams, ...payload })
 * );
 * ```
 */
export async function injectContexContent<ClientType, ReturnType>(
  client: ClientType,
  modelId: string,
  tensOrRef: TensOrRef,
  executionCallback: (payload: { text?: string; tokens?: number[] }) => Promise<ReturnType>,
): Promise<ReturnType> {
  // 1. Resolve Tens Object
  let tens: Tens;
  if ('tensHash' in tensOrRef) {
    // Load from hash
    try {
      // @ts-ignore - loadFromHash is static but sometimes TS gets confused with circular deps in monorepos
      tens = Tens.loadFromHash(tensOrRef.tensHash);
    } catch (error) {
      console.warn(
        `[Contex] Failed to load Tens from hash ${tensOrRef.tensHash}, falling back to empty.`,
        error,
      );
      // Fail safe or throw? Throwing is better for "IR-first" integrity.
      throw error;
    }
  } else {
    tens = tensOrRef;
  }

  // 2. Check capabilities
  const supportsTokens = providerSupportsTokens(modelId);

  // 3. Check Cache & Inject
  if (supportsTokens) {
    // Prepare to materialize.
    // Note: materialize() handles caching internally via TokenMemory.
    try {
      // We use a small optimization: check if cache exists without full materialization if possible?
      // But Tens.materialize() is fast if cached.

      // Check if we *should* check cache first to avoid download?
      // As per implementation guidance: "If supports tokens and cached tokens exist → inject tokens.bin"
      // tens.materialize() does this check.

      const tokenInt32 = tens.materialize(modelId);
      const tokens = Array.from(tokenInt32); // Convert to number[]

      // Note: We're assuming the provider API accepts `tokens`.
      // The `executionCallback` must handle `{ tokens: number[] }`.
      return executionCallback({ tokens });
    } catch (e) {
      console.warn(`[Contex] Token materialization failed, falling back to text.`, e);
      // Fallback to text
    }
  }

  // 4. Default: Canonical Text
  const text = tens.toString();
  return executionCallback({ text });
}
