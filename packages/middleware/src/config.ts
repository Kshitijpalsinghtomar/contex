/**
 * Contex Middleware Configuration
 */

const SUPPORTS_TOKENS: Record<string, boolean> = {
  // Currently no providers publicly support raw token injection via standard SDKs
  // independent of text. We default all to false.
  // This table can be updated as providers add support.
  // Example (Future):
  // 'anthropic:claude-4-token-optimized': true,
};

/**
 * Check if a provider/model supports direct token injection.
 *
 * @param modelId - The model identifier (e.g. 'gpt-4o', 'claude-3-5-sonnet')
 * @returns true if tokens can be injected directly, false otherwise.
 */
export function providerSupportsTokens(modelId: string): boolean {
  // Allow override via environment variable for testing/pilots
  if (typeof process !== 'undefined' && process.env.CONTEXT_ENABLE_TOKEN_INJECT === 'true') {
    return true;
  }

  return SUPPORTS_TOKENS[modelId] || false;
}
