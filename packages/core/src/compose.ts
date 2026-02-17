// ============================================================================
// @contex/core — Token Composition
// ============================================================================
//
// Composes prompts from reusable token blocks with budget validation.
//
// Blocks:
//   - 'text' blocks: raw text (system prompts, instructions, few-shot examples)
//   - 'ir' blocks: Canonical IR (auto-materialized for the target model)
//   - 'tokens' blocks: pre-computed token arrays
//
// Priority:
//   - 'required': must fit or compose() throws
//   - 'optional': packed greedily until budget full (in order)
//
// Budget:
//   - Validated against the model's context window
//   - reserveForResponse tokens are subtracted from available budget
//   - Each block can have a maxTokens cap
// ============================================================================

import { resolveEncoding } from './materialize.js';
import type { TokenMemory } from './memory.js';
import { TokenizerManager } from './tokenizer.js';
import type { TensIR, TokenizerEncoding } from './types.js';

// ---- Model Context Windows ----
// Subset of context window sizes for budget validation.
// Matches the models registered in materialize.ts.

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4.1': 1_047_576,
  'gpt-4.1-mini': 1_047_576,
  'gpt-4.1-nano': 1_047_576,
  'gpt-5': 256_000,
  'gpt-5-mini': 256_000,
  'gpt-5-nano': 256_000,
  'gpt-5.2': 256_000,
  'gpt-5.3-codex': 256_000,
  'o3-mini': 200_000,
  'o4-mini': 200_000,
  'gpt-4': 8_192,
  'gpt-4-turbo': 128_000,
  'gpt-3.5-turbo': 16_385,
  'claude-3-5-sonnet': 200_000,
  'claude-3-7-sonnet': 200_000,
  'claude-4-sonnet': 200_000,
  'claude-4-5-sonnet': 200_000,
  'claude-opus-4-5': 200_000,
  'claude-3-5-haiku': 200_000,
  'claude-haiku-4-5': 200_000,
  'gemini-2-0-flash': 1_048_576,
  'gemini-2-5-flash': 1_048_576,
  'gemini-2-5-flash-lite': 1_048_576,
  'gemini-2-5-pro': 1_048_576,
  'llama-4-maverick': 1_048_576,
  'llama-4-scout': 512_000,
  'deepseek-v3-2': 128_000,
  'deepseek-r1': 128_000,
  'grok-3': 131_072,
  'grok-4-fast': 131_072,
  'mistral-large': 128_000,
  'mistral-small': 128_000,
  'cohere-command-r-plus': 128_000,
  'qwen-2-5-72b': 128_000,
  'amazon-nova-pro': 300_000,
};

/**
 * Register a custom model context window size.
 */
export function registerModelContextWindow(modelId: string, contextWindow: number): void {
  MODEL_CONTEXT_WINDOWS[modelId] = contextWindow;
}

// ---- Types ----

/** A named, reusable token block for prompt composition. */
export type TokenBlock = TextBlock | IRBlock | TokensBlock;

/** Raw text block (system prompt, instructions, etc.) */
export interface TextBlock {
  /** Block name for identification in results */
  name: string;
  type: 'text';
  /** Raw text content */
  content: string;
  /** Priority: 'required' must fit, 'optional' is best-effort */
  priority: 'required' | 'optional';
  /** Maximum tokens for this block (content will be truncated) */
  maxTokens?: number;
}

/** Canonical IR block (auto-materialized for target model) */
export interface IRBlock {
  name: string;
  type: 'ir';
  /** Canonical IR to materialize */
  ir: TensIR;
  priority: 'required' | 'optional';
  maxTokens?: number;
}

/** Pre-computed token array block */
export interface TokensBlock {
  name: string;
  type: 'tokens';
  /** Pre-computed token IDs */
  tokens: number[];
  priority: 'required' | 'optional';
  maxTokens?: number;
}

/** Request to compose a prompt. */
export interface ComposeRequest {
  /** Target model (e.g. 'gpt-4o') */
  model: string;
  /** Blocks to compose, processed in order */
  blocks: TokenBlock[];
  /** Tokens to reserve for model response (default: 4096) */
  reserveForResponse?: number;
  /** Custom context window override (if model not in registry) */
  contextWindow?: number;
}

/** Request to compose from IR hashes stored in TokenMemory. */
export interface ComposeFromHashesRequest {
  /** IR hashes stored in TokenMemory, composed in order */
  hashes: string[];
  /** Target model (e.g. 'gpt-4o') */
  model: string;
  /** Optional system prompt (inserted as first required text block) */
  systemPrompt?: string;
  /** Tokens to reserve for model response (default: 4096) */
  reserveForResponse?: number;
  /** Custom context window override (if model not in registry) */
  contextWindow?: number;
}

/** Result of a block in the composition. */
export interface BlockResult {
  /** Block name */
  name: string;
  /** Block type */
  type: 'text' | 'ir' | 'tokens';
  /** Block priority */
  priority: 'required' | 'optional';
  /** Whether this block was included */
  included: boolean;
  /** Token IDs for this block (if included) */
  tokens: number[];
  /** Number of tokens used */
  tokenCount: number;
  /** Reason excluded (if not included) */
  excludedReason?: string;
}

/** Result of composing a prompt. */
export interface ComposeResult {
  /** Assembled token array (all included blocks concatenated) */
  tokens: number[];
  /** Total token count */
  totalTokens: number;
  /** Target model */
  model: string;
  /** Tokenizer encoding used */
  encoding: TokenizerEncoding;
  /** Model's context window size */
  contextWindow: number;
  /** Tokens reserved for response */
  reservedForResponse: number;
  /** Available budget (contextWindow - reserved) */
  budgetTokens: number;
  /** Tokens remaining after composition */
  remainingTokens: number;
  /** Budget utilization percentage */
  utilizationPct: number;
  /** Per-block breakdown */
  blocks: BlockResult[];
}

// ---- Compose Function ----

/**
 * Compose a prompt from reusable token blocks with budget validation.
 *
 * Blocks are processed in order:
 * 1. All 'required' blocks must fit within the budget or an error is thrown.
 * 2. 'optional' blocks are packed greedily until the budget is full.
 * 3. Each block can have a `maxTokens` cap to limit its contribution.
 *
 * @param request - The composition request (model, blocks, response reserve)
 * @returns ComposeResult with assembled tokens and budget breakdown
 * @throws If required blocks exceed the context window budget
 */
export function compose(request: ComposeRequest): ComposeResult {
  const composer = new Composer();
  try {
    return composer.compose(request);
  } finally {
    composer.dispose();
  }
}

/**
 * Compose a prompt from IR hashes stored in TokenMemory.
 *
 * Operates at the IR level: loads each IR from memory, materializes once
 * per hash, and assembles with budget validation. This keeps IR as the
 * primary primitive and avoids unnecessary re-tokenization.
 *
 * @param request - Hashes, model, and budget options
 * @param memory - TokenMemory instance to load IRs from
 * @returns ComposeResult with assembled tokens and budget breakdown
 *
 * @example
 * ```ts
 * const memory = new TokenMemory('.contex');
 * const r1 = memory.store(usersData);
 * const r2 = memory.store(ordersData);
 *
 * const result = composeFromHashes({
 *     hashes: [r1.hash, r2.hash],
 *     model: 'gpt-4o',
 *     systemPrompt: 'Analyze the user orders:',
 *     reserveForResponse: 4096,
 * }, memory);
 * ```
 */
export function composeFromHashes(
  request: ComposeFromHashesRequest,
  memory: TokenMemory,
): ComposeResult {
  // Load IRs from memory and build blocks
  const blocks: TokenBlock[] = [];

  // Optional system prompt as first required text block
  if (request.systemPrompt) {
    blocks.push({
      name: 'system',
      type: 'text',
      content: request.systemPrompt,
      priority: 'required',
    });
  }

  // Convert hashes to IR blocks
  for (const hash of request.hashes) {
    const ir = memory.load(hash);
    blocks.push({
      name: `ir:${hash.slice(0, 8)}`,
      type: 'ir',
      ir,
      priority: 'required',
    });
  }

  return compose({
    model: request.model,
    blocks,
    reserveForResponse: request.reserveForResponse,
    contextWindow: request.contextWindow,
  });
}

/**
 * Composer: stateful composition engine with reusable tokenizer.
 *
 * Use `createComposer()` for repeated compositions to amortize setup cost.
 */
export class Composer {
  private tokenizer: TokenizerManager;

  constructor() {
    this.tokenizer = new TokenizerManager('cl100k_base');
  }

  /**
   * Compose a prompt from token blocks.
   */
  compose(request: ComposeRequest): ComposeResult {
    const { model, blocks } = request;
    const reserveForResponse = request.reserveForResponse ?? 4096;

    // Resolve model encoding and context window
    const encoding = resolveEncoding(model);
    const contextWindow = request.contextWindow ?? MODEL_CONTEXT_WINDOWS[model];
    if (!contextWindow) {
      throw new Error(
        `Unknown model context window: "${model}". Provide contextWindow in the request or register with registerModelContextWindow().`,
      );
    }

    const budgetTokens = contextWindow - reserveForResponse;
    if (budgetTokens <= 0) {
      throw new Error(
        `No token budget available: context window (${contextWindow}) ` +
          `minus response reserve (${reserveForResponse}) = ${budgetTokens}`,
      );
    }

    // Materialize/tokenize all blocks
    const blockResults: BlockResult[] = [];
    let usedTokens = 0;

    for (const block of blocks) {
      // Materialize this block into tokens
      let blockTokens = this.materializeBlock(block, encoding);

      // Apply maxTokens cap
      if (block.maxTokens && blockTokens.length > block.maxTokens) {
        blockTokens = blockTokens.slice(0, block.maxTokens);
      }

      const tokenCount = blockTokens.length;
      const wouldUse = usedTokens + tokenCount;

      if (block.priority === 'required') {
        if (wouldUse > budgetTokens) {
          throw new Error(
            `Budget exceeded by required block "${block.name}": ` +
              `needs ${wouldUse} tokens but budget is ${budgetTokens} ` +
              `(context: ${contextWindow}, reserved: ${reserveForResponse})`,
          );
        }

        blockResults.push({
          name: block.name,
          type: block.type,
          priority: 'required',
          included: true,
          tokens: blockTokens,
          tokenCount,
        });
        usedTokens = wouldUse;
      } else {
        // Optional: pack greedily
        if (wouldUse <= budgetTokens) {
          blockResults.push({
            name: block.name,
            type: block.type,
            priority: 'optional',
            included: true,
            tokens: blockTokens,
            tokenCount,
          });
          usedTokens = wouldUse;
        } else {
          // Try to fit a partial block if possible
          const remaining = budgetTokens - usedTokens;
          if (remaining > 0) {
            const partialTokens = blockTokens.slice(0, remaining);
            blockResults.push({
              name: block.name,
              type: block.type,
              priority: 'optional',
              included: true,
              tokens: partialTokens,
              tokenCount: partialTokens.length,
              excludedReason: `Truncated: ${tokenCount} → ${partialTokens.length} tokens (budget limit)`,
            });
            usedTokens += partialTokens.length;
          } else {
            blockResults.push({
              name: block.name,
              type: block.type,
              priority: 'optional',
              included: false,
              tokens: [],
              tokenCount: 0,
              excludedReason: `Budget full: needed ${tokenCount} tokens, 0 remaining`,
            });
          }
        }
      }
    }

    // Assemble final token array from included blocks
    const assembledTokens: number[] = [];
    for (const br of blockResults) {
      if (br.included) {
        assembledTokens.push(...br.tokens);
      }
    }

    const remainingTokens = budgetTokens - usedTokens;
    const utilizationPct =
      budgetTokens > 0 ? Math.round((usedTokens / budgetTokens) * 1000) / 10 : 0;

    return {
      tokens: assembledTokens,
      totalTokens: assembledTokens.length,
      model,
      encoding,
      contextWindow,
      reservedForResponse: reserveForResponse,
      budgetTokens,
      remainingTokens,
      utilizationPct,
      blocks: blockResults,
    };
  }

  /**
   * Materialize a block into token IDs.
   */
  private materializeBlock(block: TokenBlock, encoding: TokenizerEncoding): number[] {
    switch (block.type) {
      case 'text':
        return this.tokenizer.tokenize(block.content, encoding);
      case 'ir': {
        // Tokenize the canonical data from the IR
        const jsonText = JSON.stringify(block.ir.data);
        return this.tokenizer.tokenize(jsonText, encoding);
      }
      case 'tokens':
        return [...block.tokens]; // Copy to avoid mutation
      default:
        throw new Error(`Unknown block type: ${(block as { type?: unknown }).type}`);
    }
  }

  dispose(): void {
    this.tokenizer.dispose();
  }
}

/**
 * Create a reusable Composer instance.
 *
 * Use this for repeated compositions to avoid re-initializing
 * the tokenizer each time.
 */
export function createComposer(): Composer {
  return new Composer();
}
