import { Text } from 'react-native';

import { useSheetPalette } from '@/constants/design';
import { INTL_LOCALE, t, useLocalePreference } from '@/i18n';
import { getLastNetworkReconnectAt, useNetworkAvailable } from '@/lib/query-network';
import { hasSettledRefreshFailure as hasFailure } from './cache-notice-state';

export function hasSettledRefreshFailure(
  queries: readonly { isError: boolean; isFetching: boolean; isEnabled: boolean; errorUpdatedAt: number }[],
): boolean {
  return hasFailure(queries, getLastNetworkReconnectAt());
}

/** Native page sheets sit above the global notice, so cached content needs its own unobtrusive label. */
export function CacheInlineNotice({ failed, updatedAt }: { failed: boolean; updatedAt: number }) {
  const networkAvailable = useNetworkAvailable();
  const palette = useSheetPalette();
  const { locale } = useLocalePreference();
  if (!failed && networkAvailable) return null;
  const time =
    updatedAt > 0
      ? new Intl.DateTimeFormat(INTL_LOCALE[locale], {
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }).format(updatedAt)
      : null;
  return (
    <Text accessibilityLiveRegion="polite" style={{ color: palette.textSecondary, fontSize: 12, paddingVertical: 4 }}>
      {!networkAvailable
        ? t('common.cachedOffline')
        : time
          ? t('common.cachedAt', { time })
          : t('common.cachedOffline')}
    </Text>
  );
}
