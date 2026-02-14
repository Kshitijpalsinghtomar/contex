// ============================================================================
// @contex/core — Error Types
// ============================================================================

/**
 * Base error class for all contex errors.
 */
export class ContexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContexError';
  }
}

/**
 * Thrown when TENS encoding fails due to invalid input data.
 */
export class TensEncodeError extends ContexError {
  constructor(message: string) {
    super(message);
    this.name = 'TensEncodeError';
  }
}

/**
 * Thrown when TENS decoding fails due to corrupted or truncated binary.
 */
export class TensDecodeError extends ContexError {
  constructor(message: string) {
    super(message);
    this.name = 'TensDecodeError';
  }
}

/**
 * Thrown when PQL query parsing fails.
 */
export class PqlParseError extends ContexError {
  constructor(message: string) {
    super(message);
    this.name = 'PqlParseError';
  }
}

/**
 * Thrown when a requested collection does not exist.
 */
export class CollectionNotFoundError extends ContexError {
  constructor(collection: string) {
    super(`Collection "${collection}" not found.`);
    this.name = 'CollectionNotFoundError';
  }
}

/**
 * Thrown when budget constraints are impossible to satisfy.
 */
export class BudgetError extends ContexError {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetError';
  }
}
