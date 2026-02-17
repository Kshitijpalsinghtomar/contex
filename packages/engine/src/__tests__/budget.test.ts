import { TokenizerManager } from '@contex/core';
import { describe, expect, it } from 'vitest';
import { MODEL_REGISTRY, calculateBudget } from '../budget.js';

describe('calculateBudget', () => {
  const tokenizer = new TokenizerManager('o200k_base');

  const sampleData = Array.from({ length: 100 }, (_, i) => ({
    id: i + 1,
    name: `User ${i + 1}`,
    email: `user${i + 1}@example.com`,
    role: i % 3 === 0 ? 'admin' : 'user',
    score: Math.floor(Math.random() * 100),
  }));

  it('returns a budget result with required fields', () => {
    const budget = calculateBudget(
      sampleData,
      {
        model: 'gpt-4o',
        systemPromptTokens: 500,
        responseReserve: 1000,
        formats: ['json', 'csv', 'toon'],
      },
      tokenizer,
    );

    expect(budget).toBeDefined();
    expect(budget.maxRows).toBeGreaterThan(0);
    expect(budget.maxRows).toBeLessThanOrEqual(sampleData.length);
    expect(budget.recommendedFormat).toBeDefined();
    expect(budget.availableTokens).toBeGreaterThan(0);
  });

  it('respects system prompt + reserve token deductions', () => {
    const budgetSmall = calculateBudget(
      sampleData,
      {
        model: 'gpt-4o',
        systemPromptTokens: 100,
        responseReserve: 100,
        formats: ['csv'],
      },
      tokenizer,
    );

    const budgetLarge = calculateBudget(
      sampleData,
      {
        model: 'gpt-4o',
        systemPromptTokens: 50000,
        responseReserve: 50000,
        formats: ['csv'],
      },
      tokenizer,
    );

    // With more reserved tokens, fewer rows should fit
    expect(budgetLarge.maxRows).toBeLessThanOrEqual(budgetSmall.maxRows);
  });

  it('maxRows does not exceed data length', () => {
    const smallData = [{ id: 1 }, { id: 2 }];
    const budget = calculateBudget(
      smallData,
      {
        model: 'gpt-4o',
        formats: ['csv'],
      },
      tokenizer,
    );

    expect(budget.maxRows).toBeLessThanOrEqual(smallData.length);
  });

  it('handles empty data', () => {
    const budget = calculateBudget(
      [],
      {
        model: 'gpt-4o',
        formats: ['csv'],
      },
      tokenizer,
    );

    expect(budget.maxRows).toBe(0);
  });
});

describe('MODEL_REGISTRY', () => {
  it('contains GPT-4o entry', () => {
    expect(MODEL_REGISTRY['gpt-4o']).toBeDefined();
    expect(MODEL_REGISTRY['gpt-4o'].contextWindow).toBeGreaterThan(0);
    expect(MODEL_REGISTRY['gpt-4o'].provider).toBe('openai');
  });

  it('contains GPT-4o Mini entry', () => {
    expect(MODEL_REGISTRY['gpt-4o-mini']).toBeDefined();
  });

  it('contains GPT-5 with correct specs', () => {
    expect(MODEL_REGISTRY['gpt-5']).toBeDefined();
    expect(MODEL_REGISTRY['gpt-5'].contextWindow).toBe(400000);
    expect(MODEL_REGISTRY['gpt-5'].inputPricePer1M).toBe(1.25);
    expect(MODEL_REGISTRY['gpt-5'].provider).toBe('openai');
  });

  it('contains Claude models', () => {
    expect(MODEL_REGISTRY['claude-4-5-sonnet']).toBeDefined();
    expect(MODEL_REGISTRY['claude-4-5-sonnet'].provider).toBe('anthropic');
  });

  it('contains Gemini models', () => {
    expect(MODEL_REGISTRY['gemini-2-5-pro']).toBeDefined();
    expect(MODEL_REGISTRY['gemini-2-5-pro'].provider).toBe('google');
  });

  it('all models have required fields', () => {
    for (const [_name, spec] of Object.entries(MODEL_REGISTRY)) {
      expect(spec.contextWindow).toBeGreaterThan(0);
      expect(spec.encoding).toBeDefined();
      expect(spec.provider).toBeDefined();
      expect(typeof spec.inputPricePer1M).toBe('number');
      expect(typeof spec.outputPricePer1M).toBe('number');
    }
  });

  it('has at least 30 models', () => {
    expect(Object.keys(MODEL_REGISTRY).length).toBeGreaterThanOrEqual(30);
  });
});
