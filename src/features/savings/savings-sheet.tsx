/**
 * 储蓄目标（流程 7）：列表 / 详情 / 新建·编辑 / 存入·取出，单 Modal 内 view 状态切换。
 * - 所有成员可创建、存入、取出；仅户主可删除（删除回吐余额为收入流水，走 RPC）。
 * - 每家最多 5 个进行中目标。存满 100% 首次达成弹中性达成提示（DESIGN §12，去礼花/庆祝）。
 * - 存入生成「储蓄·目标存入」支出流水、取出生成「储蓄·目标取出」收入流水（资金可对账）。
 */
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  useCreateGoal,
  useDeleteGoal,
  useMyFamily,
  useMyProfile,
  useSavingsDeposit,
  useSavingsEntries,
  useSavingsGoals,
  useSavingsWithdraw,
  useUpdateGoal,
  type SavingsGoal,
} from '@/api';
import { Toast } from '@/components/toast';
import { Radius, Space, usePalette } from '@/constants/design';
import { formatAmount } from '@/lib/format';

const MAX_ACTIVE = 5;

type ViewState =
  | { mode: 'list' }
  | { mode: 'detail'; goalId: string }
  | { mode: 'form'; goal: SavingsGoal | null }
  | { mode: 'txn'; goalId: string; dir: 'deposit' | 'withdraw' };

/** 元字符串 → 分。 */
const toCents = (raw: string) => Math.round(Number(raw || '0') * 100);

function progressPct(saved: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.round((saved / target) * 100));
}

function daysLeft(deadline: string | null): number | null {
  if (!deadline) return null;
  const d = new Date(deadline);
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / 86400000);
}

export function SavingsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <Body onClose={onClose} /> : null}
    </Modal>
  );
}

function Body({ onClose }: { onClose: () => void }) {
  const palette = usePalette();
  const goalsQ = useSavingsGoals();
  const [view, setView] = useState<ViewState>({ mode: 'list' });
  const [achievedName, setAchievedName] = useState<string | null>(null);

  const goals = goalsQ.data ?? [];
  const currentGoal = (id: string) => goals.find((g) => g.id === id) ?? null;

  let content: React.ReactNode;
  if (view.mode === 'list') {
    content = (
      <GoalList palette={palette} goals={goals} loading={goalsQ.isLoading} onClose={onClose} setView={setView} />
    );
  } else if (view.mode === 'form') {
    content = <GoalForm goal={view.goal} onBack={() => setView({ mode: 'list' })} />;
  } else if (view.mode === 'txn') {
    const g = currentGoal(view.goalId);
    content = g ? (
      <TxnForm
        goal={g}
        dir={view.dir}
        onBack={() => setView({ mode: 'detail', goalId: g.id })}
        onAchieved={setAchievedName}
      />
    ) : null;
  } else {
    const g = currentGoal(view.goalId);
    content = g ? <GoalDetail goal={g} onBack={() => setView({ mode: 'list' })} setView={setView} /> : null;
  }

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      {content}
      <Toast
        visible={!!achievedName}
        text={achievedName ? `「${achievedName}」已达成` : ''}
        onHide={() => setAchievedName(null)}
      />
    </View>
  );
}

// ── 目标列表 ─────────────────────────────────────────────────────────────────
function GoalList({
  palette,
  goals,
  loading,
  onClose,
  setView,
}: {
  palette: ReturnType<typeof usePalette>;
  goals: SavingsGoal[];
  loading: boolean;
  onClose: () => void;
  setView: (v: ViewState) => void;
}) {
  const onNew = () => {
    if (goals.length >= MAX_ACTIVE) {
      Alert.alert('目标已满', `最多同时进行 ${MAX_ACTIVE} 个储蓄目标，完成或删除后再新建。`);
      return;
    }
    setView({ mode: 'form', goal: null });
  };

  return (
    <SafeAreaView style={styles.flex}>
      <View style={styles.topBar}>
        <Text style={[styles.title, { color: palette.textPrimary }]}>储蓄目标</Text>
        <Pressable hitSlop={8} onPress={onClose}>
          <Text style={[styles.action, { color: palette.textSecondary }]}>完成</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : goals.length === 0 ? (
        <View style={styles.center}>
          <SymbolView name="target" tintColor={palette.textTertiary} size={48} />
          <Text style={{ color: palette.textSecondary }}>还没有储蓄目标</Text>
          <Text style={{ color: palette.textTertiary, fontSize: 13 }}>一家人一起攒个小目标吧</Text>
          <Pressable onPress={onNew} style={[styles.primary, { backgroundColor: palette.accent }]}>
            <Text style={[styles.primaryText, { color: palette.onAccent }]}>新建目标</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {goals.map((g) => {
            const pct = progressPct(g.saved_amount, g.target_amount);
            const dl = daysLeft(g.deadline);
            const done = g.saved_amount >= g.target_amount;
            return (
              <Pressable
                key={g.id}
                onPress={() => setView({ mode: 'detail', goalId: g.id })}
                style={[styles.goalCard, { backgroundColor: palette.card }]}
              >
                <View style={styles.goalHead}>
                  <Text style={[styles.goalName, { color: palette.textPrimary }]}>{g.name}</Text>
                  {done ? <SymbolView name="checkmark.seal.fill" tintColor={palette.income} size={18} /> : null}
                </View>
                <ProgressBar pct={pct} palette={palette} />
                <View style={styles.goalMeta}>
                  <Text style={[styles.goalSaved, { color: palette.textPrimary }]}>
                    {formatAmount(g.saved_amount, '')}
                    <Text style={{ color: palette.textTertiary }}> / {formatAmount(g.target_amount, '')}</Text>
                  </Text>
                  <Text style={{ color: palette.textSecondary, fontSize: 13 }}>
                    {pct}%{dl != null ? (dl >= 0 ? ` · 剩 ${dl} 天` : ' · 已过期') : ''}
                  </Text>
                </View>
              </Pressable>
            );
          })}
          <Pressable onPress={onNew} style={[styles.addGoal, { borderColor: palette.separator }]}>
            <SymbolView name="plus" tintColor={palette.accent} size={18} />
            <Text style={{ color: palette.accent, fontSize: 16 }}>新建目标</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ── 目标详情 ─────────────────────────────────────────────────────────────────
function GoalDetail({
  goal,
  onBack,
  setView,
}: {
  goal: SavingsGoal;
  onBack: () => void;
  setView: (v: ViewState) => void;
}) {
  const palette = usePalette();
  const profileQ = useMyProfile();
  const familyQ = useMyFamily();
  const entriesQ = useSavingsEntries(goal.id);
  const deleteM = useDeleteGoal();

  const isOwner = familyQ.data?.owner_user_id === profileQ.data?.id;
  const pct = progressPct(goal.saved_amount, goal.target_amount);
  const remaining = Math.max(0, goal.target_amount - goal.saved_amount);
  const dl = daysLeft(goal.deadline);

  const onDelete = () => {
    if (!isOwner) {
      Alert.alert('仅户主可删除', '删除储蓄目标需要户主操作。');
      return;
    }
    Alert.alert(
      '删除目标',
      `删除「${goal.name}」后，已存的 ${formatAmount(goal.saved_amount, '')} 会作为一笔收入退回家庭账本（资金不会消失）。确定删除吗？`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteM.mutateAsync(goal.id);
              onBack();
            } catch (e) {
              Alert.alert('删除失败', (e as Error).message ?? String(e));
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.flex}>
      <View style={styles.topBar}>
        <Pressable hitSlop={8} onPress={onBack}>
          <SymbolView name="chevron.left" tintColor={palette.textSecondary} size={20} />
        </Pressable>
        <Text style={[styles.title, { color: palette.textPrimary }]} numberOfLines={1}>
          {goal.name}
        </Text>
        <Pressable hitSlop={8} onPress={() => setView({ mode: 'form', goal })}>
          <Text style={[styles.action, { color: palette.textSecondary }]}>编辑</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.detailCard, { backgroundColor: palette.card }]}>
          <Text style={[styles.detailSaved, { color: palette.textPrimary }]}>
            {formatAmount(goal.saved_amount, '')}
          </Text>
          <Text style={{ color: palette.textSecondary }}>目标 {formatAmount(goal.target_amount, '')}</Text>
          <ProgressBar pct={pct} palette={palette} big />
          <View style={styles.detailMetaRow}>
            <Detail label="进度" value={`${pct}%`} palette={palette} />
            <Detail label="还差" value={formatAmount(remaining, '')} palette={palette} />
            <Detail label="期限" value={dl != null ? (dl >= 0 ? `${dl} 天` : '已过期') : '无'} palette={palette} />
          </View>
        </View>

        {/* 存入 / 取出 */}
        <View style={styles.txnBtns}>
          <Pressable
            onPress={() => setView({ mode: 'txn', goalId: goal.id, dir: 'deposit' })}
            style={[styles.txnBtn, { backgroundColor: palette.accent }]}
          >
            <SymbolView name="arrow.down" tintColor={palette.onAccent} size={16} weight="semibold" />
            <Text style={[styles.txnBtnText, { color: palette.onAccent }]}>存入</Text>
          </Pressable>
          <Pressable
            onPress={() => setView({ mode: 'txn', goalId: goal.id, dir: 'withdraw' })}
            disabled={goal.saved_amount <= 0}
            style={[
              styles.txnBtn,
              styles.txnBtnGhost,
              { borderColor: palette.separator, opacity: goal.saved_amount <= 0 ? 0.4 : 1 },
            ]}
          >
            <SymbolView name="arrow.up" tintColor={palette.textPrimary} size={16} weight="semibold" />
            <Text style={[styles.txnBtnText, { color: palette.textPrimary }]}>取出</Text>
          </Pressable>
        </View>

        {goal.note ? (
          <View style={[styles.noteCard, { backgroundColor: palette.card }]}>
            <Text style={{ color: palette.textSecondary, fontSize: 14 }}>{goal.note}</Text>
          </View>
        ) : null}

        {/* 存取记录 */}
        <Text style={[styles.groupTitle, { color: palette.textSecondary }]}>存取记录</Text>
        <View style={[styles.card, { backgroundColor: palette.card }]}>
          {(entriesQ.data ?? []).length === 0 ? (
            <Text style={{ color: palette.textTertiary, padding: Space[4] }}>还没有存取记录</Text>
          ) : (
            (entriesQ.data ?? []).map((e, i) => {
              const dep = e.direction === 'deposit';
              return (
                <View key={e.id}>
                  {i > 0 ? <View style={[styles.divider, { backgroundColor: palette.separator }]} /> : null}
                  <View style={styles.entryRow}>
                    <SymbolView
                      name={dep ? 'arrow.down.circle.fill' : 'arrow.up.circle.fill'}
                      tintColor={dep ? palette.expense : palette.income}
                      size={22}
                    />
                    <View style={styles.flex}>
                      <Text style={{ color: palette.textPrimary, fontSize: 15 }}>{dep ? '存入' : '取出'}</Text>
                      <Text style={{ color: palette.textTertiary, fontSize: 12 }}>
                        {new Date(e.created_at).toLocaleDateString('zh-CN')}
                        {e.note ? ` · ${e.note}` : ''}
                      </Text>
                    </View>
                    <Text style={{ color: dep ? palette.expense : palette.income, fontWeight: '600' }}>
                      {formatAmount(e.amount, dep ? '-' : '+')}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
        </View>

        {isOwner ? (
          <Pressable onPress={onDelete} style={styles.deleteRow}>
            <Text style={{ color: palette.danger, fontSize: 16 }}>删除目标</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Detail({ label, value, palette }: { label: string; value: string; palette: ReturnType<typeof usePalette> }) {
  return (
    <View style={styles.detailItem}>
      <Text style={{ color: palette.textTertiary, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: palette.textPrimary, fontSize: 15, fontWeight: '600' }}>{value}</Text>
    </View>
  );
}

// ── 新建 / 编辑目标 ───────────────────────────────────────────────────────────
const DEADLINE_PRESETS: { key: string; label: string; months: number | null }[] = [
  { key: 'none', label: '无期限', months: null },
  { key: '3m', label: '3 个月', months: 3 },
  { key: '6m', label: '6 个月', months: 6 },
  { key: '1y', label: '1 年', months: 12 },
];

function deadlineFromMonths(months: number | null): string | null {
  if (months == null) return null;
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function GoalForm({ goal, onBack }: { goal: SavingsGoal | null; onBack: () => void }) {
  const palette = usePalette();
  const familyQ = useMyFamily();
  const createM = useCreateGoal();
  const updateM = useUpdateGoal();
  const isEdit = !!goal;

  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(goal?.target_amount ? (goal.target_amount / 100).toString() : '');
  const [note, setNote] = useState(goal?.note ?? '');
  // 编辑态保留原截止日（以 preset 'keep' 表示不改）；新建默认无期限。
  const [preset, setPreset] = useState<string>(isEdit ? 'keep' : 'none');

  const saving = createM.isPending || updateM.isPending;
  const targetCents = toCents(target);
  const canSave = name.trim() !== '' && targetCents > 0 && !saving;

  const resolveDeadline = (): string | null | undefined => {
    if (preset === 'keep') return undefined; // 不修改
    const p = DEADLINE_PRESETS.find((x) => x.key === preset);
    return deadlineFromMonths(p?.months ?? null);
  };

  const handleSave = async () => {
    if (!canSave) return;
    const trimmed = name.trim();
    try {
      if (isEdit) {
        const deadline = resolveDeadline();
        await updateM.mutateAsync({
          id: goal.id,
          name: trimmed,
          target_amount: targetCents,
          note: note.trim() || null,
          ...(deadline === undefined ? {} : { deadline }),
        });
      } else {
        const fid = familyQ.data?.id;
        if (!fid) {
          Alert.alert('暂时无法创建', '请先创建或加入一个家庭。');
          return;
        }
        await createM.mutateAsync({
          family_id: fid,
          name: trimmed,
          target_amount: targetCents,
          deadline: deadlineFromMonths(DEADLINE_PRESETS.find((x) => x.key === preset)?.months ?? null),
          note: note.trim() || null,
        });
      }
      onBack();
    } catch (e) {
      Alert.alert('保存失败', (e as Error).message ?? String(e));
    }
  };

  return (
    <SafeAreaView style={styles.flex}>
      <View style={styles.topBar}>
        <Pressable hitSlop={8} onPress={onBack}>
          <Text style={[styles.action, { color: palette.textSecondary }]}>取消</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.textPrimary }]}>{isEdit ? '编辑目标' : '新建目标'}</Text>
        <Pressable hitSlop={8} onPress={handleSave} disabled={!canSave}>
          <Text style={[styles.action, { color: canSave ? palette.accent : palette.textTertiary }]}>保存</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
        <Field label="目标名称" palette={palette}>
          <TextInput
            style={[styles.input, { backgroundColor: palette.card, color: palette.textPrimary }]}
            placeholder="如：全家三亚游"
            placeholderTextColor={palette.textTertiary}
            value={name}
            onChangeText={setName}
            maxLength={12}
            autoFocus={!isEdit}
          />
        </Field>

        <Field label="目标金额" palette={palette}>
          <TextInput
            style={[styles.input, { backgroundColor: palette.card, color: palette.textPrimary }]}
            placeholder="0.00"
            placeholderTextColor={palette.textTertiary}
            value={target}
            onChangeText={setTarget}
            keyboardType="decimal-pad"
          />
        </Field>

        <Field label="截止日期（可选）" palette={palette}>
          <View style={styles.chips}>
            {(isEdit ? [{ key: 'keep', label: '不修改', months: null }, ...DEADLINE_PRESETS] : DEADLINE_PRESETS).map(
              (p) => {
                const active = preset === p.key;
                return (
                  <Pressable
                    key={p.key}
                    onPress={() => setPreset(p.key)}
                    style={[styles.chip, { backgroundColor: active ? palette.accent : palette.card }]}
                  >
                    <Text style={{ color: active ? palette.onAccent : palette.textPrimary, fontSize: 14 }}>
                      {p.label}
                    </Text>
                  </Pressable>
                );
              },
            )}
          </View>
        </Field>

        <Field label="备注（可选）" palette={palette}>
          <TextInput
            style={[styles.input, { backgroundColor: palette.card, color: palette.textPrimary }]}
            placeholder="给目标加一句话"
            placeholderTextColor={palette.textTertiary}
            value={note}
            onChangeText={setNote}
            maxLength={50}
          />
        </Field>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── 存入 / 取出 ──────────────────────────────────────────────────────────────
function TxnForm({
  goal,
  dir,
  onBack,
  onAchieved,
}: {
  goal: SavingsGoal;
  dir: 'deposit' | 'withdraw';
  onBack: () => void;
  onAchieved: (name: string) => void;
}) {
  const palette = usePalette();
  const depositM = useSavingsDeposit();
  const withdrawM = useSavingsWithdraw();
  const isDep = dir === 'deposit';

  const [raw, setRaw] = useState('');
  const [note, setNote] = useState('');
  const cents = toCents(raw);
  const saving = depositM.isPending || withdrawM.isPending;
  const overWithdraw = !isDep && cents > goal.saved_amount;
  const canSave = cents > 0 && !overWithdraw && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    try {
      const wasAchieved = !!goal.achieved_at;
      if (isDep) {
        const updated = (await depositM.mutateAsync({
          goalId: goal.id,
          amountCents: cents,
          version: goal.version,
          note,
        })) as SavingsGoal;
        onBack();
        // 首次达成 → 中性达成提示（PRD §9.6：仅首次触发一次；DESIGN §12 去礼花）
        if (!wasAchieved && updated?.achieved_at) onAchieved(goal.name);
      } else {
        await withdrawM.mutateAsync({ goalId: goal.id, amountCents: cents, version: goal.version, note });
        onBack();
      }
    } catch (e) {
      Alert.alert(isDep ? '存入失败' : '取出失败', (e as Error).message ?? String(e));
    }
  };

  return (
    <SafeAreaView style={styles.flex}>
      <View style={styles.topBar}>
        <Pressable hitSlop={8} onPress={onBack}>
          <Text style={[styles.action, { color: palette.textSecondary }]}>取消</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.textPrimary }]}>{isDep ? '存入' : '取出'}</Text>
        <Pressable hitSlop={8} onPress={handleSave} disabled={!canSave}>
          <Text style={[styles.action, { color: canSave ? palette.accent : palette.textTertiary }]}>确定</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
        <Text style={{ color: palette.textSecondary, paddingHorizontal: Space[1] }}>
          {goal.name} · 已存 {formatAmount(goal.saved_amount, '')}
        </Text>
        <TextInput
          style={[styles.bigAmount, { backgroundColor: palette.card, color: isDep ? palette.expense : palette.income }]}
          placeholder="0.00"
          placeholderTextColor={palette.textTertiary}
          value={raw}
          onChangeText={setRaw}
          keyboardType="decimal-pad"
          autoFocus
        />
        {overWithdraw ? (
          <Text style={{ color: palette.danger, paddingHorizontal: Space[1] }}>取出金额超过已存金额</Text>
        ) : null}
        <TextInput
          style={[styles.input, { backgroundColor: palette.card, color: palette.textPrimary }]}
          placeholder={isDep ? '备注（可选）' : '用途备注（可选）'}
          placeholderTextColor={palette.textTertiary}
          value={note}
          onChangeText={setNote}
          maxLength={50}
        />
        <Text style={{ color: palette.textTertiary, fontSize: 12, paddingHorizontal: Space[1] }}>
          {isDep ? '存入会记一笔「储蓄·目标存入」支出流水' : '取出会记一笔「储蓄·目标取出」收入流水'}，家庭账本可对账。
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── 进度条 ───────────────────────────────────────────────────────────────────
function ProgressBar({ pct, palette, big }: { pct: number; palette: ReturnType<typeof usePalette>; big?: boolean }) {
  return (
    <View style={[styles.track, { backgroundColor: palette.base, height: big ? 12 : 8 }]}>
      <View
        style={[styles.fill, { backgroundColor: pct >= 100 ? palette.income : palette.accent, width: `${pct}%` }]}
      />
    </View>
  );
}

function Field({
  label,
  palette,
  children,
}: {
  label: string;
  palette: ReturnType<typeof usePalette>;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.groupTitle, { color: palette.textSecondary }]}>{label}</Text>
      {children}
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
    gap: Space[3],
  },
  title: { fontSize: 17, fontWeight: '700', flex: 1, textAlign: 'center' },
  action: { fontSize: 16, minWidth: 36 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space[2], paddingHorizontal: Space[6] },
  content: { paddingHorizontal: Space[4], paddingBottom: Space[12], gap: Space[3] },
  primary: {
    height: 48,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space[8],
    marginTop: Space[3],
  },
  primaryText: { fontSize: 16, fontWeight: '600' },
  goalCard: { padding: Space[4], borderRadius: Radius.lg, gap: Space[2] },
  goalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  goalName: { fontSize: 17, fontWeight: '600' },
  goalMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  goalSaved: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  addGoal: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space[2],
    height: 48,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  track: { width: '100%', borderRadius: Radius.full, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.full },
  detailCard: { padding: Space[5], borderRadius: Radius.lg, gap: Space[2], alignItems: 'center' },
  detailSaved: { fontSize: 34, fontWeight: '700', fontVariant: ['tabular-nums'] },
  detailMetaRow: { flexDirection: 'row', justifyContent: 'space-around', alignSelf: 'stretch', marginTop: Space[3] },
  detailItem: { alignItems: 'center', gap: 2 },
  txnBtns: { flexDirection: 'row', gap: Space[3] },
  txnBtn: {
    flex: 1,
    height: 48,
    borderRadius: Radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space[2],
  },
  txnBtnGhost: { borderWidth: StyleSheet.hairlineWidth },
  txnBtnText: { fontSize: 16, fontWeight: '600' },
  noteCard: { padding: Space[4], borderRadius: Radius.lg },
  groupTitle: { fontSize: 13, paddingHorizontal: Space[1] },
  card: { borderRadius: Radius.lg, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: Space[4] + 22 },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: Space[3], padding: Space[4] },
  deleteRow: { alignItems: 'center', paddingVertical: Space[4], marginTop: Space[2] },
  formContent: { paddingHorizontal: Space[4], paddingBottom: Space[12], gap: Space[4] },
  field: { gap: Space[2] },
  input: { height: 50, borderRadius: Radius.md, paddingHorizontal: Space[4], fontSize: 16 },
  bigAmount: {
    height: 72,
    borderRadius: Radius.md,
    paddingHorizontal: Space[4],
    fontSize: 36,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space[2] },
  chip: { paddingHorizontal: Space[3], paddingVertical: Space[2], borderRadius: Radius.full },
});
