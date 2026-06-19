/**
 * 记账面板（流程 2 + 流程 10 编辑/删除）。
 *
 * DESIGN §5.3：记账面板 = 原生 Sheet 壳 + 自定义大号金额键盘（L-Custom）。
 * 这里用 RN `Modal`（iOS `pageSheet`，自带抓手 + 下滑关）承载原生 Sheet 观感，
 * 内部金额键盘按设计走自定义 RN 层（@expo/ui 无此交互），避免 RNHostView 桥接的脆弱性。
 *
 * 字段：支出/收入切换、大号金额（唯一必填）、分类（横向滚动彩色圆底）、备注。
 * 时间默认「现在」（DB 默认 now()）；记账人恒为当前登录用户（单人家庭本就隐藏，PRD §4.4）。
 */
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  useCategories,
  useCreateTransaction,
  useSoftDeleteTransaction,
  useUpdateTransaction,
  type Category,
  type Transaction,
} from '@/api';
import { Radius, Space, useCategoryColors, usePalette } from '@/constants/design';
import { categoryColorKey, categorySymbol } from '@/lib/category-style';

type TxnType = 'expense' | 'income';

export type RecordSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** 当前家庭 id（记一笔必须，创建即绑定，不可变）。 */
  familyId: string;
  /** 当前登录用户 id（记账人）。 */
  recorderId: string;
  /** null = 新建；非 null = 编辑该流水。 */
  editing: Transaction | null;
};

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'] as const;

/** 把正在输入的金额字符串拆为「整数（含千分位） + 小数」用于展示。 */
function displayParts(raw: string): { integer: string; decimal: string; hasDot: boolean } {
  const [intRaw = '', decRaw] = raw.split('.');
  const intNum = intRaw === '' ? 0 : Number(intRaw);
  return { integer: intNum.toLocaleString('en-US'), decimal: decRaw ?? '', hasDot: raw.includes('.') };
}

/** 输入串 → 分（bigint 口径）。 */
function rawToCents(raw: string): number {
  return Math.round(Number(raw || '0') * 100);
}

/** 外壳：原生 pageSheet。内部表单只在打开时挂载，靠 useState 初值按 editing 还原（避免 setState-in-effect）。 */
export function RecordSheet({ visible, onClose, familyId, recorderId, editing }: RecordSheetProps) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <RecordForm familyId={familyId} recorderId={recorderId} editing={editing} onClose={onClose} /> : null}
    </Modal>
  );
}

function RecordForm({ familyId, recorderId, editing, onClose }: Omit<RecordSheetProps, 'visible'>) {
  const palette = usePalette();
  const catColors = useCategoryColors();
  const insets = useSafeAreaInsets();

  const categoriesQ = useCategories();
  const createM = useCreateTransaction();
  const updateM = useUpdateTransaction();
  const deleteM = useSoftDeleteTransaction();
  const saving = createM.isPending || updateM.isPending;

  // 初值按 editing 还原（表单随每次打开重新挂载，初值即生效）。
  const [type, setType] = useState<TxnType>(editing?.type === 'income' ? 'income' : 'expense');
  const [raw, setRaw] = useState(editing?.amount ? (editing.amount / 100).toString() : '');
  const [categoryId, setCategoryId] = useState<string | null>(editing?.category_id ?? null);
  const [note, setNote] = useState(editing?.note ?? '');

  // 可手动选择的分类：当前类型 + 排除储蓄类系统分类（储蓄走专门入口，PRD 口径）。
  const categories = useMemo<Category[]>(() => {
    const all = categoriesQ.data ?? [];
    return all.filter((c) => c.type === type && !c.name.startsWith('储蓄·'));
  }, [categoriesQ.data, type]);

  // 有效分类：用户已选且仍合法则用之，否则落到当前类型第一项（在 render 期派生，不用 effect）。
  const effectiveCategoryId = useMemo(() => {
    if (categoryId && categories.some((c) => c.id === categoryId)) return categoryId;
    return categories[0]?.id ?? null;
  }, [categoryId, categories]);

  const cents = rawToCents(raw);
  const canSave = cents > 0 && !!effectiveCategoryId && !!familyId && !saving;
  const amountColor = type === 'expense' ? palette.expense : palette.income;
  const sign = type === 'expense' ? '-' : '+';
  const parts = displayParts(raw);

  const press = (k: (typeof KEYS)[number]) => {
    setRaw((prev) => {
      if (k === '⌫') return prev.slice(0, -1);
      if (k === '.') {
        if (prev.includes('.')) return prev;
        return prev === '' ? '0.' : prev + '.';
      }
      // 数字键
      const [, dec] = prev.split('.');
      if (dec !== undefined && dec.length >= 2) return prev; // 最多两位小数
      if (prev === '0') return k; // 避免前导零
      if (prev.replace('.', '').length >= 9) return prev; // 整体位数上限
      return prev + k;
    });
  };

  const handleSave = async () => {
    if (!canSave || !effectiveCategoryId) return;
    try {
      if (editing) {
        await updateM.mutateAsync({
          id: editing.id,
          type,
          amount: cents,
          category_id: effectiveCategoryId,
          note: note || null,
        });
      } else {
        await createM.mutateAsync({
          family_id: familyId,
          recorder_user_id: recorderId,
          type,
          amount: cents,
          category_id: effectiveCategoryId,
          note: note || null,
        });
      }
      onClose();
    } catch (e) {
      Alert.alert('保存失败', (e as Error).message ?? String(e));
    }
  };

  const handleDelete = () => {
    if (!editing) return;
    Alert.alert('删除这笔流水？', '删除后列表与报表口径将不再统计它。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteM.mutateAsync(editing.id);
            onClose();
          } catch (e) {
            Alert.alert('删除失败', (e as Error).message ?? String(e));
          }
        },
      },
    ]);
  };

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      {/* 顶部操作行：取消 / 标题 / 删除（仅编辑） */}
      <View style={styles.topBar}>
        <Pressable hitSlop={8} onPress={onClose}>
          <Text style={[styles.topAction, { color: palette.textSecondary }]}>取消</Text>
        </Pressable>
        <Text style={[styles.topTitle, { color: palette.textPrimary }]}>{editing ? '编辑流水' : '记一笔'}</Text>
        {editing ? (
          <Pressable hitSlop={8} onPress={handleDelete}>
            <Text style={[styles.topAction, { color: palette.danger }]}>删除</Text>
          </Pressable>
        ) : (
          <View style={styles.topActionSpacer} />
        )}
      </View>

      {/* 支出 / 收入 分段切换 */}
      <View style={[styles.segment, { backgroundColor: palette.card }]}>
        {(['expense', 'income'] as TxnType[]).map((t) => {
          const active = type === t;
          return (
            <Pressable
              key={t}
              style={[styles.segmentItem, active && { backgroundColor: palette.base, borderRadius: Radius.sm }]}
              onPress={() => setType(t)}
            >
              <Text
                style={{
                  color: active ? (t === 'expense' ? palette.expense : palette.income) : palette.textSecondary,
                  fontWeight: active ? '600' : '400',
                  fontSize: 15,
                }}
              >
                {t === 'expense' ? '支出' : '收入'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* 大号金额 */}
      <View style={styles.amountRow}>
        <Text style={[styles.amountSign, { color: amountColor }]}>{`${sign}¥`}</Text>
        <Text style={[styles.amountInt, { color: amountColor }]}>{parts.integer}</Text>
        {parts.hasDot ? <Text style={[styles.amountDec, { color: amountColor }]}>{`.${parts.decimal}`}</Text> : null}
      </View>

      {/* 分类：横向滚动彩色圆底（DESIGN §5.3 / §9.1） */}
      {categoriesQ.isLoading ? (
        <View style={styles.catLoading}>
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.catRow}
          keyboardShouldPersistTaps="handled"
        >
          {categories.map((c) => {
            const active = c.id === effectiveCategoryId;
            const color = catColors[categoryColorKey(c.name, type)];
            return (
              <Pressable key={c.id} style={styles.catItem} onPress={() => setCategoryId(c.id)}>
                <View
                  style={[
                    styles.catCircle,
                    { backgroundColor: color, opacity: active ? 1 : 0.55 },
                    active && { borderWidth: 2, borderColor: palette.textPrimary },
                  ]}
                >
                  <SymbolView
                    name={categorySymbol(c.icon, type) as SymbolViewProps['name']}
                    tintColor="#FFFFFF"
                    size={22}
                  />
                </View>
                <Text
                  numberOfLines={1}
                  style={{
                    color: active ? palette.textPrimary : palette.textSecondary,
                    fontSize: 12,
                    fontWeight: active ? '600' : '400',
                    maxWidth: 56,
                  }}
                >
                  {c.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {/* 备注 */}
      <View style={[styles.noteRow, { backgroundColor: palette.card }]}>
        <SymbolView name="pencil" tintColor={palette.textTertiary} size={16} />
        <TextInput
          style={[styles.noteInput, { color: palette.textPrimary }]}
          placeholder="加个备注…"
          placeholderTextColor={palette.textTertiary}
          value={note}
          onChangeText={setNote}
          maxLength={50}
          returnKeyType="done"
        />
      </View>

      <View style={styles.flexSpacer} />

      {/* 自定义数字键盘 */}
      <View style={styles.keypad}>
        {KEYS.map((k) => (
          <Pressable
            key={k}
            style={({ pressed }) => [styles.key, pressed && { backgroundColor: palette.card }]}
            onPress={() => press(k)}
          >
            {k === '⌫' ? (
              <SymbolView name="delete.left" tintColor={palette.textPrimary} size={24} />
            ) : (
              <Text style={[styles.keyText, { color: palette.textPrimary }]}>{k}</Text>
            )}
          </Pressable>
        ))}
      </View>

      {/* 保存（金额 > 0 才可用） */}
      <Pressable
        disabled={!canSave}
        onPress={handleSave}
        style={[
          styles.save,
          { backgroundColor: palette.accent, opacity: canSave ? 1 : 0.35, marginBottom: insets.bottom + Space[2] },
        ]}
      >
        {saving ? (
          <ActivityIndicator color={palette.onAccent} />
        ) : (
          <Text style={[styles.saveText, { color: palette.onAccent }]}>保存</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: Space[4], paddingTop: Space[3] },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Space[2] },
  topAction: { fontSize: 16 },
  topActionSpacer: { width: 32 },
  topTitle: { fontSize: 17, fontWeight: '600' },
  segment: { flexDirection: 'row', borderRadius: Radius.md, padding: 3, marginTop: Space[3] },
  segmentItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: Space[2] },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', paddingVertical: Space[6] },
  amountSign: { fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] },
  amountInt: { fontSize: 48, fontWeight: '700', fontVariant: ['tabular-nums'] },
  amountDec: { fontSize: 28, fontWeight: '400', fontVariant: ['tabular-nums'] },
  catLoading: { height: 76, alignItems: 'center', justifyContent: 'center' },
  catRow: { gap: Space[4], paddingHorizontal: Space[1], paddingVertical: Space[1] },
  catItem: { alignItems: 'center', gap: Space[1], width: 60 },
  catCircle: { width: 52, height: 52, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[2],
    paddingHorizontal: Space[3],
    paddingVertical: Space[3],
    borderRadius: Radius.md,
    marginTop: Space[4],
  },
  noteInput: { flex: 1, fontSize: 15, padding: 0 },
  flexSpacer: { flex: 1, minHeight: Space[4] },
  keypad: { flexDirection: 'row', flexWrap: 'wrap' },
  key: { width: '33.33%', height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md },
  keyText: { fontSize: 26, fontWeight: '500', fontVariant: ['tabular-nums'] },
  save: { height: 50, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', marginTop: Space[2] },
  saveText: { fontSize: 17, fontWeight: '600' },
});
