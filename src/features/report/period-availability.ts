/** Cached family and filtered results are both needed to switch without a network. */
export function isOfflinePeriodUnavailable(
  online: boolean,
  familyData: unknown,
  topicRequired: boolean,
  topicData: unknown,
): boolean {
  return !online && (familyData === undefined || (topicRequired && topicData === undefined));
}
