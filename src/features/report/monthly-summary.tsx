/**
 * 月度总结（流程 9 / PRD §11.5.2）：全屏、可翻月的单一视图。
 * 入口＝首页 hero「本月脉搏卡」整卡点击，默认落地「本月至今」实例（实时计算，
 * 进行中语气、不提供保存图片）；左右翻月（chevron / 横滑）看历史，上月及更早为
 * 「已结算」仪式实例（保留全部字段 + 暖心文案，保存图片发布前补齐）。
 * 口径：总收支结余含储蓄类（对账）；最大单笔 / 最高分类按日常消费（排除储蓄类）。
 * MVP 不依赖服务端快照表 monthly_summaries，全部客户端实时计算。
 */
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCategories, useFamilyMembers, useMyProfile, useTransactions, type Transaction } from '@/api';
import { Radius, Space, usePalette } from '@/constants/design';
import { currentPeriod, formatAmount, signForNet } from '@/lib/format';

// 已结算月：回顾口吻；进行中（本月至今）：进行口吻。
const WARM_POOL_SETTLED = [
  '这个月你们一起记下了 {count} 笔，每一笔都是生活的痕迹。',
  '{top} 是这个月家里最大的开销，钱花在了在意的地方。',
  '一家人的账，记着记着就成了日子的样子。',
  '{recorder} 是这个月记账最勤快的人，给 TA 一个家庭勋章 🏅',
  '把每一分钱都看见，也把每一天的用心看见。',
];
const WARM_POOL_PROGRESS = [
  '这个月你们已经一起记下了 {count} 笔，继续保持～',
  '本月还在进行中，{top} 是目前最大的开销。',
  '日子还在记，月底再回来看看完整的总结吧。',
  '{recorder} 是本月目前最勤快的记账人 🏅',
  '把每一天的用心都记下来，月末会有惊喜。',
];

/** YYYY-MM → 上一个月 YYYY-MM。 */
function prevPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return currentPeriod(new Date(y, m - 2, 1));
}

/** YYYY-MM → 下一个月 YYYY-MM。 */
function nextPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return currentPeriod(new Date(y, m, 1));
}

/** 「YYYY 年 M 月」基础标题；进行中实例在外层追加「· 截至今日」。 */
function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return `${y} 年 ${m} 月`;
}

type Summary = {
  count: number;
  totalExpense: number;
  totalIncome: number;
  balance: number;
  maxExpense: { amount: number; category: string; date: string } | null;
  topCategory: { name: string; amount: number; pct: number } | null;
  topRecorder: { name: string; count: number } | null;
  momExpense: number | null; // 环比百分比（支出）
  momIncome: number | null;
  warm: string;
};

function computeSummary(
  txns: Transaction[],
  period: string,
  isCurrent: boolean,
  catName: (id: string) => string,
  memberName: (id: string) => string,
): Summary | null {
  const inMonth = txns.filter((t) => currentPeriod(new Date(t.occurred_at)) === period);
  if (inMonth.length === 0) return null;

  let totalExpense = 0;
  let totalIncome = 0;
  const consumByCat = new Map<string, number>();
  const byRecorder = new Map<string, number>();
  let consumTotal = 0;
  let maxExpense: Summary['maxExpense'] = null;

  for (const t of inMonth) {
    if (t.type === 'expense') totalExpense += t.amount;
    else totalIncome += t.amount;
    byRecorder.set(t.recorder_user_id, (byRecorder.get(t.recorder_user_id) ?? 0) + 1);

    // 日常消费（排除储蓄类）用于最大单笔 / 最高分类
    if (t.type === 'expense' && t.source === 'normal') {
      consumTotal += t.amount;
      consumByCat.set(t.category_id, (consumByCat.get(t.category_id) ?? 0) + t.amount);
      if (!maxExpense || t.amount > maxExpense.amount) {
        maxExpense = {
          amount: t.amount,
          category: catName(t.category_id),
          date: new Date(t.occurred_at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }),
        };
      }
    }
  }

  let topCategory: Summary['topCategory'] = null;
  for (const [id, amt] of consumByCat) {
    if (!topCategory || amt > topCategory.amount) {
      topCategory = {
        name: catName(id),
        amount: amt,
        pct: consumTotal > 0 ? Math.round((amt / consumTotal) * 100) : 0,
      };
    }
  }

  let topRecorder: Summary['topRecorder'] = null;
  for (const [id, cnt] of byRecorder) {
    if (!topRecorder || cnt > topRecorder.count) topRecorder = { name: memberName(id), count: cnt };
  }

  // 环比上月：已结算月对比整月；进行中（本月至今）对比「上月同期」（截至相同日序）。
  const prev = prevPeriod(period);
  const dayCap = new Date().getDate();
  let prevExpense = 0;
  let prevIncome = 0;
  for (const t of txns) {
    const d = new Date(t.occurred_at);
    if (currentPeriod(d) !== prev) continue;
    if (isCurrent && d.getDate() > dayCap) continue;
    if (t.type === 'expense') prevExpense += t.amount;
    else prevIncome += t.amount;
  }
  const mom = (cur: number, base: number): number | null => (base > 0 ? Math.round(((cur - base) / base) * 100) : null);

  const pool = isCurrent ? WARM_POOL_PROGRESS : WARM_POOL_SETTLED;
  const warm = pool[Math.floor(Math.random() * pool.length)]
    .replace('{count}', String(inMonth.length))
    .replace('{top}', topCategory?.name ?? '生活')
    .replace('{recorder}', topRecorder?.name ?? '你们');

  return {
    count: inMonth.length,
    totalExpense,
    totalIncome,
    balance: totalIncome - totalExpense,
    maxExpense,
    topCategory,
    topRecorder,
    momExpense: mom(totalExpense, prevExpense),
    momIncome: mom(totalIncome, prevIncome),
    warm,
  };
}

export function MonthlySummaryScreen({
  visible,
  initialPeriod,
  onClose,
}: {
  visible: boolean;
  initialPeriod?: string;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      {visible ? <Screen initialPeriod={initialPeriod} onClose={onClose} /> : null}
    </Modal>
  );
}

function Screen({ initialPeriod, onClose }: { initialPeriod?: string; onClose: () => void }) {
  const palette = usePalette();
  const txnsQ = useTransactions();
  const catsQ = useCategories();
  const membersQ = useFamilyMembers();
  const profileQ = useMyProfile();

  const cur = currentPeriod();
  const [period, setPeriod] = useState(initialPeriod && initialPeriod <= cur ? initialPeriod : cur);

  // 翻月下界：最早一笔流水所在月（无数据时为本月）。
  const minPeriod = useMemo(() => {
    let min = cur;
    for (const t of txnsQ.data ?? []) {
      const p = currentPeriod(new Date(t.occurred_at));
      if (p < min) min = p;
    }
    return min;
  }, [txnsQ.data, cur]);

  const isCurrent = period === cur;
  const canPrev = period > minPeriod;
  const canNext = period < cur;

  // 翻月：函数式更新里自带边界判断，无需把 period 放进依赖。
  const goPrev = () => setPeriod((p) => (p > minPeriod ? prevPeriod(p) : p));
  const goNext = () => setPeriod((p) => (p < cur ? nextPeriod(p) : p));

  // 横滑翻月：仅在「横向位移占主导」时接管，纵向滚动交给内部 ScrollView。
  // 用 useMemo（普通值，非 ref）随边界重建，避免 render 期访问 ref。
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 20 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderRelease: (_e, g) => {
          if (g.dx > 50) setPeriod((p) => (p > minPeriod ? prevPeriod(p) : p));
          else if (g.dx < -50) setPeriod((p) => (p < cur ? nextPeriod(p) : p));
        },
      }),
    [minPeriod, cur],
  );

  const summary = useMemo(() => {
    const catById = new Map((catsQ.data ?? []).map((c) => [c.id, c.name]));
    const memById = new Map((membersQ.data ?? []).map((m) => [m.id, m.nickname]));
    const myId = profileQ.data?.id;
    return computeSummary(
      txnsQ.data ?? [],
      period,
      isCurrent,
      (id) => catById.get(id) ?? '未分类',
      (id) => (id === myId ? '我' : (memById.get(id) ?? '成员')),
    );
  }, [txnsQ.data, catsQ.data, membersQ.data, profileQ.data, period, isCurrent]);

  const title = `${periodLabel(period)}${isCurrent ? ' · 截至今日' : ''}`;
  const momText = (v: number | null) => (v == null ? '—' : v === 0 ? '持平' : v > 0 ? `↑ ${v}%` : `↓ ${Math.abs(v)}%`);

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView style={styles.flex}>
        <View style={styles.topBar}>
          <Text style={[styles.title, { color: palette.textPrimary }]}>月度总结</Text>
          <Pressable hitSlop={8} onPress={onClose}>
            <Text style={[styles.action, { color: palette.textSecondary }]}>完成</Text>
          </Pressable>
        </View>

        {/* 翻月条：‹ 标题 ›（横滑亦可） */}
        <View style={styles.periodBar} {...pan.panHandlers}>
          <Pressable hitSlop={10} onPress={goPrev} disabled={!canPrev}>
            <SymbolView
              name="chevron.left"
              tintColor={canPrev ? palette.textSecondary : palette.textTertiary}
              size={18}
            />
          </Pressable>
          <Text style={[styles.periodLabel, { color: palette.textPrimary }]}>{title}</Text>
          <Pressable hitSlop={10} onPress={goNext} disabled={!canNext}>
            <SymbolView
              name="chevron.right"
              tintColor={canNext ? palette.textSecondary : palette.textTertiary}
              size={18}
            />
          </Pressable>
        </View>

        {!summary ? (
          <View style={styles.center} {...pan.panHandlers}>
            <SymbolView name="doc.text" tintColor={palette.textTertiary} size={48} />
            <Text style={{ color: palette.textSecondary }}>
              {isCurrent ? '本月还没有记账' : `${periodLabel(period)}还没有记账`}
            </Text>
            <Text style={{ color: palette.textTertiary, fontSize: 13 }}>
              {isCurrent ? '记一笔后，这里会生成总结' : '这个月没有总结'}
            </Text>
          </View>
        ) : (
          <View style={styles.flex} {...pan.panHandlers}>
            <ScrollView contentContainerStyle={styles.content}>
              <View style={[styles.hero, { backgroundColor: palette.card }]}>
                <Text style={[styles.balance, { color: palette.textPrimary }]}>
                  {formatAmount(summary.balance, signForNet(summary.balance))}
                </Text>
                <Text style={{ color: palette.textSecondary }}>{isCurrent ? '本月结余 · 截至今日' : '本月结余'}</Text>
                <View style={styles.heroRow}>
                  <HeroStat
                    label="支出"
                    value={formatAmount(summary.totalExpense, '')}
                    color={palette.expense}
                    palette={palette}
                  />
                  <HeroStat
                    label="收入"
                    value={formatAmount(summary.totalIncome, '')}
                    color={palette.income}
                    palette={palette}
                  />
                  <HeroStat label="记账" value={`${summary.count} 笔`} color={palette.textPrimary} palette={palette} />
                </View>
              </View>

              <View style={[styles.card, { backgroundColor: palette.card }]}>
                {summary.maxExpense ? (
                  <StatRow
                    icon="arrow.up.right"
                    label="最大单笔支出"
                    value={`${formatAmount(summary.maxExpense.amount, '')}`}
                    sub={`${summary.maxExpense.category} · ${summary.maxExpense.date}`}
                    palette={palette}
                  />
                ) : null}
                {summary.topCategory ? (
                  <StatRow
                    icon="chart.pie.fill"
                    label="支出最高分类"
                    value={`${summary.topCategory.name} ${formatAmount(summary.topCategory.amount, '')}`}
                    sub={`占消费 ${summary.topCategory.pct}%`}
                    palette={palette}
                  />
                ) : null}
                {summary.topRecorder ? (
                  <StatRow
                    icon="pencil.circle.fill"
                    label="记账最积极的人"
                    value={summary.topRecorder.name}
                    sub={`${isCurrent ? '已记' : '共记'} ${summary.topRecorder.count} 笔`}
                    palette={palette}
                  />
                ) : null}
                <StatRow
                  icon="arrow.left.arrow.right"
                  label="对比上月"
                  value={`支出 ${momText(summary.momExpense)}`}
                  sub={
                    isCurrent ? `收入 ${momText(summary.momIncome)} · 较上月同期` : `收入 ${momText(summary.momIncome)}`
                  }
                  palette={palette}
                  last
                />
              </View>

              <View style={[styles.warmCard, { backgroundColor: palette.bannerTint }]}>
                <SymbolView name="sparkles" tintColor={palette.textSecondary} size={18} />
                <Text style={[styles.warmText, { color: palette.textPrimary }]}>{summary.warm}</Text>
              </View>

              {isCurrent ? (
                <Text style={[styles.footnote, { color: palette.textTertiary }]}>
                  本月仍在进行中，月底结算后可保存为图片
                </Text>
              ) : null}
            </ScrollView>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

function HeroStat({
  label,
  value,
  color,
  palette,
}: {
  label: string;
  value: string;
  color: string;
  palette: ReturnType<typeof usePalette>;
}) {
  return (
    <View style={styles.heroStat}>
      <Text style={{ color: palette.textSecondary, fontSize: 12 }}>{label}</Text>
      <Text style={{ color, fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}

function StatRow({
  icon,
  label,
  value,
  sub,
  palette,
  last,
}: {
  icon: Parameters<typeof SymbolView>[0]['name'];
  label: string;
  value: string;
  sub: string;
  palette: ReturnType<typeof usePalette>;
  last?: boolean;
}) {
  return (
    <View
      style={[
        styles.statRow,
        !last && { borderBottomColor: palette.separator, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <SymbolView name={icon} tintColor={palette.accent} size={20} />
      <View style={styles.flex}>
        <Text style={{ color: palette.textSecondary, fontSize: 13 }}>{label}</Text>
        <Text style={{ color: palette.textPrimary, fontSize: 16, fontWeight: '600' }}>{value}</Text>
      </View>
      <Text style={{ color: palette.textTertiary, fontSize: 12, maxWidth: 120, textAlign: 'right' }}>{sub}</Text>
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
  title: { fontSize: 20, fontWeight: '700' },
  action: { fontSize: 16 },
  periodBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space[6],
    paddingBottom: Space[2],
  },
  periodLabel: { fontSize: 17, fontWeight: '600', minWidth: 180, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space[2] },
  content: { paddingHorizontal: Space[4], paddingBottom: Space[12], gap: Space[3] },
  hero: { padding: Space[5], borderRadius: Radius.lg, alignItems: 'center', gap: Space[1] },
  balance: { fontSize: 36, fontWeight: '700', fontVariant: ['tabular-nums'] },
  heroRow: { flexDirection: 'row', justifyContent: 'space-around', alignSelf: 'stretch', marginTop: Space[3] },
  heroStat: { alignItems: 'center', gap: 2 },
  card: { borderRadius: Radius.lg, paddingHorizontal: Space[4] },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: Space[3], paddingVertical: Space[3] },
  warmCard: { flexDirection: 'row', alignItems: 'center', gap: Space[2], padding: Space[4], borderRadius: Radius.lg },
  warmText: { flex: 1, fontSize: 14, lineHeight: 20 },
  footnote: { fontSize: 12, textAlign: 'center', paddingTop: Space[1] },
});
