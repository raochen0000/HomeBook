/**
 * 关键通知兜底（流程 13，P0 子集）：被移除/家庭解散 → 全屏提示；户主转让 → Toast。
 * 作为根布局的兄弟覆盖层，仅在已登录时渲染。通知行走 Realtime；回前台也会重拉。
 * 转让不挂常驻顶部条幅：新到达的转让通知提示一次，消息仍留在通知中心。
 */
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDeleteNotification, useUnreadNotifications, type Notification } from '@/api';
import { toast } from '@/components/toast';
import { Radius, Space, usePalette } from '@/constants/design';
import { t, useLocalePreference } from '@/i18n';

type Payload = { reason?: string; family_name?: string; new_owner_user_id?: string; new_owner_name?: string } | null;

/** 本进程内已提示过的转让通知，避免刷新或重挂时重复弹出。 */
const announcedTransferIds = new Set<string>();
/** 首包里晚于挂载时刻这一小段的转让，视为「刚发生」而不是历史未读。 */
const TRANSFER_TOAST_GRACE_MS = 60_000;

function transferToastText(notif: Notification): string {
  const payload = notif.payload as Payload;
  const famName = payload?.family_name
    ? t('notifications.quotedFamily', { name: payload.family_name })
    : t('notifications.familyFallback');
  const isNewOwner = payload?.new_owner_user_id === notif.user_id;
  return isNewOwner
    ? t('notifications.transferSelf', { family: famName })
    : t('notifications.transferOther', {
        name: payload?.new_owner_name ?? t('notifications.aMember'),
        family: famName,
      });
}

function useTransferToast(notifications: Notification[] | undefined) {
  const mountedAtRef = useRef<number | null>(null);
  const primedRef = useRef(false);

  useEffect(() => {
    if (!notifications) return;
    const mountedAt = mountedAtRef.current ?? Date.now();
    if (mountedAtRef.current == null) mountedAtRef.current = mountedAt;
    const transfers = notifications.filter((n) => n.type === 'transfer');
    const unseen = transfers.filter((n) => !announcedTransferIds.has(n.id));
    for (const n of transfers) announcedTransferIds.add(n.id);
    if (unseen.length === 0) {
      primedRef.current = true;
      return;
    }

    const toAnnounce = primedRef.current
      ? unseen
      : unseen.filter((n) => {
          const created = Date.parse(n.created_at);
          return Number.isFinite(created) && created >= mountedAt - TRANSFER_TOAST_GRACE_MS;
        });
    primedRef.current = true;
    const latest = toAnnounce.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (!latest) return;
    const text = transferToastText(latest);
    // ToastHost 在本组件之后挂载，等本轮 effect 结束后再提示，避免 listener 还没注册。
    setTimeout(() => toast.success(text), 0);
  }, [notifications]);
}

export function NotificationGate() {
  const palette = usePalette();
  useLocalePreference();
  const { data } = useUnreadNotifications();
  const deleteNotification = useDeleteNotification();
  useTransferToast(data);

  const removed = data?.find((n) => n.type === 'removed');

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

  return null;
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
});
