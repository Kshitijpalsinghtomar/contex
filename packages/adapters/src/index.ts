// ============================================================================
// @contex-llm/adapters — LangChain & LlamaIndex Adapters
// ============================================================================
//
// adapters for popular RAG frameworks:
// - LangChain: Document loaders with Contex optimization
// - LlamaIndex: Data readers with Contex optimization
//
// These adapters automatically optimize documents for LLM context,
// reducing token usage by 40-90%.
// ============================================================================

export { ContexLoader } from './langchain.js';
export type { ContexLoaderOptions } from './langchain.js';

export { ContexReader } from './llamaindex.js';
export type { ContexReaderOptions } from './llamaindex.js';
