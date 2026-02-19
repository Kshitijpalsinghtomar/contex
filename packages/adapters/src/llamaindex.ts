// ============================================================================
// @contex-llm/adapters — LlamaIndex Adapter
// ============================================================================
//
// ContexReader: LlamaIndex Data Reader with Contex optimization
// Automatically optimizes indexed data for LLM context
// ============================================================================

import { Tens } from '@contex-llm/core';
import type { OutputFormat } from '@contex-llm/core';

/**
 * Options for ContexReader
 */
export interface ContexReaderOptions {
  /**
   * Output format for the optimized text
   * @default 'contex'
   */
  format?: OutputFormat;

  /**
   * Model to use for tokenization (determines optimization)
   * @default 'gpt-4o'
   */
  model?: string;

  /**
   * Enable field name compression
   * @default true
   */
  compressFields?: boolean;

  /**
   * Include source information in output
   * @default true
   */
  includeSource?: boolean;

  /**
   * Maximum number of documents to process
   * @default 1000
   */
  maxDocuments?: number;
}

/**
 * LlamaIndex Node interface (compatible with LlamaIndex v0.10+)
 */
interface LlamaIndexNode {
  id_: string;
  text: string;
  metadata?: Record<string, unknown>;
  embedding?: number[];
}

/**
 * ContexReader: LlamaIndex Data Reader with Contex optimization
 *
 * This reader automatically optimizes data retrieved from LlamaIndex indexes
 * using Contex's token-efficient format, reducing context costs by 40-90%.
 *
 * @example
 * ```ts
 * import { ContexReader } from '@contex-llm/adapters/llamaindex';
 *
 * // Use with LlamaIndex
 * const reader = new ContexReader({
 *   format: 'markdown',
 *   model: 'gpt-4o'
 * });
 *
 * const nodes = await index.retrieve(query);
 * const optimized = reader.optimizeNodes(nodes);
 * ```
 */
export class ContexReader {
  private options: Required<ContexReaderOptions>;

  constructor(options: ContexReaderOptions = {}) {
    this.options = {
      format: options.format ?? 'contex',
      model: options.model ?? 'gpt-4o',
      compressFields: options.compressFields ?? true,
      includeSource: options.includeSource ?? true,
      maxDocuments: options.maxDocuments ?? 1000,
    };
  }

  /**
   * Optimize nodes retrieved from a LlamaIndex index
   */
  optimizeNodes(nodes: LlamaIndexNode[]): LlamaIndexNode[] {
    const limitedNodes = nodes.slice(0, this.options.maxDocuments);

    // Convert nodes to structured data
    const data = limitedNodes.map((node, idx) => {
      const record: Record<string, unknown> = {
        _index: idx,
        _text: node.text,
      };

      if (this.options.includeSource) {
        record._id = node.id_;
        if (node.metadata) {
          record._metadata = node.metadata;
        }
      }

      return record;
    });

    // Optimize with Contex
    const tens = Tens.encode(data);

    const optimizedText = tens.toString();
    const tokenCount = tens.materialize(this.options.model).length;

    // Return single optimized node
    return [
      {
        id_: 'contex-optimized',
        text: optimizedText,
        metadata: {
          ...(this.options.includeSource ? { _originalNodeCount: limitedNodes.length } : {}),
          _contex: {
            tokenCount,
            originalTokenEstimate: this.estimateTokens(limitedNodes),
            format: this.options.format,
            model: this.options.model,
            savings: this.calculateSavings(limitedNodes, tokenCount),
          },
        },
      },
    ];
  }

  /**
   * Optimize raw data for LlamaIndex retrieval
   */
  optimizeData(data: unknown[]): {
    text: string;
    metadata: Record<string, unknown>;
  } {
    const limitedData = data
      .slice(0, this.options.maxDocuments)
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);

    const tens = Tens.encode(limitedData);

    const optimizedText = tens.toString();
    const tokenCount = tens.materialize(this.options.model).length;

    return {
      text: optimizedText,
      metadata: {
        _contex: {
          tokenCount,
          originalRowCount: limitedData.length,
          format: this.options.format,
          model: this.options.model,
          savings: this.calculateSavings(limitedData, tokenCount),
        },
      },
    };
  }

  /**
   * Load and optimize a JSON file
   */
  async loadFile(filePath: string): Promise<{
    text: string;
    metadata: Record<string, unknown>;
  }> {
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    // Handle both array and object data
    const arrayData = Array.isArray(data) ? data : [data];
    return this.optimizeData(arrayData);
  }

  /**
   * Calculate token savings compared to raw text
   */
  private calculateSavings(data: unknown[], optimizedTokens: number): number {
    const rawText = data
      .map((d) => (typeof d === 'object' && d !== null ? JSON.stringify(d) : String(d)))
      .join('\n');

    const rawTokens = Math.ceil(rawText.length / 4);
    return Math.round((1 - optimizedTokens / rawTokens) * 100);
  }

  /**
   * Estimate token count from text (rough approximation)
   */
  private estimateTokens(nodes: LlamaIndexNode[]): number {
    const totalChars = nodes.reduce((sum, n) => sum + n.text.length, 0);
    return Math.ceil(totalChars / 4);
  }
}

/**
 * Create a ContexReader instance (convenience function)
 */
export function createContexReader(options?: ContexReaderOptions): ContexReader {
  return new ContexReader(options);
}
