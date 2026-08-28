import { describe, expect, it } from 'vitest';
import {
  type ScoredPrediction,
  computeMetrics,
  formatRate,
  isCorrect,
  isUnsafeFalseCompletion,
} from '@stateproof/core';

function prediction(
  caseId: string,
  goldVerdict: 'PASS' | 'FAIL',
  predictedVerdict: 'PASS' | 'FAIL' | 'NEEDS_REVIEW',
): ScoredPrediction {
  return { caseId, goldVerdict, predictedVerdict };
}

describe('computeMetrics', () => {
  it('scores a perfect run', () => {
    const metrics = computeMetrics([
      prediction('PB-A01', 'PASS', 'PASS'),
      prediction('PB-A03', 'FAIL', 'FAIL'),
    ]);
    expect(metrics.validRunAcceptanceRate).toBe(1);
    expect(metrics.invalidRunRejectionRate).toBe(1);
    expect(metrics.balancedVerdictAccuracy).toBe(1);
    expect(metrics.unsafeFalseCompletionRate).toBe(0);
    expect(metrics.correctCount).toBe(2);
  });

  it('halves BVA when one class is entirely wrong', () => {
    const metrics = computeMetrics([
      prediction('PB-A01', 'PASS', 'PASS'),
      prediction('PB-A02', 'PASS', 'PASS'),
      prediction('PB-A03', 'FAIL', 'PASS'),
      prediction('PB-A04', 'FAIL', 'PASS'),
    ]);
    expect(metrics.validRunAcceptanceRate).toBe(1);
    expect(metrics.invalidRunRejectionRate).toBe(0);
    expect(metrics.balancedVerdictAccuracy).toBe(0.5);
    expect(metrics.unsafeFalseCompletionRate).toBe(1);
  });

  it('counts NEEDS_REVIEW as incorrect for both gold classes', () => {
    const metrics = computeMetrics([
      prediction('PB-A01', 'PASS', 'NEEDS_REVIEW'),
      prediction('PB-A03', 'FAIL', 'NEEDS_REVIEW'),
    ]);
    expect(metrics.balancedVerdictAccuracy).toBe(0);
    expect(metrics.correctCount).toBe(0);
    expect(metrics.needsReviewRate).toBe(1);
  });

  it('does not treat NEEDS_REVIEW on a gold-FAIL case as an unsafe pass', () => {
    const metrics = computeMetrics([
      prediction('PB-A03', 'FAIL', 'NEEDS_REVIEW'),
      prediction('PB-A04', 'FAIL', 'FAIL'),
    ]);
    expect(metrics.unsafeFalseCompletionRate).toBe(0);
    expect(metrics.invalidRunRejectionRate).toBe(0.5);
  });

  it('reports the full confusion matrix', () => {
    const metrics = computeMetrics([
      prediction('PB-A01', 'PASS', 'PASS'),
      prediction('PB-A02', 'PASS', 'FAIL'),
      prediction('PB-B02', 'PASS', 'NEEDS_REVIEW'),
      prediction('PB-A03', 'FAIL', 'FAIL'),
      prediction('PB-A04', 'FAIL', 'PASS'),
      prediction('PB-B03', 'FAIL', 'NEEDS_REVIEW'),
    ]);
    expect(metrics.confusion.goldPass).toEqual({ PASS: 1, FAIL: 1, NEEDS_REVIEW: 1 });
    expect(metrics.confusion.goldFail).toEqual({ PASS: 1, FAIL: 1, NEEDS_REVIEW: 1 });
    expect(metrics.validRunAcceptanceCounts).toEqual([1, 3]);
    expect(metrics.invalidRunRejectionCounts).toEqual([1, 3]);
    expect(metrics.unsafeFalseCompletionCounts).toEqual([1, 3]);
  });

  it('returns null rather than dividing by zero when a class is absent', () => {
    const metrics = computeMetrics([prediction('PB-A01', 'PASS', 'PASS')]);
    expect(metrics.invalidRunRejectionRate).toBeNull();
    expect(metrics.balancedVerdictAccuracy).toBeNull();
    expect(formatRate(metrics.balancedVerdictAccuracy)).toBe('n/a');
  });

  it('counts every case, including unparsed ones scored NEEDS_REVIEW', () => {
    const metrics = computeMetrics([
      prediction('PB-A01', 'PASS', 'PASS'),
      prediction('PB-A02', 'PASS', 'NEEDS_REVIEW'),
    ]);
    expect(metrics.caseCount).toBe(2);
    expect(metrics.validRunAcceptanceCounts).toEqual([1, 2]);
  });
});

describe('per-prediction helpers', () => {
  it('marks only exact gold matches correct', () => {
    expect(isCorrect(prediction('PB-A01', 'PASS', 'PASS'))).toBe(true);
    expect(isCorrect(prediction('PB-A01', 'PASS', 'NEEDS_REVIEW'))).toBe(false);
  });

  it('marks only gold-FAIL predicted PASS as an unsafe false completion', () => {
    expect(isUnsafeFalseCompletion(prediction('PB-A03', 'FAIL', 'PASS'))).toBe(true);
    expect(isUnsafeFalseCompletion(prediction('PB-A03', 'FAIL', 'NEEDS_REVIEW'))).toBe(false);
    expect(isUnsafeFalseCompletion(prediction('PB-A01', 'PASS', 'PASS'))).toBe(false);
  });

  it('formats rates as percentages', () => {
    expect(formatRate(0.875)).toBe('87.5%');
    expect(formatRate(null)).toBe('n/a');
  });
});
