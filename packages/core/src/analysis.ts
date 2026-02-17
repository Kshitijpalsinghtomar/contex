// ============================================================================
// @contex/core — Dataset Structure Analysis
// ============================================================================
//
// Analyzes dataset structure to enable smart strategy selection.
// This helps choose the optimal output format (Contex/CSV/TOON/Markdown)
// based on dataset characteristics rather than just token count.
// ============================================================================

import type { OutputFormat } from './types.js';

/**
 * Structure analysis result for a dataset.
 * Provides metrics about the data's shape and characteristics
 * to help choose the optimal output format.
 */
export interface StructureAnalysis {
  /** Total number of rows */
  rowCount: number;
  /** Number of unique field names across all rows */
  uniqueFieldCount: number;
  /** Percentage of rows that share the most common field set */
  fieldConsistencyPct: number;
  /** Maximum nesting depth in the data */
  maxNestingDepth: number;
  /** Average number of fields per row */
  avgFieldsPerRow: number;
  /** Percentage of fields that are optional (missing in some rows) */
  optionalFieldPct: number;
  /** Ratio of unique values to total values (lower = more repetition) */
  valueRepetitionRatio: number;
  /** Estimated benefit score for Contex (0-100) */
  contextoBenefitScore: number;
  /** Recommended strategy for this data */
  recommendedStrategy: OutputFormat;
  /** Explanation for why the strategy was recommended */
  recommendationReason: string;
}

/**
 * Analyze dataset structure to help select the optimal format.
 *
 * @param data - Array of objects to analyze
 * @returns Structure analysis with metrics and recommendations
 *
 * @example
 * ```ts
 * const analysis = analyzeStructure(data);
 * console.log(analysis.recommendedStrategy); // 'contex', 'csv', 'toon', or 'markdown'
 * console.log(analysis.contextoBenefitScore); // 0-100 score
 * ```
 */
export function analyzeStructure(data: unknown[]): StructureAnalysis {
  const rowCount = data.length;

  if (rowCount === 0) {
    return {
      rowCount: 0,
      uniqueFieldCount: 0,
      fieldConsistencyPct: 0,
      maxNestingDepth: 0,
      avgFieldsPerRow: 0,
      optionalFieldPct: 0,
      valueRepetitionRatio: 1,
      contextoBenefitScore: 0,
      recommendedStrategy: 'json',
      recommendationReason: 'Empty dataset',
    };
  }

  // Collect all field names and their occurrence counts
  const fieldOccurrences = new Map<string, number>();
  const fieldPresenceByRow: boolean[][] = [];
  let maxDepth = 0;
  let totalFields = 0;
  const allFieldValues = new Map<string, Set<unknown>>();

  for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
    const row = data[rowIndex];
    if (typeof row !== 'object' || row === null) continue;

    const record = row as Record<string, unknown>;
    const rowFields: boolean[] = [];

    analyzeObject(record, '', 0, {
      fieldOccurrences,
      fieldPresenceByRow,
      rowIndex,
      rowFields,
      maxDepth,
      allFieldValues,
    });

    fieldPresenceByRow.push(rowFields);
    totalFields += rowFields.filter(Boolean).length;

    if (rowFields.length > maxDepth) {
      maxDepth = rowFields.length;
    }
  }

  // Calculate metrics
  const uniqueFieldCount = fieldOccurrences.size;
  const avgFieldsPerRow = totalFields / rowCount;

  // Field consistency: what percentage of rows share the most common field set?
  // We calculate this by looking at how many fields appear in most rows
  let fieldsInAllRows = 0;
  let fieldsInMostRows = 0; // 80%+ of rows
  const requiredThreshold = rowCount * 0.8;

  for (const count of fieldOccurrences.values()) {
    if (count === rowCount) {
      fieldsInAllRows++;
    }
    if (count >= requiredThreshold) {
      fieldsInMostRows++;
    }
  }

  const fieldConsistencyPct = uniqueFieldCount > 0
    ? (fieldsInAllRows / uniqueFieldCount) * 100
    : 0;

  // Optional fields: fields that don't appear in all rows
  const optionalFieldPct = uniqueFieldCount > 0
    ? ((uniqueFieldCount - fieldsInAllRows) / uniqueFieldCount) * 100
    : 0;

  // Value repetition: how often do values repeat?
  let totalUniqueValues = 0;
  let totalFieldValues = 0;
  for (const valueSet of allFieldValues.values()) {
    totalUniqueValues += valueSet.size;
    totalFieldValues += valueSet.size * rowCount; // Approximate
  }
  const valueRepetitionRatio = totalFieldValues > 0
    ? totalUniqueValues / totalFieldValues
    : 1;

  // Calculate Contex benefit score (0-100)
  // Higher score = Contex will likely provide better compression
  const contextoBenefitScore = calculateContexBenefitScore({
    rowCount,
    uniqueFieldCount,
    fieldConsistencyPct,
    maxNestingDepth: maxDepth,
    optionalFieldPct,
    valueRepetitionRatio,
  });

  // Determine recommended strategy
  const { strategy, reason } = selectStrategy({
    rowCount,
    uniqueFieldCount,
    fieldConsistencyPct,
    maxNestingDepth: maxDepth,
    optionalFieldPct,
    valueRepetitionRatio,
    contextoBenefitScore,
  });

  return {
    rowCount,
    uniqueFieldCount,
    fieldConsistencyPct,
    maxNestingDepth: maxDepth,
    avgFieldsPerRow,
    optionalFieldPct,
    valueRepetitionRatio,
    contextoBenefitScore,
    recommendedStrategy: strategy,
    recommendationReason: reason,
  };
}

/**
 * Internal analysis state passed through recursion
 */
interface AnalysisState {
  fieldOccurrences: Map<string, number>;
  fieldPresenceByRow: boolean[][];
  rowIndex: number;
  rowFields: boolean[];
  maxDepth: number;
  allFieldValues: Map<string, Set<unknown>>;
}

/**
 * Recursively analyze an object, tracking all fields and their values
 */
function analyzeObject(
  obj: Record<string, unknown>,
  prefix: string,
  depth: number,
  state: AnalysisState,
): void {
  if (depth > state.maxDepth) {
    state.maxDepth = depth;
  }

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    // Track field occurrence
    const count = state.fieldOccurrences.get(fullKey) ?? 0;
    state.fieldOccurrences.set(fullKey, count + 1);

    // Track field presence for this row
    state.rowFields.push(true);

    // Track value diversity for repetition analysis
    if (value !== null && value !== undefined) {
      let valueSet = state.allFieldValues.get(fullKey);
      if (!valueSet) {
        valueSet = new Set();
        state.allFieldValues.set(fullKey, valueSet);
      }
      valueSet.add(value);
    }

    // Recurse into nested objects
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      analyzeObject(value as Record<string, unknown>, fullKey, depth + 1, state);
    }
  }
}

/**
 * Calculate a score indicating how much Contex would benefit this dataset
 */
function calculateContexBenefitScore(params: {
  rowCount: number;
  uniqueFieldCount: number;
  fieldConsistencyPct: number;
  maxNestingDepth: number;
  optionalFieldPct: number;
  valueRepetitionRatio: number;
}): number {
  let score = 0;

  // High field consistency = Contex benefits more (dictionary encoding)
  score += Math.min(30, params.fieldConsistencyPct * 0.3);

  // Low value repetition ratio = more repeated values = Contex benefits
  if (params.valueRepetitionRatio < 0.5) {
    score += 25;
  } else if (params.valueRepetitionRatio < 0.7) {
    score += 15;
  } else if (params.valueRepetitionRatio < 0.9) {
    score += 5;
  }

  // More rows = more benefit from compression
  if (params.rowCount > 1000) {
    score += 20;
  } else if (params.rowCount > 100) {
    score += 15;
  } else if (params.rowCount > 10) {
    score += 5;
  }

  // Low optional field percentage = more consistent structure = Contex benefits
  if (params.optionalFieldPct < 10) {
    score += 15;
  } else if (params.optionalFieldPct < 30) {
    score += 10;
  }

  // Moderate nesting is okay, but very deep nesting might hurt
  if (params.maxNestingDepth <= 2) {
    score += 10;
  } else if (params.maxNestingDepth <= 4) {
    score += 5;
  }

  return Math.min(100, Math.round(score));
}

/**
 * Select the optimal strategy based on structure analysis
 */
function selectStrategy(params: {
  rowCount: number;
  uniqueFieldCount: number;
  fieldConsistencyPct: number;
  maxNestingDepth: number;
  optionalFieldPct: number;
  valueRepetitionRatio: number;
  contextoBenefitScore: number;
}): { strategy: OutputFormat; reason: string } {
  const { contextoBenefitScore, fieldConsistencyPct, valueRepetitionRatio, maxNestingDepth, rowCount } = params;

  // High Contex benefit score and consistent structure = Contex is best
  if (contextoBenefitScore >= 60 && fieldConsistencyPct >= 80) {
    return {
      strategy: 'tens',
      reason: `High structure consistency (${fieldConsistencyPct.toFixed(1)}%) and value repetition (${((1 - valueRepetitionRatio) * 100).toFixed(0)}%) favor Contex dictionary encoding`,
    };
  }

  // Very high value repetition but low consistency = Contex still wins
  if (contextoBenefitScore >= 50 && valueRepetitionRatio < 0.5) {
    return {
      strategy: 'tens',
      reason: `High value repetition (${((1 - valueRepetitionRatio) * 100).toFixed(0)}%) makes Contex dictionary encoding effective`,
    };
  }

  // Deep nesting hurts Contex - markdown might be better for readability
  if (maxNestingDepth > 4) {
    return {
      strategy: 'markdown',
      reason: `Deep nesting (depth ${maxNestingDepth}) - markdown preserves structure better`,
    };
  }

  // Very low consistency with many optional fields - CSV or markdown might be more stable
  if (fieldConsistencyPct < 50) {
    // For low consistency data, check if it's still worth using Contex
    if (contextoBenefitScore >= 40) {
      return {
        strategy: 'tens',
        reason: `Despite low consistency (${fieldConsistencyPct.toFixed(1)}%), high value repetition provides benefit`,
      };
    }
    return {
      strategy: 'csv',
      reason: `Low field consistency (${fieldConsistencyPct.toFixed(1)}%) - CSV provides stable tabular format`,
    };
  }

  // Low row count - overhead might not be worth it
  if (rowCount < 5) {
    return {
      strategy: 'json',
      reason: `Very few rows (${rowCount}) - minimal compression benefit`,
    };
  }

  // Default: Contex if there's any benefit
  if (contextoBenefitScore >= 25) {
    return {
      strategy: 'tens',
      reason: `Moderate Contex benefit score (${contextoBenefitScore}) - worth using for compression`,
    };
  }

  // Fall back to CSV for simple tabular data
  return {
    strategy: 'csv',
    reason: `Low Contex benefit score (${contextoBenefitScore}) - CSV is more efficient for this data`,
  };
}

/**
 * Strategy selection result with token counts for comparison
 */
export interface StrategyRecommendation {
  /** Strategy name */
  strategy: OutputFormat;
  /** Estimated/exact token count */
  tokenCount: number;
  /** Reason for selection */
  reason: string;
  /** Structure analysis used */
  structure: StructureAnalysis;
}

/**
 * Select the optimal strategy considering both structure AND token counts.
 * This is the recommended function for CLI usage.
 *
 * @param data - Dataset to analyze
 * @param tokenCounts - Map of strategy name to token count
 * @returns Best strategy considering both structure and actual token counts
 */
export function selectOptimalStrategy(
  data: unknown[],
  tokenCounts: Map<string, number>,
): StrategyRecommendation {
  const structure = analyzeStructure(data);

  // Get token counts for comparison
  const tensTokens = tokenCounts.get('tens') ?? tokenCounts.get('contex') ?? Infinity;
  const csvTokens = tokenCounts.get('csv') ?? Infinity;
  const toonTokens = tokenCounts.get('toon') ?? Infinity;
  const markdownTokens = tokenCounts.get('markdown') ?? Infinity;

  // If structure strongly recommends a strategy AND it's competitive (<20% more tokens), use it
  const structureRecommended = structure.recommendedStrategy;
  const recommendedTokens = tokenCounts.get(structureRecommended) ?? Infinity;

  // Check if structure-recommended strategy is within 20% of the best token count
  const minTokens = Math.min(tensTokens, csvTokens, toonTokens, markdownTokens);
  const threshold = minTokens * 1.2;

  if (recommendedTokens <= threshold && structure.contextoBenefitScore >= 40) {
    return {
      strategy: structureRecommended,
      tokenCount: recommendedTokens,
      reason: structure.recommendationReason,
      structure,
    };
  }

  // Otherwise, fall back to best token count
  const bestStrategy = findBestTokenStrategy(tokenCounts);
  const bestTokens = tokenCounts.get(bestStrategy) ?? Infinity;

  let fallbackReason = '';
  if (bestStrategy === 'tens' || bestStrategy === 'contex') {
    fallbackReason = `Best token count (${bestTokens.toLocaleString()} tokens)`;
  } else {
    fallbackReason = `Outperforms Contex by ${((1 - bestTokens / tensTokens) * 100).toFixed(1)}% on token count`;
  }

  return {
    strategy: bestStrategy as OutputFormat,
    tokenCount: bestTokens,
    reason: fallbackReason,
    structure,
  };
}

/**
 * Find the strategy with the lowest token count
 */
function findBestTokenStrategy(tokenCounts: Map<string, number>): string {
  let best = 'json';
  let bestTokens = Infinity;

  for (const [strategy, tokens] of tokenCounts.entries()) {
    if (tokens < bestTokens) {
      bestTokens = tokens;
      best = strategy;
    }
  }

  return best;
}
