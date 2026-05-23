import { describe, expect, it } from 'vitest';
import {
  buildActualByChannel,
  buildPlannedByChannel,
  computeCompliance,
} from './spend-compliance.util';

describe('Spend compliance', () => {
  const allocations = [
    {
      channels: [
        { name: 'Social Media Marketing', amount: 3000 },
        { name: 'Content Marketing', amount: 2000 },
      ],
    },
    {
      channels: [{ name: 'Website & Digital Experience', amount: 5000 }],
    },
  ];

  it('builds planned totals per channel', () => {
    const planned = buildPlannedByChannel(allocations);
    expect(planned['Social Media Marketing']).toBe(3000);
    expect(planned['Website & Digital Experience']).toBe(5000);
  });

  it('scores 100 when actual matches plan', () => {
    const planned = buildPlannedByChannel(allocations);
    const actual = buildActualByChannel([
      { channel: 'Social Media Marketing', amount: 3000 },
      { channel: 'Content Marketing', amount: 2000 },
      { channel: 'Website & Digital Experience', amount: 5000 },
    ]);
    const { score, totalVariance } = computeCompliance(planned, actual);
    expect(score).toBe(100);
    expect(totalVariance).toBe(0);
  });

  it('scores lower when spend deviates from plan', () => {
    const planned = buildPlannedByChannel(allocations);
    const actual = buildActualByChannel([
      { channel: 'Social Media Marketing', amount: 6000 },
      { channel: 'Content Marketing', amount: 0 },
      { channel: 'Website & Digital Experience', amount: 5000 },
    ]);
    const { score } = computeCompliance(planned, actual);
    expect(score).toBeLessThan(100);
    expect(score).toBeGreaterThan(0);
  });

  it('scores 100 when no planned budget and no spend', () => {
    const { score } = computeCompliance({}, {});
    expect(score).toBe(100);
  });
});
