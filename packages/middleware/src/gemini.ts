import { ContexContext } from './core.js';
import type { ContexMiddlewareOptions } from './types.js';

type GeminiTextPart = {
  text?: string;
  [key: string]: unknown;
};

type GeminiContentBlock = {
  parts?: GeminiTextPart[];
  [key: string]: unknown;
};

type GeminiRequestWithContents = {
  contents: GeminiContentBlock[];
  [key: string]: unknown;
};

type GeminiRequest = string | Array<string | GeminiTextPart> | GeminiRequestWithContents;
type GeminiMessageContent = string | Array<string | GeminiTextPart>;

type GeminiChat = {
  sendMessage: (content: GeminiMessageContent, ...rest: unknown[]) => unknown;
  sendMessageStream?: (content: GeminiMessageContent, ...rest: unknown[]) => unknown;
  [key: string]: unknown;
};

type GeminiModel = {
  generateContent: (request: GeminiRequest, ...rest: unknown[]) => unknown;
  generateContentStream?: (request: GeminiRequest, ...rest: unknown[]) => unknown;
  startChat?: (params?: unknown) => GeminiChat;
  [key: string]: unknown;
};

type DisposableGeminiModel = GeminiModel & {
  __contex_dispose?: () => void;
};

// ============================================================================
// @contex/middleware v3 — Google Gemini Integration
// ============================================================================
// Intercepts Gemini API calls to inject canonical IR-backed context.
// Handles Gemini's unique `parts`-based content format.
// Wraps: generateContent, generateContentStream, startChat/sendMessage
// ============================================================================

/**
 * Wraps a Google Generative AI model instance to automatically replace
 * `{{CONTEX:collection}}` placeholders with canonical IR-backed data.
 *
 * @param model - GoogleGenerativeAI GenerativeModel instance
 * @param modelId - Model identifier for materialization (e.g. 'gemini-2-5-pro')
 * @param options - Middleware configuration
 *
 * @example
 * ```ts
 * import { GoogleGenerativeAI } from '@google/generative-ai';
 * import { createContexGemini } from '@contex/middleware';
 *
 * const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
 * const model = createContexGemini(
 *   genAI.getGenerativeModel({ model: 'gemini-2.5-pro' }),
 *   'gemini-2-5-pro',
 *   { data: { tickets: myTickets } },
 * );
 *
 * const result = await model.generateContent(
 *   'Analyze these tickets: {{CONTEX:tickets}}'
 * );
 * ```
 */
export function createContexGemini(
  model: GeminiModel,
  modelId: string,
  options: ContexMiddlewareOptions = {},
): GeminiModel {
  const ctx = new ContexContext(options);

  // --- Wrap generateContent ---
  const originalGenerateContent = model.generateContent.bind(model);
  model.generateContent = async (request: GeminiRequest, ...rest: unknown[]) => {
    const processed = processGeminiRequest(request, ctx, modelId);
    return originalGenerateContent(processed, ...rest);
  };

  // --- Wrap generateContentStream ---
  if (model.generateContentStream) {
    const originalStream = model.generateContentStream.bind(model);
    model.generateContentStream = async (request: GeminiRequest, ...rest: unknown[]) => {
      const processed = processGeminiRequest(request, ctx, modelId);
      return originalStream(processed, ...rest);
    };
  }

  // --- Wrap startChat for multi-turn conversations ---
  if (model.startChat) {
    const originalStartChat = model.startChat.bind(model);
    model.startChat = (params?: unknown) => {
      const chat = originalStartChat(params);
      const originalSendMessage = chat.sendMessage.bind(chat);

      chat.sendMessage = async (content: GeminiMessageContent, ...rest: unknown[]) => {
        const processed = processGeminiContent(content, ctx, modelId);
        return originalSendMessage(processed, ...rest);
      };

      if (chat.sendMessageStream) {
        const originalSendStream = chat.sendMessageStream.bind(chat);
        chat.sendMessageStream = async (content: GeminiMessageContent, ...rest: unknown[]) => {
          const processed = processGeminiContent(content, ctx, modelId);
          return originalSendStream(processed, ...rest);
        };
      }

      return chat;
    };
  }

  (model as DisposableGeminiModel).__contex_dispose = () => ctx.dispose();

  return model;
}

// ============================================================================
// Internal Helpers
// ============================================================================

function processGeminiRequest(
  request: GeminiRequest,
  ctx: ContexContext,
  modelId: string,
): GeminiRequest {
  // Simple string request
  if (typeof request === 'string') {
    if (!ctx.hasPlaceholders(request)) return request;
    return ctx.replacePlaceholders(request, modelId);
  }

  // Array of strings/parts
  if (Array.isArray(request)) {
    let hasPlaceholder = false;
    for (const item of request) {
      if (typeof item === 'string' && item.includes('{{CONTEX:')) {
        hasPlaceholder = true;
        break;
      }
      if (
        typeof item !== 'string' &&
        typeof item.text === 'string' &&
        item.text.includes('{{CONTEX:')
      ) {
        hasPlaceholder = true;
        break;
      }
    }
    if (!hasPlaceholder) return request;

    return request.map((item) => {
      if (typeof item === 'string') {
        return ctx.replacePlaceholders(item, modelId);
      }
      if (typeof item.text === 'string' && item.text.includes('{{CONTEX:')) {
        return { ...item, text: ctx.replacePlaceholders(item.text, modelId) };
      }
      return item;
    });
  }

  // Structured GenerateContentRequest { contents: Content[] }
  if (hasContentsRequest(request)) {
    let hasPlaceholder = false;
    for (const content of request.contents) {
      if (contentHasPlaceholder(content)) {
        hasPlaceholder = true;
        break;
      }
    }
    if (!hasPlaceholder) return request;

    return {
      ...request,
      contents: request.contents.map((content) => processContentBlock(content, ctx, modelId)),
    };
  }

  return request;
}

function processGeminiContent(
  content: GeminiMessageContent,
  ctx: ContexContext,
  modelId: string,
): GeminiMessageContent {
  if (typeof content === 'string') {
    if (!ctx.hasPlaceholders(content)) return content;
    return ctx.replacePlaceholders(content, modelId);
  }

  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') {
        return part.includes('{{CONTEX:') ? ctx.replacePlaceholders(part, modelId) : part;
      }
      if (part?.text?.includes('{{CONTEX:')) {
        return { ...part, text: ctx.replacePlaceholders(part.text, modelId) };
      }
      return part;
    });
  }

  return content;
}

function contentHasPlaceholder(content: GeminiContentBlock): boolean {
  if (!content?.parts) return false;
  return content.parts.some(
    (part: GeminiTextPart) => typeof part.text === 'string' && part.text.includes('{{CONTEX:'),
  );
}

function processContentBlock(
  content: GeminiContentBlock,
  ctx: ContexContext,
  modelId: string,
): GeminiContentBlock {
  if (!content?.parts) return content;
  return {
    ...content,
    parts: content.parts.map((part) => {
      if (typeof part.text === 'string' && part.text.includes('{{CONTEX:')) {
        return { ...part, text: ctx.replacePlaceholders(part.text, modelId) };
      }
      return part;
    }),
  };
}

function hasContentsRequest(request: GeminiRequest): request is GeminiRequestWithContents {
  if (typeof request !== 'object' || request === null || Array.isArray(request)) {
    return false;
  }

  const maybeRequest = request as { contents?: unknown };
  return Array.isArray(maybeRequest.contents);
}
