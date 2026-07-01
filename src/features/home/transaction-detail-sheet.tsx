/**
 * 流水详情弹窗（只读）：列表项点击后展示。
 * 点击遮罩区或右上角「X」关闭；编辑/删除走列表左滑，不在此处。
 * RN 实现（remote 头像可直接用 expo-image，无原生 uiImage 同步读限制）。
 */
import { Image } from 'expo-image';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCategories, useFamilyMembers, useMyProfile, type Transaction } from '@/api';
import { Radius, Space, useCategoryColors, usePalette } from '@/constants/design';
import { categoryColorKey, categorySymbol } from '@/lib/category-style';
import { clockTime, formatAmount, signForType } from '@/lib/format';

const AVATAR_TINTS = ['#5AA7F0', '#46C98A', '#F5A623', '#9B6DD6'] as const;
function tintFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

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
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: palette.textSecondary }]}>{label}</Text>
      <View style={styles.member}>
        {avatarUrl ? (
          <Image source={avatarUrl} style={styles.avatar} contentFit="cover" transition={120} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: tintFor(userId) }]}>
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
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const catColors = useCategoryColors();
  const categoriesQ = useCategories();
  const membersQ = useFamilyMembers();
  const profileQ = useMyProfile();

  if (!transaction) return null;

  const t = transaction;
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={[styles.backdrop, { paddingBottom: insets.bottom + Space[4] }]} onPress={onClose}>
        {/* 阻止冒泡：点击卡片本体不关闭 */}
        <Pressable style={[styles.card, { backgroundColor: palette.card }]} onPress={() => {}}>
          {/* 关闭 X */}
          <Pressable style={styles.close} onPress={onClose} hitSlop={8}>
            <SymbolView name="xmark.circle.fill" tintColor={palette.textTertiary} size={26} />
          </Pressable>

          {/* 头部：分类圆角方图标 + 名称 + 类型 */}
          <View style={styles.head}>
            <View style={[styles.catIcon, { backgroundColor: iconColor }]}>
              <SymbolView
                name={categorySymbol(cat?.icon ?? null, ttype) as SymbolViewProps['name']}
                tintColor="#FFFFFF"
                size={26}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.catName, { color: palette.textPrimary }]}>{cat?.name ?? '未分类'}</Text>
              <Text style={[styles.typeTag, { color: palette.textSecondary }]}>
                {ttype === 'income' ? '收入' : '支出'}
              </Text>
            </View>
          </View>

          {/* 金额 */}
          <Text style={[styles.amount, { color: amountColor }]}>{formatAmount(t.amount, signForType(ttype))}</Text>

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
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end', paddingHorizontal: Space[4] },
  card: { borderRadius: Radius.xl, padding: Space[5], gap: Space[3] },
  close: { position: 'absolute', top: Space[3], right: Space[3], zIndex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: Space[3], paddingRight: Space[6] },
  catIcon: {
    width: 52,
    height: 52,
    borderRadius: Math.round(52 * 0.2237),
    alignItems: 'center',
    justifyContent: 'center',
  },
  catName: { fontSize: 20, fontWeight: '700' },
  typeTag: { fontSize: 13, marginTop: 2 },
  amount: { fontSize: 32, fontWeight: '700' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Space[1] },
  field: { gap: Space[1] },
  fieldLabel: { fontSize: 13 },
  fieldValue: { fontSize: 15, lineHeight: 21 },
  member: { flexDirection: 'row', alignItems: 'center', gap: Space[2] },
  avatar: { width: 28, height: 28, borderRadius: Radius.full },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
});
