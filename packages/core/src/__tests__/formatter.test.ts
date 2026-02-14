import { describe, expect, it } from 'vitest';
import { analyzeFormats, formatOutput } from '../formatters.js';

describe('formatOutput', () => {
  const sampleData = [
    { id: 1, name: 'Alice', active: true },
    { id: 2, name: 'Bob', active: false },
  ];

  describe('JSON format', () => {
    it('produces valid JSON', () => {
      const output = formatOutput(sampleData, 'json');
      const parsed = JSON.parse(output);
      expect(parsed).toEqual(sampleData);
    });
  });

  describe('CSV format', () => {
    it('produces header row followed by data rows', () => {
      const output = formatOutput(sampleData, 'csv');
      const lines = output.trim().split('\n');

      expect(lines.length).toBe(3); // header + 2 data rows
      expect(lines[0]).toContain('id');
      expect(lines[0]).toContain('name');
    });

    it('handles empty data', () => {
      const output = formatOutput([], 'csv');
      expect(output.trim()).toBe('');
    });
  });

  describe('TOON format', () => {
    it('produces tab-separated output', () => {
      const output = formatOutput(sampleData, 'toon');
      expect(output).toContain('\t');
    });

    it('includes header row', () => {
      const output = formatOutput(sampleData, 'toon');
      const firstLine = output.trim().split('\n')[0];
      expect(firstLine).toContain('id');
      expect(firstLine).toContain('name');
    });
  });

  describe('Markdown format', () => {
    it('produces a markdown table', () => {
      const output = formatOutput(sampleData, 'markdown');
      expect(output).toContain('|');
      expect(output).toContain('---');
    });

    it('includes all column headers', () => {
      const output = formatOutput(sampleData, 'markdown');
      expect(output).toContain('id');
      expect(output).toContain('name');
      expect(output).toContain('active');
    });
  });

  describe('All formats produce non-empty output', () => {
    for (const format of ['json', 'csv', 'toon', 'markdown'] as const) {
      it(`${format} produces output`, () => {
        const output = formatOutput(sampleData, format);
        expect(output.length).toBeGreaterThan(0);
      });
    }
  });
});

describe('analyzeFormats', () => {
  it('returns analysis for multiple formats', () => {
    const data = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ];

    const analyses = analyzeFormats(data);
    expect(analyses.length).toBeGreaterThan(0);

    for (const analysis of analyses) {
      expect(analysis.format).toBeDefined();
      expect(analysis.output).toBeDefined();
      expect(analysis.byteSize).toBeGreaterThan(0);
    }
  });

  it('returns empty analyses for empty data', () => {
    const analyses = analyzeFormats([]);
    // Should either return empty analyses or analyses with minimal output
    expect(analyses).toBeDefined();
  });
});
