export type SearchPresentation = 'invalid' | 'history' | 'skeleton' | 'results';

export type SearchPresentationInput = {
  isValid: boolean;
  hasCurrentQuery: boolean;
  isSearching: boolean;
};

export function getSearchPresentation({
  isValid,
  hasCurrentQuery,
  isSearching,
}: SearchPresentationInput): SearchPresentation {
  if (!isValid) return 'invalid';
  if (!hasCurrentQuery) return 'history';
  return isSearching ? 'skeleton' : 'results';
}

export function shouldLockFilterControls(filterInteractionId: number, deferredFilterInteractionId: number): boolean {
  return filterInteractionId !== deferredFilterInteractionId;
}
