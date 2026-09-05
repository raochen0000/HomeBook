/**
 * 关键通知兜底（流程 13，P0 子集）：被移除/家庭解散 → 全屏提示；户主转让 → 顶部条幅。
 * 作为根布局的兄弟覆盖层，仅在已登录时渲染。通知行走 Realtime；回前台也会重拉。
 */
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDeleteNotification, useUnreadNotifications, type Notification } from '@/api';
import { Radius, Space, usePalette } from '@/constants/design';
import { t, useLocalePreference } from '@/i18n';

type Payload = { reason?: string; family_name?: string; new_owner_user_id?: string; new_owner_name?: string } | null;

export function NotificationGate() {
  const palette = usePalette();
  useLocalePreference();
  const { data } = useUnreadNotifications();
  const deleteNotification = useDeleteNotification();

  const removed = data?.find((n) => n.type === 'removed');
  const transfer = data?.find((n) => n.type === 'transfer');

  if (removed) {
    const payload = removed.payload as Payload;
    const dissolved = payload?.reason === 'dissolved';
    const famName = payload?.family_name
      ? t('notifications.quotedFamily', { name: payload.family_name })
      : t('notifications.oldFamily');
    return (
      <View style={[styles.fullscreen, { backgroundColor: palette.base }]}>
        <SafeAreaView style={styles.fsInner}>
          <SymbolView name="person.2.slash" tintColor={palette.textTertiary} size={56} />
          <Text style={[styles.fsTitle, { color: palette.textPrimary }]}>
            {dissolved ? t('notifications.dissolvedTitle') : t('notifications.leftFamily')}
          </Text>
          <Text style={[styles.fsBody, { color: palette.textSecondary }]}>
            {dissolved
              ? t('notifications.dissolvedBody', { family: famName })
              : t('notifications.removedBody', { family: famName })}
            {'\n'}
            {t('notifications.canCreate')}
          </Text>
          <Pressable
            onPress={() => deleteNotification.mutate(removed.id)}
            style={[styles.fsButton, { backgroundColor: palette.ink }]}
          >
            <Text style={[styles.fsButtonText, { color: palette.onInk }]}>{t('notifications.gotIt')}</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    );
  }

  if (transfer) {
    return (
      <SafeAreaView edges={['top']} style={styles.bannerWrap} pointerEvents="box-none">
        <Banner notif={transfer} onDismiss={() => deleteNotification.mutate(transfer.id)} />
      </SafeAreaView>
    );
  }

  return null;
}

function Banner({ notif, onDismiss }: { notif: Notification; onDismiss: () => void }) {
  const palette = usePalette();
  const payload = notif.payload as Payload;
  const famName = payload?.family_name
    ? t('notifications.quotedFamily', { name: payload.family_name })
    : t('notifications.familyFallback');
  const isNewOwner = payload?.new_owner_user_id === notif.user_id;
  return (
    <View style={[styles.banner, { backgroundColor: palette.bannerTint }]}>
      <SymbolView name="checkmark.seal.fill" tintColor={palette.textSecondary} size={18} />
      <Text style={[styles.bannerText, { color: palette.textPrimary }]}>
        {isNewOwner
          ? t('notifications.transferSelf', { family: famName })
          : t('notifications.transferOther', {
              name: payload?.new_owner_name ?? t('notifications.aMember'),
              family: famName,
            })}
      </Text>
      <Pressable hitSlop={8} onPress={onDismiss}>
        <SymbolView name="xmark" tintColor={palette.textTertiary} size={14} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fullscreen: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20 },
  fsInner: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space[4], paddingHorizontal: Space[8] },
  fsTitle: { fontSize: 22, fontWeight: '700' },
  fsBody: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  fsButton: {
    height: 50,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space[10],
    marginTop: Space[4],
  },
  fsButtonText: { fontSize: 17, fontWeight: '600' },
  bannerWrap: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 15, paddingHorizontal: Space[4] },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[2],
    paddingHorizontal: Space[3],
    paddingVertical: Space[3],
    borderRadius: Radius.md,
    marginTop: Space[2],
  },
  bannerText: { flex: 1, fontSize: 14 },
});
