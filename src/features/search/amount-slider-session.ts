export type AmountSliderDraft = { min: string; max: string; limit: number };

/** Keep intermediate drag values local; publish a changed range only on release. */
export function createAmountSliderSession(initial: AmountSliderDraft, onCommit: (range: AmountSliderDraft) => void) {
  let current = initial;
  let active = true;
  return {
    update(min: string, max: string): AmountSliderDraft {
      if (active) current = { ...current, min, max };
      return current;
    },
    finish(cancelled: boolean): void {
      if (!active) return;
      active = false;
      if (!cancelled && (current.min !== initial.min || current.max !== initial.max)) onCommit(current);
    },
  };
}
