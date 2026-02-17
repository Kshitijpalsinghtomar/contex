// ============================================================================
// @contex/core — Error Types
// ============================================================================

/**
 * Base error class for all Contex errors.
 */
export class ContexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContexError';
  }
}

// ---------------------------------------------------------------------------
// Encoding Errors
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Validation Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when input data fails validation.
 */
export class ContexValidationError extends ContexError {
  public readonly field?: string;
  public readonly reason?: string;
  public readonly value?: unknown;

  constructor(message: string, options?: { field?: string; reason?: string; value?: unknown }) {
    super(message);
    this.name = 'ContexValidationError';
    this.field = options?.field;
    this.reason = options?.reason;
    this.value = options?.value;
  }
}

// ---------------------------------------------------------------------------
// Model Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a requested model is not found or unsupported.
 */
export class ContexModelNotFoundError extends ContexError {
  public readonly model: string;
  public readonly availableModels: string[];

  constructor(model: string, availableModels: string[] = []) {
    super(
      `Model "${model}" not found. Available: ${availableModels.slice(0, 10).join(', ')}${availableModels.length > 10 ? '...' : ''}`,
    );
    this.name = 'ContexModelNotFoundError';
    this.model = model;
    this.availableModels = availableModels;
  }
}

/**
 * Thrown when tokenizer version mismatch is detected.
 */
export class ContexTokenizerVersionError extends ContexError {
  public readonly expected: string;
  public readonly actual: string;
  public readonly model: string;

  constructor(model: string, expected: string, actual: string) {
    super(
      `Tokenizer version mismatch for model "${model}": expected ${expected}, got ${actual}. Please re-materialize.`,
    );
    this.name = 'ContexTokenizerVersionError';
    this.model = model;
    this.expected = expected;
    this.actual = actual;
  }
}

// ---------------------------------------------------------------------------
// Storage Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when IR is not found in storage.
 */
export class ContexIRNotFoundError extends ContexError {
  public readonly hash: string;

  constructor(hash: string) {
    super(`IR not found for hash: ${hash}. Please re-encode the data.`);
    this.name = 'ContexIRNotFoundError';
    this.hash = hash;
  }
}

/**
 * Thrown when storage read/write fails.
 */
export class ContexStorageError extends ContexError {
  public readonly operation: 'read' | 'write' | 'delete';
  public readonly path?: string;

  constructor(operation: 'read' | 'write' | 'delete', message: string, path?: string) {
    super(`Storage ${operation} failed: ${message}`);
    this.name = 'ContexStorageError';
    this.operation = operation;
    this.path = path;
  }
}

// ---------------------------------------------------------------------------
// Query Errors
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Budget Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when budget constraints are impossible to satisfy.
 */
export class BudgetError extends ContexError {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetError';
  }
}

/**
 * Thrown when data exceeds context window limit.
 */
export class ContextWindowExceededError extends BudgetError {
  public readonly tokenCount: number;
  public readonly maxTokens: number;

  constructor(tokenCount: number, maxTokens: number) {
    super(
      `Token count ${tokenCount} exceeds context window limit of ${maxTokens}. Consider reducing data size.`,
    );
    this.name = 'ContextWindowExceededError';
    this.tokenCount = tokenCount;
    this.maxTokens = maxTokens;
  }
}

// ---------------------------------------------------------------------------
// Middleware Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when middleware placeholder processing fails.
 */
export class ContexInjectionError extends ContexError {
  public readonly placeholder?: string;

  constructor(message: string, placeholder?: string) {
    super(message);
    this.name = 'ContexInjectionError';
    this.placeholder = placeholder;
  }
}

/**
 * Thrown when streaming is not supported by the provider.
 */
export class ContexStreamingError extends ContexError {
  public readonly provider: string;

  constructor(provider: string, message: string) {
    super(`Streaming not supported for ${provider}: ${message}`);
    this.name = 'ContexStreamingError';
    this.provider = provider;
  }
}
