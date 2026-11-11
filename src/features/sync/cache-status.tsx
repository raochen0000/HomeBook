import { useNetInfo } from '@react-native-community/netinfo';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Radius, Space, usePalette } from '@/constants/design';
import { INTL_LOCALE, t, useLocalePreference } from '@/i18n';

/** One non-blocking notice for visible queries; avoid re-rendering the navigation tree on each request. */
export function CacheStatusNotice() {
  const client = useQueryClient();
  const net = useNetInfo();
  const { locale } = useLocalePreference();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<{ hasData: boolean; failed: boolean; updatedAt: number | null }>({
    hasData: false,
    failed: false,
    updatedAt: null,
  });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const visible = client
          .getQueryCache()
          .getAll()
          .filter((query) => query.getObserversCount() > 0 && query.state.data !== undefined);
        const failed = visible.some((query) => query.state.status === 'error');
        const times = visible.map((query) => query.state.dataUpdatedAt).filter((time) => time > 0);
        setState({ hasData: visible.length > 0, failed, updatedAt: times.length ? Math.min(...times) : null });
      }, 300);
    };
    update();
    const unsubscribe = client.getQueryCache().subscribe(update);
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [client]);

  const offline = net.isConnected === false || net.isInternetReachable === false;
  if (!state.hasData || (!offline && !state.failed)) return null;
  const time = state.updatedAt
    ? new Intl.DateTimeFormat(INTL_LOCALE[locale], {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(state.updatedAt)
    : null;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.notice, { bottom: insets.bottom + 68, backgroundColor: palette.card }]}
    >
      <Text style={[styles.text, { color: palette.textSecondary }]}>
        {time ? t('common.cachedAt', { time }) : t('common.cachedOffline')}
      </Text>
      {!offline ? (
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            void client.refetchQueries({ type: 'active', predicate: (query) => query.state.status === 'error' })
          }
        >
          <Text style={{ color: palette.accent }}>{t('common.retry')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    position: 'absolute',
    alignSelf: 'center',
    maxWidth: '90%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[2],
    paddingHorizontal: Space[3],
    paddingVertical: Space[2],
    borderRadius: Radius.md,
    zIndex: 15,
    elevation: 4,
  },
  text: { flexShrink: 1, fontSize: 12 },
});
