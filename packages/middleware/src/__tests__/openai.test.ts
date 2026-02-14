import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContexOpenAI } from '../openai.js';

// =============================================================================
// Mock OpenAI client
// =============================================================================
function createMockOpenAIClient() {
  const createFn = vi.fn().mockResolvedValue({
    id: 'mock-completion',
    choices: [{ message: { content: 'ok' } }],
  });
  return {
    chat: { completions: { create: createFn } },
    _mockCreate: createFn,
  };
}

const TEST_DATA = [
  { id: 1, title: 'Login bug', priority: 'high' },
  { id: 2, title: 'Signup crash', priority: 'critical' },
  { id: 3, title: 'Dashboard slow', priority: 'low' },
];

// =============================================================================
// Tests
// =============================================================================
describe('@contex/middleware v3 — OpenAI Integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contex-mw-openai-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes through calls with no placeholders', async () => {
    const mock = createMockOpenAIClient();
    const wrapped = createContexOpenAI(mock as any, {
      storeDir: tmpDir,
      data: { tickets: TEST_DATA },
    });

    await wrapped.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello world' }],
    } as any);

    expect(mock._mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mock._mockCreate.mock.calls[0][0];
    expect(callArgs.messages[0].content).toBe('Hello world');
  });

  it('replaces {{CONTEX:collection}} with canonical IR-backed JSON', async () => {
    const mock = createMockOpenAIClient();
    const wrapped = createContexOpenAI(mock as any, {
      storeDir: tmpDir,
      data: { tickets: TEST_DATA },
    });

    await wrapped.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Analyze these tickets: {{CONTEX:tickets}}' }],
    } as any);

    expect(mock._mockCreate).toHaveBeenCalledTimes(1);
    const content = mock._mockCreate.mock.calls[0][0].messages[0].content;
    expect(content).not.toContain('{{CONTEX:');
    // Canonical JSON must contain the data (sorted keys)
    expect(content).toContain('Login bug');
    expect(content).toContain('Signup crash');
  });

  it('injected text is deterministic (same data → same text)', async () => {
    const mock1 = createMockOpenAIClient();
    const wrapped1 = createContexOpenAI(mock1 as any, {
      storeDir: path.join(tmpDir, 'a'),
      data: { tickets: TEST_DATA },
    });

    await wrapped1.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: '{{CONTEX:tickets}}' }],
    } as any);

    const mock2 = createMockOpenAIClient();
    const wrapped2 = createContexOpenAI(mock2 as any, {
      storeDir: path.join(tmpDir, 'b'),
      data: { tickets: [...TEST_DATA] }, // same data, different reference
    });

    await wrapped2.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: '{{CONTEX:tickets}}' }],
    } as any);

    const text1 = mock1._mockCreate.mock.calls[0][0].messages[0].content;
    const text2 = mock2._mockCreate.mock.calls[0][0].messages[0].content;
    expect(text1).toBe(text2); // Deterministic!
  });

  it('handles content array format (multimodal messages)', async () => {
    const mock = createMockOpenAIClient();
    const wrapped = createContexOpenAI(mock as any, {
      storeDir: tmpDir,
      data: { tickets: TEST_DATA },
    });

    await wrapped.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Look at this: {{CONTEX:tickets}}' },
            { type: 'image_url', image_url: { url: 'http://example.com/img.png' } },
          ],
        },
      ],
    } as any);

    const content = mock._mockCreate.mock.calls[0][0].messages[0].content;
    expect(content[0].text).toContain('Login bug');
    expect(content[0].text).not.toContain('{{CONTEX:');
    expect(content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'http://example.com/img.png' },
    });
  });

  it('calls onInject callback with injection details', async () => {
    const onInject = vi.fn();
    const mock = createMockOpenAIClient();
    const wrapped = createContexOpenAI(mock as any, {
      storeDir: tmpDir,
      data: { tickets: TEST_DATA },
      onInject,
    });

    await wrapped.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: '{{CONTEX:tickets}}' }],
    } as any);

    expect(onInject).toHaveBeenCalledTimes(1);
    const info = onInject.mock.calls[0][0];
    expect(info.collection).toBe('tickets');
    expect(info.model).toBe('gpt-4o');
    expect(info.encoding).toBe('o200k_base');
    expect(typeof info.irHash).toBe('string');
    expect(info.tokenCount).toBeGreaterThan(0);
    expect(typeof info.cacheHit).toBe('boolean');
  });

  it('calls onError when collection not found', async () => {
    const onError = vi.fn();
    const mock = createMockOpenAIClient();
    const wrapped = createContexOpenAI(mock as any, {
      storeDir: tmpDir,
      onError,
    });

    await wrapped.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: '{{CONTEX:nonexistent}}' }],
    } as any);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][1]).toBe('nonexistent');
  });

  it('leaves placeholder intact on error when no onError handler', async () => {
    const mock = createMockOpenAIClient();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const wrapped = createContexOpenAI(mock as any, { storeDir: tmpDir });

    await wrapped.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Data: {{CONTEX:missing}}' }],
    } as any);

    const content = mock._mockCreate.mock.calls[0][0].messages[0].content;
    expect(content).toContain('{{CONTEX:missing}}');

    warnSpy.mockRestore();
  });

  it('preserves non-placeholder messages unchanged', async () => {
    const mock = createMockOpenAIClient();
    const wrapped = createContexOpenAI(mock as any, {
      storeDir: tmpDir,
      data: { tickets: TEST_DATA },
    });

    await wrapped.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: '{{CONTEX:tickets}}' },
      ],
    } as any);

    const messages = mock._mockCreate.mock.calls[0][0].messages;
    expect(messages[0].content).toBe('You are a helpful assistant.');
    expect(messages[1].content).not.toContain('{{CONTEX:');
  });

  it('handles multiple collections in one message', async () => {
    const mock = createMockOpenAIClient();
    const wrapped = createContexOpenAI(mock as any, {
      storeDir: tmpDir,
      data: {
        tickets: TEST_DATA,
        users: [{ name: 'Alice', role: 'admin' }],
      },
    });

    await wrapped.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Tickets: {{CONTEX:tickets}} Users: {{CONTEX:users}}' }],
    } as any);

    const content = mock._mockCreate.mock.calls[0][0].messages[0].content;
    expect(content).not.toContain('{{CONTEX:');
    expect(content).toContain('Login bug');
    expect(content).toContain('Alice');
  });
});
