import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContexGemini } from '../gemini.js';

// =============================================================================
// Mock Gemini model
// =============================================================================
function createMockGeminiModel() {
  const generateContentFn = vi.fn().mockResolvedValue({
    response: { text: () => 'ok' },
  });
  const sendMessageFn = vi.fn().mockResolvedValue({
    response: { text: () => 'ok' },
  });

  return {
    generateContent: generateContentFn,
    generateContentStream: vi.fn().mockResolvedValue({ stream: [] }),
    startChat: vi.fn().mockReturnValue({
      sendMessage: sendMessageFn,
      sendMessageStream: vi.fn().mockResolvedValue({ stream: [] }),
    }),
    _mockGenerateContent: generateContentFn,
    _mockSendMessage: sendMessageFn,
  };
}

const TEST_DATA = [
  { id: 1, title: 'Login bug', priority: 'high' },
  { id: 2, title: 'Signup crash', priority: 'critical' },
];

describe('@contex/middleware v3 — Gemini Integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contex-mw-gemini-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes through string requests with no placeholders', async () => {
    const mock = createMockGeminiModel();
    const wrapped = createContexGemini(mock, 'gemini-2-5-pro', {
      storeDir: tmpDir,
      data: { tickets: TEST_DATA },
    });

    await wrapped.generateContent('Hello world');

    expect(mock._mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(mock._mockGenerateContent.mock.calls[0][0]).toBe('Hello world');
  });

  it('replaces placeholders in string requests', async () => {
    const mock = createMockGeminiModel();
    const wrapped = createContexGemini(mock, 'gemini-2-5-pro', {
      storeDir: tmpDir,
      data: { tickets: TEST_DATA },
    });

    await wrapped.generateContent('Analyze: {{CONTEX:tickets}}');

    const processed = mock._mockGenerateContent.mock.calls[0][0];
    expect(processed).not.toContain('{{CONTEX:');
    expect(processed).toContain('Login bug');
  });

  it('replaces placeholders in structured contents request', async () => {
    const mock = createMockGeminiModel();
    const wrapped = createContexGemini(mock, 'gemini-2-5-pro', {
      storeDir: tmpDir,
      data: { tickets: TEST_DATA },
    });

    await wrapped.generateContent({
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Data: {{CONTEX:tickets}}' }],
        },
      ],
    });

    const request = mock._mockGenerateContent.mock.calls[0][0];
    expect(request.contents[0].parts[0].text).toContain('Login bug');
    expect(request.contents[0].parts[0].text).not.toContain('{{CONTEX:');
  });

  it('replaces placeholders in array requests', async () => {
    const mock = createMockGeminiModel();
    const wrapped = createContexGemini(mock, 'gemini-2-5-pro', {
      storeDir: tmpDir,
      data: { tickets: TEST_DATA },
    });

    await wrapped.generateContent(['Intro text', '{{CONTEX:tickets}}']);

    const processed = mock._mockGenerateContent.mock.calls[0][0];
    expect(processed[0]).toBe('Intro text');
    expect(processed[1]).toContain('Login bug');
  });

  it('calls onInject with injection details', async () => {
    const onInject = vi.fn();
    const mock = createMockGeminiModel();
    const wrapped = createContexGemini(mock, 'gemini-2-5-pro', {
      storeDir: tmpDir,
      data: { tickets: TEST_DATA },
      onInject,
    });

    await wrapped.generateContent('{{CONTEX:tickets}}');

    expect(onInject).toHaveBeenCalledTimes(1);
    expect(onInject.mock.calls[0][0].collection).toBe('tickets');
    expect(onInject.mock.calls[0][0].model).toBe('gemini-2-5-pro');
  });

  it('wraps startChat/sendMessage', async () => {
    const sendMessageFn = vi.fn().mockResolvedValue({
      response: { text: () => 'ok' },
    });
    const mockModel = {
      generateContent: vi.fn().mockResolvedValue({ response: { text: () => 'ok' } }),
      startChat: () => ({
        sendMessage: sendMessageFn,
      }),
    };

    const wrapped = createContexGemini(mockModel, 'gemini-2-5-pro', {
      storeDir: tmpDir,
      data: { tickets: TEST_DATA },
    });

    if (!wrapped.startChat) {
      throw new Error('Expected wrapped.startChat to be defined');
    }
    const chat = wrapped.startChat();
    await chat.sendMessage('Check: {{CONTEX:tickets}}');

    // The sendMessage mock captures the processed (placeholder-replaced) content
    expect(sendMessageFn).toHaveBeenCalledTimes(1);
    const processed = sendMessageFn.mock.calls[0][0];
    expect(processed).toContain('Login bug');
    expect(processed).not.toContain('{{CONTEX:');
  });
});
