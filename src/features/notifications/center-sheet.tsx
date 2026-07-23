/**
 * 通知中心（流程 13，App 内）：列出本人全部通知（含已读），点击标记已读、可一键全部已读。
 * 系统推送（channel=push）需 expo-notifications + APNs，与手机登录一并延后到上线前，本期不做。
 */
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAllNotifications, useMarkAllNotificationsRead, useMarkNotificationRead, type Notification } from '@/api';
import { SHEET_HEADER_HEIGHT, SheetHeader } from '@/components/sheet-header';
import { Radius, Space, usePalette } from '@/constants/design';

type Payload = Record<string, string> | null;

function famName(p: Payload): string {
  return p?.family_name ? `「${p.family_name}」` : '家庭';
}

/** 通知 → 图标 + 标题 + 正文。 */
function describe(n: Notification): { icon: SymbolViewProps['name']; title: string; body: string } {
  const p = (n.payload ?? null) as Payload;
  switch (n.type) {
    case 'removed':
      return p?.reason === 'dissolved'
        ? { icon: 'person.2.slash', title: '家庭已解散', body: `${famName(p)}已被户主解散` }
        : { icon: 'person.2.slash', title: '你已被移出家庭', body: `你已被移出${famName(p)}` };
    case 'transfer':
      return { icon: 'arrow.left.arrow.right', title: '户主变更', body: `你已成为${famName(p)}的户主` };
    case 'succession':
      return { icon: 'person.crop.circle.badge.exclamationmark', title: '户主继任', body: '有成员发起了户主继任申请' };
    case 'goal_achieved':
      return {
        icon: 'target',
        title: '储蓄目标达成',
        body: `${p?.goal_name ? `「${p.goal_name}」` : '一个储蓄目标'}已达成 🎉`,
      };
    case 'budget_alert':
      return { icon: 'exclamationmark.triangle', title: '预算预警', body: p?.text ?? '本月预算需要关注' };
    case 'monthly_summary':
      return { icon: 'doc.text', title: '月度总结', body: `${p?.period ?? '上月'}的家庭总结已生成` };
    default:
      return { icon: 'bell', title: '通知', body: '' };
  }
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)} 小时前`;
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

export function NotificationCenterSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <Body /> : null}
    </Modal>
  );
}

function Body() {
  const palette = usePalette();
  const listQ = useAllNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const items = listQ.data ?? [];
  const hasUnread = items.some((n) => !n.read_at);

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView style={styles.flex}>
        {/* 悬浮磨砂标题区（自动保存型：纯标题，DESIGN §9.9）；关闭靠下滑手势 */}
        <SheetHeader title="通知中心" />

        {items.length === 0 ? (
          <View style={styles.center}>
            <SymbolView name="bell.slash" tintColor={palette.textTertiary} size={48} />
            <Text style={{ color: palette.textSecondary }}>暂无通知</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content}>
            {/* 「全部已读」从标题区移入内容区（DESIGN §9.9：非保存动作不放标题两侧） */}
            {hasUnread ? (
              <Pressable hitSlop={8} onPress={() => markAll.mutate()} style={styles.markAllRow}>
                <Text style={[styles.action, { color: palette.info }]}>全部已读</Text>
              </Pressable>
            ) : null}
            {items.map((n) => {
              const d = describe(n);
              const unread = !n.read_at;
              return (
                <Pressable
                  key={n.id}
                  onPress={() => unread && markRead.mutate(n.id)}
                  style={[styles.row, { backgroundColor: palette.card }]}
                >
                  <View style={[styles.iconWrap, { backgroundColor: palette.base }]}>
                    <SymbolView name={d.icon} tintColor={palette.accent} size={20} />
                  </View>
                  <View style={styles.col}>
                    <View style={styles.rowTop}>
                      <Text style={[styles.rowTitle, { color: palette.textPrimary }]}>{d.title}</Text>
                      {unread ? <View style={[styles.dot, { backgroundColor: palette.danger }]} /> : null}
                    </View>
                    <Text style={[styles.rowBody, { color: palette.textSecondary }]}>{d.body}</Text>
                    <Text style={[styles.rowTime, { color: palette.textTertiary }]}>{timeLabel(n.created_at)}</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space[6],
    paddingTop: Space[5],
    paddingBottom: Space[4],
  },
  title: { flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: Space[4] },
  action: { fontSize: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space[2] },
  content: {
    paddingTop: SHEET_HEADER_HEIGHT,
    paddingHorizontal: Space[6],
    paddingBottom: Space[12],
    gap: Space[2],
  },
  markAllRow: { alignSelf: 'flex-end' },
  row: { flexDirection: 'row', gap: Space[3], padding: Space[4], borderRadius: Radius.lg },
  iconWrap: { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  col: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Space[2] },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  dot: { width: 8, height: 8, borderRadius: Radius.full },
  rowBody: { fontSize: 14, lineHeight: 20 },
  rowTime: { fontSize: 12, marginTop: 2 },
});
