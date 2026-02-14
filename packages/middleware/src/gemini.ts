import { ContexContext, messageHasPlaceholder } from './core.js';
import type { ContexMiddlewareOptions } from './types.js';

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
  model: any,
  modelId: string,
  options: ContexMiddlewareOptions = {},
): any {
  const ctx = new ContexContext(options);

  // --- Wrap generateContent ---
  const originalGenerateContent = model.generateContent.bind(model);
  model.generateContent = async (request: any, ...rest: any[]) => {
    const processed = processGeminiRequest(request, ctx, modelId);
    return originalGenerateContent(processed, ...rest);
  };

  // --- Wrap generateContentStream ---
  if (model.generateContentStream) {
    const originalStream = model.generateContentStream.bind(model);
    model.generateContentStream = async (request: any, ...rest: any[]) => {
      const processed = processGeminiRequest(request, ctx, modelId);
      return originalStream(processed, ...rest);
    };
  }

  // --- Wrap startChat for multi-turn conversations ---
  if (model.startChat) {
    const originalStartChat = model.startChat.bind(model);
    model.startChat = (params?: any) => {
      const chat = originalStartChat(params);
      const originalSendMessage = chat.sendMessage.bind(chat);

      chat.sendMessage = async (content: any, ...rest: any[]) => {
        const processed = processGeminiContent(content, ctx, modelId);
        return originalSendMessage(processed, ...rest);
      };

      if (chat.sendMessageStream) {
        const originalSendStream = chat.sendMessageStream.bind(chat);
        chat.sendMessageStream = async (content: any, ...rest: any[]) => {
          const processed = processGeminiContent(content, ctx, modelId);
          return originalSendStream(processed, ...rest);
        };
      }

      return chat;
    };
  }

  (model as any).__contex_dispose = () => ctx.dispose();

  return model;
}

// ============================================================================
// Internal Helpers
// ============================================================================

function processGeminiRequest(request: any, ctx: ContexContext, modelId: string): any {
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
      if (item?.text?.includes('{{CONTEX:')) {
        hasPlaceholder = true;
        break;
      }
    }
    if (!hasPlaceholder) return request;

    return request.map((item: any) => {
      if (typeof item === 'string') {
        return ctx.replacePlaceholders(item, modelId);
      }
      if (item?.text?.includes('{{CONTEX:')) {
        return { ...item, text: ctx.replacePlaceholders(item.text, modelId) };
      }
      return item;
    });
  }

  // Structured GenerateContentRequest { contents: Content[] }
  if (request?.contents) {
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
      contents: request.contents.map((content: any) => processContentBlock(content, ctx, modelId)),
    };
  }

  return request;
}

function processGeminiContent(content: any, ctx: ContexContext, modelId: string): any {
  if (typeof content === 'string') {
    if (!ctx.hasPlaceholders(content)) return content;
    return ctx.replacePlaceholders(content, modelId);
  }

  if (Array.isArray(content)) {
    return content.map((part: any) => {
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

function contentHasPlaceholder(content: any): boolean {
  if (!content?.parts) return false;
  return content.parts.some(
    (part: any) => typeof part.text === 'string' && part.text.includes('{{CONTEX:'),
  );
}

function processContentBlock(content: any, ctx: ContexContext, modelId: string): any {
  if (!content?.parts) return content;
  return {
    ...content,
    parts: content.parts.map((part: any) => {
      if (typeof part.text === 'string' && part.text.includes('{{CONTEX:')) {
        return { ...part, text: ctx.replacePlaceholders(part.text, modelId) };
      }
      return part;
    }),
  };
}
