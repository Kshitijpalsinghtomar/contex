// ---- Engine ----
export { Contex, Contex as contex } from './engine.js';
export type { QueryResult, ContextWindowOptions } from './engine.js';

// ---- Budget ----
export { calculateBudget, MODEL_REGISTRY } from './budget.js';
export type { BudgetRequest, BudgetResult, FormatBudget, ModelSpec } from './budget.js';

// ---- Prefix Cache ----
export { formatPrefixAware, analyzePrefixReuse } from './prefix.js';
export type { PrefixAwareOptions, PrefixAnalysis } from './prefix.js';

// ---- Storage ----
export { ContextStorage } from './storage.js';

// ---- Query ----
export { parsePql, applyFilter, applyLimit } from './query.js';

// ---- Selection ----
export { selectBestFormat } from './selector.js';
export type { SelectionOptions, SelectionResult } from './selector.js';

// ---- Session Dedup ----
export { StructuralDedupCache } from './session_dedup.js';
export type { SchemaFingerprint, DictEntry, DedupStats, SessionState } from './session_dedup.js';

// ---- Predictive Packer ----
export { packContext } from './packer.js';
export type { ContextItem, PackerConfig, PackResult, RejectedItem } from './packer.js';

// ---- Quick API (Zero-Config) ----
export { quick, analyzeSavings } from './quick.js';
export type { QuickOptions, QuickResult, QuickSavings } from './quick.js';
