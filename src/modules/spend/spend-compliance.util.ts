/**
 * Planned vs actual spend compliance (SRS §3.5).
 * Score 0–100: 100 when actual matches plan; lower as total absolute variance grows.
 */

export interface ChannelSpendRow {
  channel: string;
  planned: number;
  actual: number;
  variance: number;
  percentOfPlanned: number;
}

export interface ComplianceResult {
  score: number;
  totalPlanned: number;
  totalActual: number;
  totalVariance: number;
  byChannel: ChannelSpendRow[];
}

/** Flatten plan allocations into per-channel planned amounts. */
export function buildPlannedByChannel(
  allocations: Array<{ channels: Array<{ name: string; amount: number }> }>,
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const obj of allocations) {
    for (const ch of obj.channels) {
      map[ch.name] = (map[ch.name] ?? 0) + ch.amount;
    }
  }
  return map;
}

/** Sum spend logs by channel for a date range. */
export function buildActualByChannel(
  logs: Array<{ channel: string; amount: number }>,
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const log of logs) {
    map[log.channel] = (map[log.channel] ?? 0) + log.amount;
  }
  return map;
}

/**
 * Compliance score = max(0, 100 × (1 − Σ|actual−planned| / Σplanned)).
 * Channels with zero planned are omitted from the denominator but still listed.
 */
export function computeCompliance(
  plannedByChannel: Record<string, number>,
  actualByChannel: Record<string, number>,
): ComplianceResult {
  const channels = new Set([
    ...Object.keys(plannedByChannel),
    ...Object.keys(actualByChannel),
  ]);

  let totalPlanned = 0;
  let totalActual = 0;
  let totalVariance = 0;
  const byChannel: ChannelSpendRow[] = [];

  for (const channel of [...channels].sort()) {
    const planned = plannedByChannel[channel] ?? 0;
    const actual = actualByChannel[channel] ?? 0;
    const variance = actual - planned;
    totalPlanned += planned;
    totalActual += actual;
    totalVariance += Math.abs(variance);
    byChannel.push({
      channel,
      planned,
      actual,
      variance,
      percentOfPlanned: planned > 0 ? Math.round((actual / planned) * 1000) / 10 : 0,
    });
  }

  const score =
    totalPlanned > 0
      ? Math.round(Math.max(0, 100 * (1 - totalVariance / totalPlanned)) * 10) / 10
      : totalActual === 0
        ? 100
        : 0;

  return {
    score,
    totalPlanned,
    totalActual,
    totalVariance,
    byChannel,
  };
}
