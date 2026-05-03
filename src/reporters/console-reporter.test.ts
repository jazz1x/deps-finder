import { describe, expect, test } from 'bun:test';
import type { AnalysisResult } from '@/domain/types';
import { hasIssues, report } from '@/reporters/console-reporter';

describe('console-reporter', () => {
  describe('hasIssues', () => {
    const empty: AnalysisResult = {
      unused: [],
      unusedPeer: [],
      misplaced: [],
      typeOnly: [],
      totalIssues: 0,
    };

    test('should return true when there are unused dependencies', () => {
      const result: AnalysisResult = { ...empty, unused: ['react'], totalIssues: 1 };
      expect(hasIssues(result)).toBe(true);
    });

    test('should return true when there are misplaced dependencies', () => {
      const result: AnalysisResult = {
        ...empty,
        misplaced: [{ packageName: 'lodash', locations: [] }],
        totalIssues: 1,
      };
      expect(hasIssues(result)).toBe(true);
    });

    test('should return true when there are both unused and misplaced', () => {
      const result: AnalysisResult = {
        ...empty,
        unused: ['react'],
        misplaced: [{ packageName: 'lodash', locations: [] }],
        totalIssues: 2,
      };
      expect(hasIssues(result)).toBe(true);
    });

    test('should return false when there are no issues', () => {
      expect(hasIssues(empty)).toBe(false);
    });
  });

  describe('report', () => {
    const empty: AnalysisResult = {
      unused: [],
      unusedPeer: [],
      misplaced: [],
      typeOnly: [],
      totalIssues: 0,
    };

    test('should generate text report with no issues', () => {
      const output = report(empty, 'text');
      expect(output).toContain('No issues found');
    });

    test('should generate text report with unused dependencies', () => {
      const result: AnalysisResult = {
        ...empty,
        unused: ['react', 'lodash'],
        totalIssues: 2,
      };
      const output = report(result, 'text');
      expect(output).toContain('Unused Dependencies');
      expect(output).toContain('react');
      expect(output).toContain('lodash');
    });

    test('should generate text report with misplaced dependencies', () => {
      const result: AnalysisResult = {
        ...empty,
        misplaced: [
          { packageName: 'express', locations: [{ file: 'src/index.ts', line: 1, importStatement: "import express from 'express'" }] },
          { packageName: 'axios', locations: [{ file: 'src/api.ts', line: 5, importStatement: "import axios from 'axios'" }] },
        ],
        totalIssues: 2,
      };
      const output = report(result, 'text');
      expect(output).toContain('Misplaced Dependencies');
      expect(output).toContain('express');
      expect(output).toContain('axios');
      expect(output).toContain('src/index.ts:1');
      expect(output).toContain('src/api.ts:5');
    });

    test('should generate text report with unused peerDependencies', () => {
      const result: AnalysisResult = {
        ...empty,
        unusedPeer: ['react', 'react-dom'],
        totalIssues: 2,
      };
      const output = report(result, 'text');
      expect(output).toContain('Unused peerDependencies');
      expect(output).toContain('react');
      expect(output).toContain('react-dom');
    });

    test('should generate JSON report', () => {
      const result: AnalysisResult = {
        ...empty,
        unused: ['react'],
        misplaced: [{ packageName: 'express', locations: [] }],
        totalIssues: 2,
      };
      const output = report(result, 'json');
      const parsed = JSON.parse(output);

      expect(parsed.unused).toEqual(['react']);
      expect(parsed.unusedPeer).toEqual([]);
      expect(parsed.misplaced[0].packageName).toBe('express');
      expect(parsed.totalIssues).toBe(2);
      expect(parsed.typeOnly).toEqual([]);
    });

    test('JSON report exposes unusedPeer as a top-level array', () => {
      const result: AnalysisResult = {
        ...empty,
        unusedPeer: ['react'],
        totalIssues: 1,
      };
      const parsed = JSON.parse(report(result, 'json'));
      expect(parsed.unusedPeer).toEqual(['react']);
    });

    test('should display ignored dependencies in text report', () => {
      const output = report(empty, 'text', ['eslint']);
      expect(output).toContain('Ignored packages');
      expect(output).toContain('eslint');
    });

    test('should include ignored dependencies in JSON report', () => {
      const output = report(empty, 'json', ['eslint']);
      const parsed = JSON.parse(output);

      expect(parsed.ignored).toEqual(['eslint']);
    });

    test('should display type-only imports in text report', () => {
      const result: AnalysisResult = { ...empty, typeOnly: ['hotscript', 'type-fest'] };
      const output = report(result, 'text');
      expect(output).toContain('Type-Only Imports:');
      expect(output).toContain('hotscript');
      expect(output).toContain('type-fest');
    });

    test('should include type-only imports in JSON report', () => {
      const result: AnalysisResult = { ...empty, typeOnly: ['hotscript', 'type-fest'] };
      const output = report(result, 'json');
      const parsed = JSON.parse(output);
      expect(parsed.typeOnly).toEqual(['hotscript', 'type-fest']);
    });
  });
});
