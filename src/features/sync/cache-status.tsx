import { useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Radius, Space, usePalette } from '@/constants/design';
import { INTL_LOCALE, t, useLocalePreference } from '@/i18n';
import { toI18nLanguage } from '@/i18n/locale';
import { getLastNetworkReconnectAt, useNetworkAvailable } from '@/lib/query-network';

/** One non-blocking notice for visible queries; avoid re-rendering the navigation tree on each request. */
export function CacheStatusNotice() {
  const client = useQueryClient();
  const networkAvailable = useNetworkAvailable();
  const { locale } = useLocalePreference();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const [dismissed, setDismissed] = useState(false);
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
          .filter((query) => query.isActive() && query.state.data !== undefined);
        const failed = visible.some(
          (query) =>
            query.state.status === 'error' &&
            query.state.fetchStatus === 'idle' &&
            query.state.errorUpdatedAt >= getLastNetworkReconnectAt(),
        );
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
  }, [client, networkAvailable]);

  const offline = !networkAvailable;
  const visible = state.hasData && (offline || state.failed);
  if (!visible || dismissed) return null;
  const lng = toI18nLanguage(locale);
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
      style={[
        styles.notice,
        {
          top: insets.top + Space[2],
          backgroundColor: palette.card,
          shadowColor: palette.shadow,
        },
      ]}
    >
      <SymbolView name="wifi.exclamationmark" size={18} tintColor={palette.textSecondary} />
      <View style={styles.copy}>
        <Text style={[styles.text, { color: palette.textPrimary }]}>{t('common.cachedStatus', { lng })}</Text>
        {time ? (
          <Text style={[styles.time, { color: palette.textSecondary }]}>{t('common.cachedOldest', { time, lng })}</Text>
        ) : null}
      </View>
      {!offline ? (
        <Pressable
          accessibilityRole="button"
          style={styles.retry}
          onPress={() =>
            void client.refetchQueries(
              { type: 'active', predicate: (query) => query.state.status === 'error' },
              { cancelRefetch: false },
            )
          }
        >
          <Text style={[styles.retryText, { color: palette.accent }]}>{t('common.retry', { lng })}</Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.close', { lng })}
        onPress={() => setDismissed(true)}
        style={({ pressed }) => [styles.close, { opacity: pressed ? 0.55 : 1 }]}
      >
        <SymbolView name="xmark" size={14} tintColor={palette.textSecondary} />
      </Pressable>
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
    paddingLeft: Space[3],
    paddingRight: Space[1],
    paddingVertical: Space[1],
    borderRadius: Radius.full,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    zIndex: 15,
    elevation: 4,
  },
  copy: { flexShrink: 1 },
  text: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  time: { fontSize: 12, lineHeight: 17 },
  retry: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  retryText: { fontWeight: '600' },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
