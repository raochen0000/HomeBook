/**
 * 流水详情（只读）：列表项点击后从底部升起、贴合内容高度的 bottom sheet（抓手可下拉关 / 点遮罩关）。
 * 内容短且固定，用系统 pageSheet 会在底部留大片空白；RN Modal 无 detent / 自适应高度，故自绘贴合内容
 * （与 FilterDropdown、AppleLoginSheet 同一约束，DESIGN §9.9：短内容 sheet 自绘、高/可滚动内容才用系统 pageSheet）。
 * 抓手用 responder 事件驱动 translateY 实现下拉关闭（与 AppleLoginSheet 同一手势范式）。
 * 编辑 / 删除走列表左滑，不在此处。RN 实现（remote 头像可直接用 expo-image）。
 */
import { Image } from 'expo-image';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Animated, Pressable, Modal, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCategories, useFamilyMembers, useMyProfile, type Transaction } from '@/api';
import { avatarTintFor, Radius, Space, useAvatarTints, useCategoryColors, usePalette } from '@/constants/design';
import { categoryColorKey, categorySymbol } from '@/lib/category-style';
import { clockTime, formatAmount, signForType } from '@/lib/format';

/** 下拉超过此位移（pt）即判定为关闭，否则弹回原位。 */
const DISMISS_THRESHOLD = 80;

function fullDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${clockTime(iso)}`;
}

function MemberRow({
  label,
  userId,
  nickname,
  avatarUrl,
  sub,
}: {
  label: string;
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  sub?: string;
}) {
  const palette = usePalette();
  const avatarTints = useAvatarTints();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: palette.textSecondary }]}>{label}</Text>
      <View style={styles.member}>
        {avatarUrl ? (
          <Image source={avatarUrl} style={styles.avatar} contentFit="cover" transition={120} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: avatarTintFor(userId, avatarTints) }]}>
            <Text style={styles.avatarInitial}>{[...nickname.trim()][0]?.toUpperCase() ?? '?'}</Text>
          </View>
        )}
        <Text style={[styles.fieldValue, { color: palette.textPrimary }]}>
          {nickname}
          {sub ? <Text style={{ color: palette.textTertiary }}>{`  ${sub}`}</Text> : null}
        </Text>
      </View>
    </View>
  );
}

export function TransactionDetailSheet({
  visible,
  transaction,
  onClose,
}: {
  visible: boolean;
  transaction: Transaction | null;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      {transaction ? <Body visible={visible} transaction={transaction} onClose={onClose} /> : null}
    </Modal>
  );
}

function Body({
  visible,
  transaction: t,
  onClose,
}: {
  visible: boolean;
  transaction: Transaction;
  onClose: () => void;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const catColors = useCategoryColors();
  const categoriesQ = useCategories();
  const membersQ = useFamilyMembers();
  const profileQ = useMyProfile();

  // 下拉关闭手势：抓手命中区拖动驱动 translateY，松手超阈值则收起并 onClose。
  const [translateY] = useState(() => new Animated.Value(0));
  const dragStartY = useRef(0);
  const currentDragY = useRef(0);
  // 复位放在「下次打开前」同步做：拖拽关闭时让卡片停在屏幕外、由 Modal 滑出无痕收尾，
  // 避免关闭途中把卡片拉回原位造成「二次展示」的闪影。
  useLayoutEffect(() => {
    if (visible) translateY.setValue(0);
  }, [visible, translateY]);
  const closeWithDrag = useCallback(() => {
    Animated.timing(translateY, { toValue: 600, duration: 180, useNativeDriver: true }).start(() => {
      onClose();
    });
  }, [onClose, translateY]);
  const finishDrag = () => {
    if (currentDragY.current > DISMISS_THRESHOLD) closeWithDrag();
    else Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
  };

  const ttype = (t.type === 'income' ? 'income' : 'expense') as 'income' | 'expense';
  const cat = (categoriesQ.data ?? []).find((c) => c.id === t.category_id) ?? null;
  const members = membersQ.data ?? [];
  const myId = profileQ.data?.id;
  const nameOf = (id: string) =>
    id === myId ? (profileQ.data?.nickname ?? '我') : (members.find((m) => m.id === id)?.nickname ?? '成员');
  const avatarOf = (id: string) =>
    members.find((m) => m.id === id)?.avatar_url ?? (id === myId ? (profileQ.data?.avatar_url ?? null) : null);

  const iconColor = catColors[categoryColorKey(cat?.name ?? '', ttype)];
  const amountColor = ttype === 'income' ? palette.income : palette.expense;
  const editedByOther = !!t.last_editor_user_id && t.last_editor_user_id !== t.recorder_user_id;

  return (
    <View style={styles.backdrop}>
      {/* 上方遮罩：点击关闭 */}
      <Pressable style={styles.scrim} onPress={onClose} />
      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: palette.base,
            paddingBottom: Math.max(insets.bottom, Space[4]),
            transform: [{ translateY }],
          },
        ]}
      >
        {/* 抓手命中区：下拉可关闭 */}
        <View
          style={styles.grabberArea}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={(e) => {
            dragStartY.current = e.nativeEvent.pageY;
            currentDragY.current = 0;
          }}
          onResponderMove={(e) => {
            const dy = Math.max(0, e.nativeEvent.pageY - dragStartY.current);
            currentDragY.current = dy;
            translateY.setValue(dy);
          }}
          onResponderRelease={finishDrag}
          onResponderTerminate={finishDrag}
        >
          <View style={[styles.grabber, { backgroundColor: palette.separator }]} />
        </View>

        <View style={styles.content}>
          {/* 头部：分类图标 + 名称/类型 + 金额（同一水平行） */}
          <View style={styles.head}>
            <View style={[styles.catIcon, { backgroundColor: iconColor }]}>
              <SymbolView
                name={categorySymbol(cat?.icon ?? null, ttype) as SymbolViewProps['name']}
                tintColor="#FFFFFF"
                size={26}
              />
            </View>
            <View style={styles.headText}>
              <Text style={[styles.catName, { color: palette.textPrimary }]} numberOfLines={1}>
                {cat?.name ?? '未分类'}
              </Text>
              <Text style={[styles.typeTag, { color: palette.textSecondary }]}>
                {ttype === 'income' ? '收入' : '支出'}
              </Text>
            </View>
            <Text style={[styles.amount, { color: amountColor }]} numberOfLines={1}>
              {formatAmount(t.amount, signForType(ttype))}
            </Text>
          </View>

          <View style={[styles.divider, { backgroundColor: palette.separator }]} />

          {/* 字段 */}
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: palette.textSecondary }]}>时间</Text>
            <Text style={[styles.fieldValue, { color: palette.textPrimary }]}>{fullDate(t.occurred_at)}</Text>
          </View>
          {t.note ? (
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: palette.textSecondary }]}>备注</Text>
              <Text style={[styles.fieldValue, { color: palette.textPrimary }]}>{t.note}</Text>
            </View>
          ) : null}
          <MemberRow
            label="记录人"
            userId={t.recorder_user_id}
            nickname={nameOf(t.recorder_user_id)}
            avatarUrl={avatarOf(t.recorder_user_id)}
          />
          {editedByOther ? (
            <MemberRow
              label="修改者"
              userId={t.last_editor_user_id as string}
              nickname={nameOf(t.last_editor_user_id as string)}
              avatarUrl={avatarOf(t.last_editor_user_id as string)}
              sub={`于 ${fullDate(t.updated_at)}`}
            />
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  scrim: { flex: 1 },
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Space[5],
  },
  grabberArea: { alignItems: 'center', justifyContent: 'center', paddingTop: Space[2], paddingBottom: Space[1] },
  grabber: { width: 38, height: 5, borderRadius: Radius.full },
  content: { paddingTop: Space[2], gap: Space[3] },
  head: { flexDirection: 'row', alignItems: 'center', gap: Space[3] },
  headText: { flex: 1, minWidth: 0 },
  catIcon: {
    width: 52,
    height: 52,
    borderRadius: Math.round(52 * 0.2237),
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  catName: { fontSize: 20, fontWeight: '700' },
  typeTag: { fontSize: 13, marginTop: 2 },
  amount: { fontSize: 26, fontWeight: '700', flexShrink: 0 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Space[1] },
  field: { gap: Space[1] },
  fieldLabel: { fontSize: 13 },
  fieldValue: { fontSize: 15, lineHeight: 21 },
  member: { flexDirection: 'row', alignItems: 'center', gap: Space[2] },
  avatar: { width: 28, height: 28, borderRadius: Radius.full },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
});
