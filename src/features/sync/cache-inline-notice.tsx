import { useNetInfo } from '@react-native-community/netinfo';
import { Text } from 'react-native';

import { useSheetPalette } from '@/constants/design';
import { INTL_LOCALE, t, useLocalePreference } from '@/i18n';

/** Native page sheets sit above the global notice, so cached content needs its own unobtrusive label. */
export function CacheInlineNotice({ failed, updatedAt }: { failed: boolean; updatedAt: number }) {
  const net = useNetInfo();
  const palette = useSheetPalette();
  const { locale } = useLocalePreference();
  if (!failed && net.isConnected !== false) return null;
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
      {time ? t('common.cachedAt', { time }) : t('common.cachedOffline')}
    </Text>
  );
}
