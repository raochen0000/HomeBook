/** Ignore old errors while retrying and errors belonging to disabled queries. */
export function hasSettledRefreshFailure(
  queries: readonly { isError: boolean; isFetching: boolean; isEnabled: boolean; errorUpdatedAt: number }[],
  reconnectedAt = 0,
): boolean {
  return queries.some(
    (query) => query.isEnabled && query.isError && !query.isFetching && query.errorUpdatedAt >= reconnectedAt,
  );
}
