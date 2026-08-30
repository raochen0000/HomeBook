/**
 * 通知中心（流程 13，App 内）：仅展示最新 100 条待处理通知；点按阅读后立即删除，可一键清除当前列表。
 * 系统推送由 iOS 的 Expo Push → APNs 链路唤回；通知中心只展示 channel=in_app 的消息。
 */
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAllNotifications, useDeleteNotification, useDeleteNotifications, type Notification } from '@/api';
import { PageSheet } from '@/components/page-sheet';
import { SHEET_CONTENT_TOP_PADDING, SheetHeader } from '@/components/sheet-header';
import { Radius, Space, Typography, useSheetPalette } from '@/constants/design';
import { notificationHrefForItem } from '@/features/notifications/notification-routes';
import { i18n, t, useLocalePreference } from '@/i18n';
import { fromI18nLanguage, INTL_LOCALE } from '@/i18n/locale';

type Payload = Record<string, unknown> | null;
type NotificationTone = 'accent' | 'danger' | 'info' | 'success' | 'warning';
type NoticeDescription = {
  icon: SymbolViewProps['name'];
  title: string;
  body: string;
  tone: NotificationTone;
};

function famName(p: Payload): string {
  return typeof p?.family_name === 'string'
    ? t('notifications.quotedFamily', { name: p.family_name })
    : t('notifications.familyFallback');
}

/** 通知 → 图标、语义色、标题与正文。 */
function describe(n: Notification): NoticeDescription {
  const p = (n.payload ?? null) as Payload;
  switch (n.type) {
    case 'removed':
      return p?.reason === 'dissolved'
        ? {
            icon: 'person.2.slash',
            title: t('notifications.dissolvedTitle'),
            body: t('notifications.dissolvedBody', { family: famName(p) }),
            tone: 'danger',
          }
        : {
            icon: 'person.2.slash',
            title: t('notifications.removedTitle'),
            body: t('notifications.removedBody', { family: famName(p) }),
            tone: 'danger',
          };
    case 'transfer':
      return p?.new_owner_user_id === n.user_id
        ? {
            icon: 'arrow.left.arrow.right',
            title: t('notifications.transferTitle'),
            body: t('notifications.transferSelf', { family: famName(p) }),
            tone: 'info',
          }
        : {
            icon: 'arrow.left.arrow.right',
            title: t('notifications.transferTitle'),
            body: t('notifications.transferOther', {
              name:
                typeof p?.new_owner_name === 'string'
                  ? t('notifications.quotedFamily', { name: p.new_owner_name })
                  : t('notifications.aMember'),
              family: famName(p),
            }),
            tone: 'info',
          };
    case 'succession':
      return {
        icon: 'person.crop.circle.badge.exclamationmark',
        title: t('notifications.successionTitle'),
        body: t('notifications.successionBody'),
        tone: 'info',
      };
    case 'goal_achieved':
      return {
        icon: 'target',
        title: t('notifications.goalTitle'),
        body: t('notifications.goalBody', {
          name:
            typeof p?.goal_name === 'string'
              ? t('notifications.quotedFamily', { name: p.goal_name })
              : t('notifications.aGoal'),
        }),
        tone: 'success',
      };
    case 'budget_alert':
      return {
        icon: 'exclamationmark.triangle',
        title: t('notifications.budgetTitle'),
        body: typeof p?.text === 'string' ? p.text : t('notifications.budgetBody'),
        tone: 'warning',
      };
    case 'monthly_summary':
      return {
        icon: 'doc.text',
        title: t('notifications.summaryTitle'),
        body: t('notifications.summaryBody', {
          period: typeof p?.period === 'string' ? p.period : t('notifications.lastMonth'),
        }),
        tone: 'accent',
      };
    default:
      return { icon: 'bell', title: t('notifications.untitled'), body: '', tone: 'accent' };
  }
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (Number.isNaN(d.getTime())) return '';
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return t('dates.justNow');
  if (diffMin < 60) return t('dates.minutesAgo', { count: diffMin });
  const loc = INTL_LOCALE[fromI18nLanguage(i18n.language)];
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) {
    const time = d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    return `${t('dates.today')} ${time}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (isYesterday) return t('dates.yesterday');
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(loc, { month: 'long', day: 'numeric' });
  return d.toLocaleDateString(loc, { year: 'numeric', month: 'long', day: 'numeric' });
}

export function NotificationCenterSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <PageSheet visible={visible} onClose={onClose}>
      <Body onClose={onClose} />
    </PageSheet>
  );
}

function Body({ onClose }: { onClose: () => void }) {
  const palette = useSheetPalette();
  useLocalePreference();
  const listQ = useAllNotifications();
  const deleteOne = useDeleteNotification();
  const deleteAll = useDeleteNotifications();
  const router = useRouter();

  const items = listQ.data ?? [];

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.flex}>
        {/* 悬浮磨砂标题区（自动保存型：纯标题，DESIGN §9.9）；关闭靠下滑手势 */}
        <SheetHeader title={t('notifications.center')} />

        {items.length === 0 ? (
          <View style={styles.center}>
            <SymbolView name="bell.slash" tintColor={palette.textTertiary} size={48} />
            <Text selectable style={[styles.emptyTitle, { color: palette.textPrimary }]}>
              {t('notifications.empty')}
            </Text>
            <Text selectable style={[styles.emptyBody, { color: palette.textSecondary }]}>
              {t('notifications.emptySub')}
            </Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.listToolbar}>
              <Text selectable style={[styles.unreadSummary, { color: palette.textPrimary }]}>
                {t('notifications.latestCount', { count: items.length })}
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={deleteAll.isPending}
                hitSlop={8}
                onPress={() => deleteAll.mutate(items.map((item) => item.id))}
                style={({ pressed }) => [styles.markAllRow, pressed ? styles.pressed : null]}
              >
                <Text selectable style={[styles.action, { color: palette.info }]}>
                  {t('notifications.clearAll')}
                </Text>
              </Pressable>
            </View>

            <Text selectable style={[styles.sectionTitle, { color: palette.textSecondary }]}>
              {t('notifications.latest')}
            </Text>
            <View style={[styles.listGroup, { backgroundColor: palette.card }]}>
              {items.map((n, index) => (
                <NotificationRow
                  key={n.id}
                  item={n}
                  isLast={index === items.length - 1}
                  onRead={() =>
                    deleteOne.mutate(n.id, {
                      onSuccess: () => {
                        onClose();
                        router.push(notificationHrefForItem(n));
                      },
                    })
                  }
                />
              ))}
            </View>
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

function NotificationRow({ item, isLast, onRead }: { item: Notification; isLast: boolean; onRead: () => void }) {
  const palette = useSheetPalette();
  useLocalePreference();
  const d = describe(item);
  const time = timeLabel(item.created_at);
  const iconColor = d.tone === 'accent' ? palette.accent : palette[d.tone];
  const accessibilityLabel = `${d.title}${d.body ? `，${d.body}` : ''}${time ? `，${time}` : ''}`;

  const content = (
    <>
      <View style={[styles.unreadIndicator, { backgroundColor: palette.accent }]} />
      <View style={[styles.iconWrap, { backgroundColor: palette.base }]}>
        <SymbolView name={d.icon} tintColor={iconColor} size={20} />
      </View>
      <View style={styles.col}>
        <View style={styles.rowTop}>
          <Text selectable numberOfLines={1} style={[styles.rowTitle, { color: palette.textPrimary }]}>
            {d.title}
          </Text>
          {time ? (
            <Text selectable style={[styles.rowTime, { color: palette.textTertiary }]}>
              {time}
            </Text>
          ) : null}
        </View>
        {d.body ? (
          <Text selectable style={[styles.rowBody, { color: palette.textSecondary }]}>
            {d.body}
          </Text>
        ) : null}
      </View>
    </>
  );

  return (
    <View>
      <Pressable
        accessibilityHint={t('notifications.readToDelete')}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        onPress={onRead}
        style={({ pressed }) => [styles.row, { backgroundColor: palette.accentTint }, pressed ? styles.pressed : null]}
      >
        {content}
      </Pressable>
      {!isLast ? <View style={[styles.separator, { backgroundColor: palette.separator }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space[2] },
  emptyTitle: Typography.headline,
  emptyBody: Typography.subheadline,
  content: {
    paddingTop: SHEET_CONTENT_TOP_PADDING,
    paddingHorizontal: Space[6],
    paddingBottom: Space[12],
    gap: Space[3],
  },
  listToolbar: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space[3],
  },
  unreadSummary: { ...Typography.subheadline, fontWeight: '600', fontVariant: ['tabular-nums'] },
  markAllRow: { minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  action: { ...Typography.subheadline, fontWeight: '600' },
  sectionTitle: { ...Typography.caption, fontWeight: '600', marginTop: Space[1] },
  listGroup: { borderRadius: Radius.lg, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space[3],
    minHeight: 72,
    paddingHorizontal: Space[4],
    paddingVertical: Space[3],
  },
  unreadIndicator: { position: 'absolute', top: 22, left: Space[2], width: 3, height: 28, borderRadius: Radius.full },
  iconWrap: { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  col: { flex: 1, gap: 2, paddingTop: 1 },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: Space[2] },
  rowTitle: { ...Typography.headline, flex: 1 },
  rowBody: Typography.subheadline,
  rowTime: { ...Typography.caption, flexShrink: 0, fontVariant: ['tabular-nums'] },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: Space[4] + 40 + Space[3] },
  pressed: { opacity: 0.72 },
});
