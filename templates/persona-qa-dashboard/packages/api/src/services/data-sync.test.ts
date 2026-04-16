import { describe, it, expect } from 'vitest';
import {
  normalizeScenarioId,
  MetadataSchema,
  ResultsSchema,
  ContextJsonSchema,
  FindingJsonSchema,
} from './data-sync.js';

// -----------------------------------------------------------------------
// normalizeScenarioId
// -----------------------------------------------------------------------

describe('normalizeScenarioId', () => {
  it('replaces dashes with underscores', () => {
    expect(normalizeScenarioId('first-order')).toBe('first_order');
  });

  it('leaves underscores untouched', () => {
    expect(normalizeScenarioId('quarterly_reorder')).toBe('quarterly_reorder');
  });

  it('handles multiple dashes', () => {
    expect(normalizeScenarioId('a-b-c-d')).toBe('a_b_c_d');
  });

  it('handles string with no dashes', () => {
    expect(normalizeScenarioId('simple')).toBe('simple');
  });

  it('handles empty string', () => {
    expect(normalizeScenarioId('')).toBe('');
  });

  it('normalizes mixed dash/underscore', () => {
    expect(normalizeScenarioId('foo-bar_baz-qux')).toBe('foo_bar_baz_qux');
  });
});

// -----------------------------------------------------------------------
// MetadataSchema
// -----------------------------------------------------------------------

describe('MetadataSchema', () => {
  it('accepts valid metadata', () => {
    const result = MetadataSchema.safeParse({
      run_source: 'dashboard',
      suite_type: 'single',
      clean_db_before_run: false,
      started_by: 'dashboard-ui',
      scenario_id: 'quarterly_reorder',
      session_id: 'session-123',
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty object (all fields optional)', () => {
    const result = MetadataSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts valid run_source values', () => {
    for (const source of ['dashboard', 'cli', 'clean-run']) {
      const result = MetadataSchema.safeParse({ run_source: source });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid run_source values', () => {
    const result = MetadataSchema.safeParse({ run_source: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('rejects non-boolean clean_db_before_run', () => {
    const result = MetadataSchema.safeParse({ clean_db_before_run: 'yes' });
    expect(result.success).toBe(false);
  });
});

// -----------------------------------------------------------------------
// ResultsSchema
// -----------------------------------------------------------------------

describe('ResultsSchema', () => {
  it('accepts valid results', () => {
    const result = ResultsSchema.safeParse({
      session_id: 'session-1',
      scenario_id: 'test_scenario',
      status: 'complete',
      total_tests: 10,
      passed: 8,
      failed: 2,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = ResultsSchema.safeParse({ session_id: 'x' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid status', () => {
    const result = ResultsSchema.safeParse({
      session_id: 'x',
      scenario_id: 'y',
      status: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('passes through extra fields', () => {
    const result = ResultsSchema.safeParse({
      session_id: 'x',
      scenario_id: 'y',
      status: 'complete',
      custom_field: 'value',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>)['custom_field']).toBe('value');
    }
  });
});

// -----------------------------------------------------------------------
// ContextJsonSchema
// -----------------------------------------------------------------------

describe('ContextJsonSchema', () => {
  it('accepts valid context', () => {
    const result = ContextJsonSchema.safeParse({
      session_id: 'session-1',
      scenario_id: 'test',
      status: 'complete',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing session_id', () => {
    const result = ContextJsonSchema.safeParse({
      scenario_id: 'test',
      status: 'complete',
    });
    expect(result.success).toBe(false);
  });

  it('accepts artifacts as record', () => {
    const result = ContextJsonSchema.safeParse({
      session_id: 's1',
      scenario_id: 'test',
      status: 'complete',
      artifacts: { customer_id: '123', event_id: '456' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts run_source field', () => {
    const result = ContextJsonSchema.safeParse({
      session_id: 's1',
      scenario_id: 'test',
      status: 'complete',
      run_source: 'cli',
    });
    expect(result.success).toBe(true);
  });

  it('accepts findings array', () => {
    const result = ContextJsonSchema.safeParse({
      session_id: 's1',
      scenario_id: 'test',
      status: 'complete',
      findings: [
        {
          finding_id: 'F001',
          agent: 'agent-fulfillment-agent',
          severity: 'high',
          title: 'Test finding',
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

// -----------------------------------------------------------------------
// FindingJsonSchema
// -----------------------------------------------------------------------

describe('FindingJsonSchema', () => {
  it('accepts valid finding', () => {
    const result = FindingJsonSchema.safeParse({
      finding_id: 'F001',
      agent: 'agent-fulfillment-agent',
      step: 'login',
      severity: 'critical',
      title: 'Slow load',
      expected: '<2s',
      actual: '4.2s',
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty object (all fields optional)', () => {
    const result = FindingJsonSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects invalid severity', () => {
    const result = FindingJsonSchema.safeParse({ severity: 'ultra' });
    expect(result.success).toBe(false);
  });
});
