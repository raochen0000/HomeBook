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

type Payload = Record<string, unknown> | null;
type NotificationTone = 'accent' | 'danger' | 'info' | 'success' | 'warning';
type NoticeDescription = {
  icon: SymbolViewProps['name'];
  title: string;
  body: string;
  tone: NotificationTone;
};

function famName(p: Payload): string {
  return typeof p?.family_name === 'string' ? `「${p.family_name}」` : '家庭';
}

/** 通知 → 图标、语义色、标题与正文。 */
function describe(n: Notification): NoticeDescription {
  const p = (n.payload ?? null) as Payload;
  switch (n.type) {
    case 'removed':
      return p?.reason === 'dissolved'
        ? { icon: 'person.2.slash', title: '家庭已解散', body: `${famName(p)}已被户主解散`, tone: 'danger' }
        : { icon: 'person.2.slash', title: '你已被移出家庭', body: `你已被移出${famName(p)}`, tone: 'danger' };
    case 'transfer':
      return p?.new_owner_user_id === n.user_id
        ? { icon: 'arrow.left.arrow.right', title: '户主变更', body: `你已成为${famName(p)}的户主`, tone: 'info' }
        : {
            icon: 'arrow.left.arrow.right',
            title: '户主变更',
            body: `${typeof p?.new_owner_name === 'string' ? `「${p.new_owner_name}」` : '一位家庭成员'}已成为${famName(p)}的户主`,
            tone: 'info',
          };
    case 'succession':
      return {
        icon: 'person.crop.circle.badge.exclamationmark',
        title: '户主继任',
        body: '有成员发起了户主继任申请',
        tone: 'info',
      };
    case 'goal_achieved':
      return {
        icon: 'target',
        title: '储蓄目标达成',
        body: `${typeof p?.goal_name === 'string' ? `「${p.goal_name}」` : '一个储蓄目标'}已达成 🎉`,
        tone: 'success',
      };
    case 'budget_alert':
      return {
        icon: 'exclamationmark.triangle',
        title: '预算预警',
        body: typeof p?.text === 'string' ? p.text : '本月预算需要关注',
        tone: 'warning',
      };
    case 'monthly_summary':
      return {
        icon: 'doc.text',
        title: '月度总结',
        body: `${typeof p?.period === 'string' ? p.period : '上月'}的家庭总结已生成`,
        tone: 'accent',
      };
    default:
      return { icon: 'bell', title: '通知', body: '', tone: 'accent' };
  }
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (Number.isNaN(d.getTime())) return '';
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return `今天 ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (isYesterday) return '昨天';
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
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
  const listQ = useAllNotifications();
  const deleteOne = useDeleteNotification();
  const deleteAll = useDeleteNotifications();
  const router = useRouter();

  const items = listQ.data ?? [];

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.flex}>
        {/* 悬浮磨砂标题区（自动保存型：纯标题，DESIGN §9.9）；关闭靠下滑手势 */}
        <SheetHeader title="通知中心" />

        {items.length === 0 ? (
          <View style={styles.center}>
            <SymbolView name="bell.slash" tintColor={palette.textTertiary} size={48} />
            <Text selectable style={[styles.emptyTitle, { color: palette.textPrimary }]}>
              暂无通知
            </Text>
            <Text selectable style={[styles.emptyBody, { color: palette.textSecondary }]}>
              新的家庭动态会显示在这里
            </Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.listToolbar}>
              <Text selectable style={[styles.unreadSummary, { color: palette.textPrimary }]}>
                {`最新 ${items.length} 条`}
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={deleteAll.isPending}
                hitSlop={8}
                onPress={() => deleteAll.mutate(items.map((item) => item.id))}
                style={({ pressed }) => [styles.markAllRow, pressed ? styles.pressed : null]}
              >
                <Text selectable style={[styles.action, { color: palette.info }]}>
                  全部清除
                </Text>
              </Pressable>
            </View>

            <Text selectable style={[styles.sectionTitle, { color: palette.textSecondary }]}>
              最新通知
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
        accessibilityHint="点按阅读后删除"
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
