// ============================================================================
// @contex/adapters — LangChain Adapter
// ============================================================================
//
// ContexLoader: LangChain Document Loader with Contex optimization
// Automatically optimizes loaded documents for LLM context
// ============================================================================

import { Tens } from '@contex/core';
import type { OutputFormat } from '@contex/core';

/**
 * Options for ContexLoader
 */
export interface ContexLoaderOptions {
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
   * Include metadata in output
   * @default true
   */
  includeMetadata?: boolean;
}

/**
 * LangChain Document interface (compatible with LangChain v0.1+)
 */
interface LangChainDocument {
  pageContent: string;
  metadata?: Record<string, unknown>;
}

/**
 * ContexLoader: LangChain Document Loader with Contex optimization
 *
 * This loader automatically optimizes documents loaded from various sources
 * using Contex's token-efficient format, reducing context costs by 40-94%.
 *
 * @example
 * ```ts
 * import { ContexLoader } from '@contex/adapters/langchain';
 *
 * // Use with LangChain
 * const loader = new ContexLoader({
 *   format: 'markdown',
 *   model: 'gpt-4o'
 * });
 *
 * const docs = await loader.load('data.json');
 * // docs are now optimized with Contex!
 * ```
 */
export class ContexLoader {
  private options: Required<ContexLoaderOptions>;

  constructor(options: ContexLoaderOptions = {}) {
    this.options = {
      format: options.format ?? 'contex',
      model: options.model ?? 'gpt-4o',
      compressFields: options.compressFields ?? true,
      includeMetadata: options.includeMetadata ?? true,
    };
  }

  /**
   * Load and optimize documents from a JSON file
   */
  async load(filePath: string): Promise<LangChainDocument[]> {
    const data = await this.loadFile(filePath);
    return this.optimize(data);
  }

  /**
   * Load and optimize documents from raw data
   */
  optimize(data: unknown[]): LangChainDocument[] {
    const rows = data.filter(
      (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
    );
    const tens = Tens.encode(rows);

    const optimizedText = tens.toString();
    const tokenCount = tens.materialize(this.options.model).length;

    return [
      {
        pageContent: optimizedText,
        metadata: {
          _contex: {
            tokenCount,
            format: this.options.format,
            model: this.options.model,
            originalRowCount: tens.rowCount,
            savings: this.calculateSavings(rows, tokenCount),
          },
        },
      },
    ];
  }

  /**
   * Convert documents to Contex-optimized format
   *
   * @param documents - Array of documents with pageContent and metadata
   */
  optimizeDocuments(documents: LangChainDocument[]): LangChainDocument[] {
    // Extract text content from documents
    const data = documents.map((doc, idx) => ({
      _index: idx,
      _content: doc.pageContent,
      ...(this.options.includeMetadata ? { _metadata: doc.metadata } : {}),
    }));

    const tens = Tens.encode(data);

    const optimizedText = tens.toString();
    const tokenCount = tens.materialize(this.options.model).length;

    return [
      {
        pageContent: optimizedText,
        metadata: {
          _contex: {
            tokenCount,
            originalDocumentCount: documents.length,
            format: this.options.format,
            model: this.options.model,
            savings: this.calculateSavings(data, tokenCount),
          },
        },
      },
    ];
  }

  /**
   * Load a file and parse as JSON
   */
  private async loadFile(filePath: string): Promise<unknown[]> {
    // Dynamic import for Node.js APIs
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  }

  /**
   * Calculate token savings compared to raw JSON
   */
  private calculateSavings(data: unknown[], optimizedTokens: number): number {
    const jsonString = JSON.stringify(data);
    // Approximate: 1 token ≈ 4 characters
    const rawTokens = Math.ceil(jsonString.length / 4);
    return Math.round((1 - optimizedTokens / rawTokens) * 100);
  }
}

/**
 * Create a ContexLoader instance (convenience function)
 */
export function createContexLoader(options?: ContexLoaderOptions): ContexLoader {
  return new ContexLoader(options);
}
