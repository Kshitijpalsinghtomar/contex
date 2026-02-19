// ============================================================================
// PQL (Prompt Query Language) — Parser and executor
// ============================================================================
// Syntax: GET <collection> [WHERE <field> = <value>] [LIMIT <n>] [FORMAT <fmt>]

import type { OutputFormat } from '@contex-llm/core';

export interface PqlQuery {
  collection: string;
  where?: { field: string; op: string; value: string };
  limit?: number;
  format?: OutputFormat;
}

/**
 * Parse a PQL query string.
 */
export function parsePql(query: string): PqlQuery {
  const normalized = query.trim();
  const tokens = normalized.split(/\s+/);

  if (tokens[0]?.toUpperCase() !== 'GET') {
    throw new Error(`PQL syntax error: expected GET, got "${tokens[0]}"`);
  }

  const result: PqlQuery = { collection: tokens[1] };

  let i = 2;
  while (i < tokens.length) {
    const keyword = tokens[i].toUpperCase();

    if (keyword === 'WHERE' && i + 3 < tokens.length) {
      result.where = {
        field: tokens[i + 1],
        op: tokens[i + 2],
        value: tokens[i + 3],
      };
      i += 4;
    } else if (keyword === 'LIMIT' && i + 1 < tokens.length) {
      result.limit = Number.parseInt(tokens[i + 1], 10);
      i += 2;
    } else if (keyword === 'FORMAT' && i + 1 < tokens.length) {
      result.format = tokens[i + 1] as OutputFormat;
      i += 2;
    } else {
      i++;
    }
  }

  return result;
}

/**
 * Apply a WHERE filter to data.
 */
export function applyFilter(
  data: Record<string, unknown>[],
  where?: PqlQuery['where'],
): Record<string, unknown>[] {
  if (!where) return data;

  return data.filter((row) => {
    const fieldValue = String(row[where.field] ?? '');
    const compareValue = where.value;

    switch (where.op) {
      case '=':
      case '==':
        return fieldValue === compareValue;
      case '!=':
        return fieldValue !== compareValue;
      case '>':
        return Number(fieldValue) > Number(compareValue);
      case '<':
        return Number(fieldValue) < Number(compareValue);
      case '>=':
        return Number(fieldValue) >= Number(compareValue);
      case '<=':
        return Number(fieldValue) <= Number(compareValue);
      default:
        return fieldValue === compareValue;
    }
  });
}

/**
 * Apply a LIMIT to data.
 */
export function applyLimit(
  data: Record<string, unknown>[],
  limit?: number,
): Record<string, unknown>[] {
  if (!limit || limit <= 0) return data;
  return data.slice(0, limit);
}
