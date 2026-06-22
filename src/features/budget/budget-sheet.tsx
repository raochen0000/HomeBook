/**
 * 预算（流程 8）：查看本月总预算/已用/剩余 + 分类预算执行条；仅户主可设置/调整。
 * 「已用」口径排除储蓄类流水（与报表一致）。预警一律按总预算计算；分类超支单独高亮。
 * 单 Modal 内在「查看 / 编辑」间切换。
 */
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  useBudget,
  useCategories,
  useHiddenCategoryIds,
  useMyFamily,
  useMyProfile,
  useSaveBudget,
  useTransactions,
  type Category,
} from '@/api';
import { Radius, Space, useCategoryColors, usePalette } from '@/constants/design';
import { budgetLevel, daysToMonthEnd, expenseUsedInPeriod } from '@/lib/budget';
import { categoryColorKey } from '@/lib/category-style';
import { currentPeriod, formatAmount, monthLabel } from '@/lib/format';

const toCents = (raw: string) => Math.round(Number(raw || '0') * 100);

export function BudgetSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <Body onClose={onClose} /> : null}
    </Modal>
  );
}

function levelColor(level: 'normal' | 'warning' | 'danger', palette: ReturnType<typeof usePalette>) {
  return level === 'danger' ? palette.danger : level === 'warning' ? palette.warning : palette.accent;
}

function Body({ onClose }: { onClose: () => void }) {
  const palette = usePalette();
  const period = currentPeriod();
  const profileQ = useMyProfile();
  const familyQ = useMyFamily();
  const budgetQ = useBudget(period);
  const txnsQ = useTransactions();
  const [editing, setEditing] = useState(false);

  const isOwner = familyQ.data?.owner_user_id === profileQ.data?.id;
  const used = useMemo(() => expenseUsedInPeriod(txnsQ.data ?? [], period), [txnsQ.data, period]);

  if (editing) {
    return <Editor period={period} onBack={() => setEditing(false)} />;
  }

  const budget = budgetQ.data?.budget ?? null;
  const cats = budgetQ.data?.categories ?? [];

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView style={styles.flex}>
        <View style={styles.topBar}>
          <Text style={[styles.title, { color: palette.textPrimary }]}>预算 · {monthLabel(new Date())}</Text>
          <Pressable hitSlop={8} onPress={onClose}>
            <Text style={[styles.action, { color: palette.textSecondary }]}>完成</Text>
          </Pressable>
        </View>

        {budgetQ.isLoading ? null : !budget ? (
          <View style={styles.center}>
            <SymbolView name="chart.pie" tintColor={palette.textTertiary} size={48} />
            <Text style={{ color: palette.textSecondary }}>本月还没有预算</Text>
            {isOwner ? (
              <Pressable onPress={() => setEditing(true)} style={[styles.primary, { backgroundColor: palette.accent }]}>
                <Text style={[styles.primaryText, { color: palette.onAccent }]}>设置预算</Text>
              </Pressable>
            ) : (
              <Text style={{ color: palette.textTertiary, fontSize: 13 }}>请户主设置本月预算</Text>
            )}
          </View>
        ) : (
          <BudgetView
            palette={palette}
            total={budget.total_amount}
            usedTotal={used.total}
            usedByCat={used.byCategory}
            categories={cats}
            isOwner={isOwner}
            onEdit={() => setEditing(true)}
          />
        )}
      </SafeAreaView>
    </View>
  );
}

function BudgetView({
  palette,
  total,
  usedTotal,
  usedByCat,
  categories,
  isOwner,
  onEdit,
}: {
  palette: ReturnType<typeof usePalette>;
  total: number;
  usedTotal: number;
  usedByCat: Map<string, number>;
  categories: { category_id: string; amount: number }[];
  isOwner: boolean;
  onEdit: () => void;
}) {
  const catColors = useCategoryColors();
  const catsQ = useCategories('expense');
  const catById = useMemo(() => new Map((catsQ.data ?? []).map((c) => [c.id, c])), [catsQ.data]);

  const pct = total > 0 ? Math.round((usedTotal / total) * 100) : 0;
  const level = budgetLevel(pct);
  const remaining = total - usedTotal;
  const daysLeft = daysToMonthEnd();

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {/* 总预算卡 */}
      <View style={[styles.totalCard, { backgroundColor: palette.card }]}>
        <Text style={{ color: palette.textSecondary }}>已用 / 总预算</Text>
        <Text style={[styles.totalAmount, { color: palette.textPrimary }]}>
          {formatAmount(usedTotal, '')}
          <Text style={{ color: palette.textTertiary, fontSize: 18 }}> / {formatAmount(total, '')}</Text>
        </Text>
        <View style={[styles.track, { backgroundColor: palette.base }]}>
          <View
            style={[styles.fill, { backgroundColor: levelColor(level, palette), width: `${Math.min(100, pct)}%` }]}
          />
        </View>
        <View style={styles.totalMeta}>
          <Text style={{ color: levelColor(level, palette), fontWeight: '600' }}>
            {level === 'danger' ? `已超支 ${formatAmount(-remaining, '')}` : `剩 ${formatAmount(remaining, '')}`}
          </Text>
          <Text style={{ color: palette.textSecondary, fontSize: 13 }}>
            {pct}% · 距月底 {daysLeft} 天
          </Text>
        </View>
      </View>

      {/* 分类预算执行 */}
      {categories.length > 0 ? (
        <View style={styles.group}>
          <Text style={[styles.groupTitle, { color: palette.textSecondary }]}>分类预算</Text>
          <View style={[styles.card, { backgroundColor: palette.card }]}>
            {categories.map((bc, i) => {
              const cat = catById.get(bc.category_id);
              const u = usedByCat.get(bc.category_id) ?? 0;
              const cpct = bc.amount > 0 ? Math.round((u / bc.amount) * 100) : 0;
              const clevel = budgetLevel(cpct);
              const name = cat?.name ?? '已停用分类';
              return (
                <View key={bc.category_id}>
                  {i > 0 ? <View style={[styles.divider, { backgroundColor: palette.separator }]} /> : null}
                  <View style={styles.catRow}>
                    <View style={[styles.catDot, { backgroundColor: catColors[categoryColorKey(name, 'expense')] }]}>
                      <SymbolView
                        name={(cat?.icon ?? 'circle.fill') as SymbolViewProps['name']}
                        tintColor="#FFFFFF"
                        size={14}
                      />
                    </View>
                    <View style={styles.flex}>
                      <View style={styles.catRowTop}>
                        <Text style={{ color: palette.textPrimary, fontSize: 15, fontWeight: '500' }}>{name}</Text>
                        <Text
                          style={{ color: clevel === 'danger' ? palette.danger : palette.textSecondary, fontSize: 13 }}
                        >
                          {formatAmount(u, '')} / {formatAmount(bc.amount, '')}
                        </Text>
                      </View>
                      <View style={[styles.trackSm, { backgroundColor: palette.base }]}>
                        <View
                          style={[
                            styles.fill,
                            { backgroundColor: levelColor(clevel, palette), width: `${Math.min(100, cpct)}%` },
                          ]}
                        />
                      </View>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      {isOwner ? (
        <Pressable onPress={onEdit} style={[styles.secondary, { borderColor: palette.separator }]}>
          <Text style={{ color: palette.textPrimary, fontSize: 16 }}>调整预算</Text>
        </Pressable>
      ) : (
        <Text style={{ color: palette.textTertiary, fontSize: 13, textAlign: 'center', paddingTop: Space[2] }}>
          预算由户主设置，你可以查看执行情况
        </Text>
      )}
    </ScrollView>
  );
}

// ── 设置 / 调整预算（户主）──────────────────────────────────────────────────
function Editor({ period, onBack }: { period: string; onBack: () => void }) {
  const palette = usePalette();
  const catColors = useCategoryColors();
  const familyQ = useMyFamily();
  const budgetQ = useBudget(period);
  const catsQ = useCategories('expense');
  const hiddenQ = useHiddenCategoryIds();
  const saveM = useSaveBudget();

  // 选择器剔除本家庭隐藏的系统分类；但保留「已设过预算」的分类，避免编辑时丢失既有分配。
  const expenseCats = useMemo<Category[]>(() => {
    const hidden = hiddenQ.data ?? new Set<string>();
    const budgeted = new Set((budgetQ.data?.categories ?? []).map((c) => c.category_id));
    return (catsQ.data ?? []).filter((c) => !c.name.startsWith('储蓄·') && (!hidden.has(c.id) || budgeted.has(c.id)));
  }, [catsQ.data, hiddenQ.data, budgetQ.data]);

  const [total, setTotal] = useState(
    budgetQ.data?.budget?.total_amount ? (budgetQ.data.budget.total_amount / 100).toString() : '',
  );
  const [alertEnabled, setAlertEnabled] = useState(budgetQ.data?.budget?.alert_enabled ?? true);
  const [catAmounts, setCatAmounts] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const bc of budgetQ.data?.categories ?? []) init[bc.category_id] = (bc.amount / 100).toString();
    return init;
  });

  const totalCents = toCents(total);
  const catSum = Object.values(catAmounts).reduce((s, v) => s + toCents(v), 0);
  const overAllocated = totalCents > 0 && catSum > totalCents;
  const canSave = totalCents > 0 && !saveM.isPending;

  const handleSave = async () => {
    if (!canSave) return;
    const fid = familyQ.data?.id;
    if (!fid) {
      Alert.alert('暂时无法保存', '请先创建或加入一个家庭。');
      return;
    }
    const doSave = async () => {
      try {
        await saveM.mutateAsync({
          familyId: fid,
          period,
          totalAmount: totalCents,
          alertEnabled,
          categories: Object.entries(catAmounts).map(([category_id, v]) => ({ category_id, amount: toCents(v) })),
        });
        onBack();
      } catch (e) {
        Alert.alert('保存失败', (e as Error).message ?? String(e));
      }
    };
    if (overAllocated) {
      Alert.alert('分类合计超过总预算', '分类预算合计已超过总预算，仍要保存吗？', [
        { text: '再改改', style: 'cancel' },
        { text: '仍保存', onPress: doSave },
      ]);
    } else {
      await doSave();
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView style={styles.flex}>
        <View style={styles.topBar}>
          <Pressable hitSlop={8} onPress={onBack}>
            <Text style={[styles.action, { color: palette.textSecondary }]}>取消</Text>
          </Pressable>
          <Text style={[styles.title, { color: palette.textPrimary }]}>设置预算</Text>
          <Pressable hitSlop={8} onPress={handleSave} disabled={!canSave}>
            <Text style={[styles.action, { color: canSave ? palette.accent : palette.textTertiary }]}>保存</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.groupTitle, { color: palette.textSecondary }]}>本月总预算</Text>
          <TextInput
            style={[styles.bigAmount, { backgroundColor: palette.card, color: palette.textPrimary }]}
            placeholder="0.00"
            placeholderTextColor={palette.textTertiary}
            value={total}
            onChangeText={setTotal}
            keyboardType="decimal-pad"
            autoFocus
          />

          <View style={[styles.switchRow, { backgroundColor: palette.card }]}>
            <Text style={{ color: palette.textPrimary, fontSize: 15 }}>用至 80% 时预警</Text>
            <Switch value={alertEnabled} onValueChange={setAlertEnabled} />
          </View>

          <View style={styles.groupTitleRow}>
            <Text style={[styles.groupTitle, { color: palette.textSecondary }]}>分类预算（可选）</Text>
            {overAllocated ? <Text style={{ color: palette.warning, fontSize: 12 }}>分类合计超总预算</Text> : null}
          </View>
          <View style={[styles.card, { backgroundColor: palette.card }]}>
            {expenseCats.map((c, i) => (
              <View key={c.id}>
                {i > 0 ? <View style={[styles.divider, { backgroundColor: palette.separator }]} /> : null}
                <View style={styles.catEditRow}>
                  <View style={[styles.catDot, { backgroundColor: catColors[categoryColorKey(c.name, 'expense')] }]}>
                    <SymbolView
                      name={(c.icon ?? 'circle.fill') as SymbolViewProps['name']}
                      tintColor="#FFFFFF"
                      size={14}
                    />
                  </View>
                  <Text style={{ color: palette.textPrimary, fontSize: 15, flex: 1 }}>{c.name}</Text>
                  <TextInput
                    style={[styles.catInput, { color: palette.textPrimary, backgroundColor: palette.base }]}
                    placeholder="不限"
                    placeholderTextColor={palette.textTertiary}
                    value={catAmounts[c.id] ?? ''}
                    onChangeText={(v) => setCatAmounts((prev) => ({ ...prev, [c.id]: v }))}
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
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
    paddingHorizontal: Space[4],
    paddingVertical: Space[3],
  },
  title: { fontSize: 17, fontWeight: '700' },
  action: { fontSize: 16, minWidth: 36 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space[3], paddingHorizontal: Space[6] },
  primary: {
    height: 48,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space[8],
  },
  primaryText: { fontSize: 16, fontWeight: '600' },
  secondary: {
    height: 48,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  content: { paddingHorizontal: Space[4], paddingBottom: Space[12], gap: Space[3] },
  totalCard: { padding: Space[5], borderRadius: Radius.lg, gap: Space[2] },
  totalAmount: { fontSize: 30, fontWeight: '700', fontVariant: ['tabular-nums'] },
  totalMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Space[1] },
  track: { width: '100%', height: 10, borderRadius: Radius.full, overflow: 'hidden' },
  trackSm: { width: '100%', height: 6, borderRadius: Radius.full, overflow: 'hidden', marginTop: Space[1] },
  fill: { height: '100%', borderRadius: Radius.full },
  group: { gap: Space[2] },
  groupTitle: { fontSize: 13, paddingHorizontal: Space[1] },
  groupTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: Space[1],
  },
  card: { borderRadius: Radius.lg, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: Space[4] + 28 },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: Space[3], padding: Space[4] },
  catRowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  catDot: { width: 28, height: 28, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  bigAmount: {
    height: 64,
    borderRadius: Radius.md,
    paddingHorizontal: Space[4],
    fontSize: 32,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space[4],
    paddingVertical: Space[3],
    borderRadius: Radius.md,
  },
  catEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[3],
    paddingHorizontal: Space[4],
    paddingVertical: Space[3],
  },
  catInput: {
    width: 96,
    height: 36,
    borderRadius: Radius.sm,
    paddingHorizontal: Space[3],
    fontSize: 15,
    textAlign: 'right',
  },
});
