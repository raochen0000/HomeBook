import type { ReportCardId, ReportScope } from './report-cards';

/** Hermes supports format(), but not every supported iOS runtime has formatRange(). */
export function reportComparisonRangeLabel(start: Date, endInclusive: Date, today: Date, locale: string): string {
  const formatter = new Intl.DateTimeFormat(locale, {
    month: 'numeric',
    day: 'numeric',
    ...(start.getFullYear() !== today.getFullYear() || start.getFullYear() !== endInclusive.getFullYear()
      ? { year: 'numeric' as const }
      : {}),
  });
  const from = formatter.format(start);
  const to = formatter.format(endInclusive);
  return from === to ? from : `${from}–${to}`;
}

type Change =
  | { kind: 'percent' | 'amount'; value: number }
  | { kind: 'no-current' }
  | { kind: 'no-previous' }
  | { kind: 'no-records' };

/** Empty windows and zero/negative bases must not suggest a meaningful percentage. */
export function reportComparisonChange(
  scope: ReportScope,
  current: number,
  previous: number,
  currentHasRecords: boolean,
  previousHasRecords: boolean,
): Change {
  if (!currentHasRecords && !previousHasRecords) return { kind: 'no-records' };
  if (!currentHasRecords) return { kind: 'no-current' };
  if (!previousHasRecords) return { kind: 'no-previous' };
  if (scope === 'balance' || previous <= 0) return { kind: 'amount', value: current - previous };
  return { kind: 'percent', value: ((current - previous) / previous) * 100 };
}

export type ReportDisplayBlock = { kind: 'card'; id: ReportCardId } | { kind: 'empty'; ids: ReportCardId[] };

/** Only adjacent empty cards merge. The caller supplies the already-visible order. */
export function compactReportCards(
  order: readonly ReportCardId[],
  empty: ReadonlySet<ReportCardId>,
): ReportDisplayBlock[] {
  const blocks: ReportDisplayBlock[] = [];
  for (const id of order) {
    if (!empty.has(id)) {
      blocks.push({ kind: 'card', id });
      continue;
    }
    const last = blocks[blocks.length - 1];
    if (last?.kind === 'empty') last.ids.push(id);
    else blocks.push({ kind: 'empty', ids: [id] });
  }
  return blocks;
}
