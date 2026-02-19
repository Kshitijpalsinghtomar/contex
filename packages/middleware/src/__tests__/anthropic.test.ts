import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Anthropic } from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContexAnthropic } from '../anthropic.js';

type AnthropicContentBlock = {
  type?: string;
  text?: string;
  [key: string]: unknown;
};

type AnthropicMessageInput = {
  role: string;
  content: string | AnthropicContentBlock[];
};

type AnthropicCreateBody = {
  model: string;
  system?: string;
  messages: AnthropicMessageInput[];
  max_tokens: number;
};

type MockAnthropicClient = {
  messages: {
    create: ReturnType<typeof vi.fn>;
  };
  _mockCreate: ReturnType<typeof vi.fn>;
};

function invokeCreate(client: Anthropic, body: AnthropicCreateBody): Promise<unknown> {
  const create = client.messages.create as unknown as (
    body: AnthropicCreateBody,
  ) => Promise<unknown>;
  return create(body);
}

// =============================================================================
// Mock Anthropic client
// =============================================================================
function createMockAnthropicClient() {
  const createFn = vi.fn().mockResolvedValue({
    id: 'mock-message',
    content: [{ type: 'text', text: 'ok' }],
  });
  const client: MockAnthropicClient = {
    messages: { create: createFn },
    _mockCreate: createFn,
  };
  return client;
}

const TEST_DATA = [
  { id: 1, title: 'Login bug', priority: 'high' },
  { id: 2, title: 'Signup crash', priority: 'critical' },
];

describe('@contex-llm/middleware v3 — Anthropic Integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contex-mw-anthropic-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes through calls with no placeholders', async () => {
    const mock = createMockAnthropicClient();
    const wrapped = createContexAnthropic(mock as unknown as Anthropic, {
      storeDir: tmpDir,
      data: { tickets: TEST_DATA },
    });

    await invokeCreate(wrapped, {
      model: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 1024,
    });

    expect(mock._mockCreate).toHaveBeenCalledTimes(1);
    expect(mock._mockCreate.mock.calls[0][0].messages[0].content).toBe('Hello');
  });

  it('replaces message placeholders with canonical JSON', async () => {
    const mock = createMockAnthropicClient();
    const wrapped = createContexAnthropic(mock as unknown as Anthropic, {
      storeDir: tmpDir,
      data: { tickets: TEST_DATA },
    });

    await invokeCreate(wrapped, {
      model: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'Analyze: {{CONTEX:tickets}}' }],
      max_tokens: 1024,
    });

    const content = mock._mockCreate.mock.calls[0][0].messages[0].content;
    expect(content).not.toContain('{{CONTEX:');
    expect(content).toContain('Login bug');
  });

  it('replaces placeholders in Anthropic system field', async () => {
    const mock = createMockAnthropicClient();
    const wrapped = createContexAnthropic(mock as unknown as Anthropic, {
      storeDir: tmpDir,
      data: { context: [{ policy: 'Be helpful', version: 1 }] },
    });

    await invokeCreate(wrapped, {
      model: 'claude-3-5-sonnet',
      system: 'System context: {{CONTEX:context}}',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 1024,
    });

    const body = mock._mockCreate.mock.calls[0][0];
    expect(body.system).not.toContain('{{CONTEX:');
    expect(body.system).toContain('Be helpful');
  });

  it('handles content blocks array format', async () => {
    const mock = createMockAnthropicClient();
    const wrapped = createContexAnthropic(mock as unknown as Anthropic, {
      storeDir: tmpDir,
      data: { tickets: TEST_DATA },
    });

    await invokeCreate(wrapped, {
      model: 'claude-3-5-sonnet',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Data: {{CONTEX:tickets}}' }],
        },
      ],
      max_tokens: 1024,
    });

    const content = mock._mockCreate.mock.calls[0][0].messages[0].content;
    expect(content[0].text).toContain('Login bug');
    expect(content[0].text).not.toContain('{{CONTEX:');
  });

  it('calls onInject with injection details', async () => {
    const onInject = vi.fn();
    const mock = createMockAnthropicClient();
    const wrapped = createContexAnthropic(mock as unknown as Anthropic, {
      storeDir: tmpDir,
      data: { tickets: TEST_DATA },
      onInject,
    });

    await invokeCreate(wrapped, {
      model: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: '{{CONTEX:tickets}}' }],
      max_tokens: 1024,
    });

    expect(onInject).toHaveBeenCalledTimes(1);
    expect(onInject.mock.calls[0][0].collection).toBe('tickets');
    expect(onInject.mock.calls[0][0].model).toBe('claude-3-5-sonnet');
    expect(onInject.mock.calls[0][0].encoding).toBe('cl100k_base');
  });
});
