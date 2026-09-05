/**
 * 月度总结（流程 9 / PRD §11.5.2）：独立 push 页（`/summary`）、可翻月的单一视图。
 * 用户会久留、来回翻月查看数据，故为带返回头的独立页面，而非 Modal（DESIGN §9.9 规则 3）。
 * 入口＝首页 hero「本月脉搏卡」整卡点击，默认落地「本月至今」实例（实时计算，
 * 进行中语气、不提供保存图片）；左右翻月（chevron / 横滑）看历史，上月及更早为
 * 「已结算」仪式实例（保留全部字段 + 暖心文案，保存图片发布前补齐）。
 * 口径：总收支结余含储蓄类（对账）；最大单笔 / 最高分类按日常消费（排除储蓄类）。
 * 使用服务端实时聚合；不依赖 monthly_summaries 快照表，也不从客户端的有限流水缓存累计。
 */
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { ActivityIndicator, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCategories, useFamilyMembers, useMonthlySummary, useMyFamily, useMyProfile } from '@/api';
import { Radius, Space, usePalette } from '@/constants/design';
import { displayCategoryName, t, useLocalePreference } from '@/i18n';
import { currentPeriod, currentPeriodInTimeZone, formatAmount, formatMonthDay, signForNet } from '@/lib/format';

const WARM_KEYS_SETTLED = [
  'summary.warmCount',
  'summary.warmTop',
  'summary.warmDays',
  'summary.warmRecorder',
  'summary.warmSee',
] as const;
const WARM_KEYS_PROGRESS = [
  'summary.warmCountNow',
  'summary.warmTopNow',
  'summary.warmKeep',
  'summary.warmRecorderNow',
  'summary.warmSurprise',
] as const;

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
  return t('dates.yearMonth', { year: y, month: m });
}

export function MonthlySummaryScreen({ initialPeriod, onClose }: { initialPeriod?: string; onClose: () => void }) {
  return <Screen initialPeriod={initialPeriod} onClose={onClose} />;
}

function Screen({ initialPeriod, onClose }: { initialPeriod?: string; onClose: () => void }) {
  const palette = usePalette();
  const { locale } = useLocalePreference();
  const catsQ = useCategories();
  const familyQ = useMyFamily();
  const membersQ = useFamilyMembers();
  const profileQ = useMyProfile();

  const cur = currentPeriodInTimeZone(familyQ.data?.timezone);
  const [period, setPeriod] = useState(initialPeriod && initialPeriod <= cur ? initialPeriod : cur);
  const summaryQ = useMonthlySummary(period);

  // 翻月下界：最早一笔流水所在月（无数据时为本月）。
  const minPeriod = summaryQ.data?.earliest_period ?? cur;

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
    void locale;
    const catById = new Map((catsQ.data ?? []).map((c) => [c.id, c]));
    const memById = new Map((membersQ.data ?? []).map((m) => [m.id, m.nickname]));
    const myId = profileQ.data?.id;
    const data = summaryQ.data;
    if (!data || data.transaction_count === 0) return null;
    const topCategory = data.top_category_id
      ? {
          name: (() => {
            const cat = catById.get(data.top_category_id as string);
            return cat ? displayCategoryName(cat.name, cat.is_system) : t('common.uncategorized');
          })(),
          amount: data.top_category_amount ?? 0,
          pct:
            data.consumption_expense_amount > 0
              ? Math.round(((data.top_category_amount ?? 0) / data.consumption_expense_amount) * 100)
              : 0,
        }
      : null;
    const maxExpense = data.max_expense_id
      ? {
          amount: data.max_expense_amount ?? 0,
          category: (() => {
            const cat = data.max_expense_category_id ? catById.get(data.max_expense_category_id) : undefined;
            return cat ? displayCategoryName(cat.name, cat.is_system) : t('common.uncategorized');
          })(),
          date: data.max_expense_occurred_at ? formatMonthDay(data.max_expense_occurred_at) : '',
        }
      : null;
    const topRecorder = data.top_recorder_user_id
      ? {
          name:
            data.top_recorder_user_id === myId
              ? t('common.me')
              : (memById.get(data.top_recorder_user_id) ?? t('common.member')),
          count: data.top_recorder_count ?? 0,
        }
      : null;
    const mom = (value: number, previous: number): number | null =>
      previous > 0 ? Math.round(((value - previous) / previous) * 100) : null;
    const pool = isCurrent ? WARM_KEYS_PROGRESS : WARM_KEYS_SETTLED;
    const warmKey = pool[(Number(period.slice(0, 4)) + Number(period.slice(5))) % pool.length];
    return {
      count: data.transaction_count,
      totalExpense: data.expense_amount,
      totalIncome: data.income_amount,
      balance: data.income_amount - data.expense_amount,
      maxExpense,
      topCategory,
      topRecorder,
      momExpense: mom(data.expense_amount, data.previous_expense_amount),
      momIncome: mom(data.income_amount, data.previous_income_amount),
      warm: t(warmKey, {
        count: data.transaction_count,
        top: topCategory?.name ?? t('summary.life'),
        recorder: topRecorder?.name ?? t('summary.youAll'),
      }),
    };
  }, [summaryQ.data, catsQ.data, membersQ.data, profileQ.data, period, isCurrent, locale]);

  const title = isCurrent ? `${periodLabel(period)} · ${t('dates.untilToday')}` : periodLabel(period);
  const momText = (v: number | null) =>
    v == null ? '—' : v === 0 ? t('report.flat') : v > 0 ? `↑ ${v}%` : `↓ ${Math.abs(v)}%`;

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.flex}>
        <View style={styles.topBar}>
          <Pressable hitSlop={8} onPress={onClose} style={[styles.navBack, { backgroundColor: palette.cardPill }]}>
            <SymbolView name="chevron.left" tintColor={palette.textPrimary} size={17} weight="semibold" />
          </Pressable>
          <Text style={[styles.title, { color: palette.textPrimary }]}>{t('summary.title')}</Text>
          <View style={styles.navSide} />
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

        {summaryQ.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={palette.accent} />
          </View>
        ) : summaryQ.isError ? (
          <View style={styles.center}>
            <SymbolView name="exclamationmark.triangle" tintColor={palette.textTertiary} size={40} />
            <Text style={{ color: palette.textSecondary }}>{t('common.loadFailed')}</Text>
          </View>
        ) : !summary ? (
          <View style={styles.center} {...pan.panHandlers}>
            <SymbolView name="doc.text" tintColor={palette.textTertiary} size={48} />
            <Text style={{ color: palette.textSecondary }}>
              {isCurrent ? t('summary.noTxnsCurrent') : t('summary.noTxnsPast', { period: periodLabel(period) })}
            </Text>
            <Text style={{ color: palette.textTertiary, fontSize: 13 }}>
              {isCurrent ? t('summary.emptyAfterRecord') : t('summary.emptyPast')}
            </Text>
          </View>
        ) : (
          <View style={styles.flex} {...pan.panHandlers}>
            <ScrollView contentContainerStyle={styles.content}>
              <View style={[styles.hero, { backgroundColor: palette.card }]}>
                <Text style={[styles.balance, { color: palette.textPrimary }]}>
                  {formatAmount(summary.balance, signForNet(summary.balance))}
                </Text>
                <Text style={{ color: palette.textSecondary }}>
                  {isCurrent ? t('summary.balanceUntilToday') : t('summary.balanceMonth')}
                </Text>
                <View style={styles.heroRow}>
                  <HeroStat
                    label={t('record.expense')}
                    value={formatAmount(summary.totalExpense, '')}
                    color={palette.expense}
                    palette={palette}
                  />
                  <HeroStat
                    label={t('record.income')}
                    value={formatAmount(summary.totalIncome, '')}
                    color={palette.income}
                    palette={palette}
                  />
                  <HeroStat
                    label={t('summary.recordStat')}
                    value={t('report.countWithUnit', { count: summary.count })}
                    color={palette.textPrimary}
                    palette={palette}
                  />
                </View>
              </View>

              <View style={[styles.card, { backgroundColor: palette.card }]}>
                {summary.maxExpense ? (
                  <StatRow
                    icon="arrow.up.right"
                    label={t('summary.topExpense')}
                    value={`${formatAmount(summary.maxExpense.amount, '')}`}
                    sub={`${summary.maxExpense.category} · ${summary.maxExpense.date}`}
                    palette={palette}
                  />
                ) : null}
                {summary.topCategory ? (
                  <StatRow
                    icon="chart.pie.fill"
                    label={t('summary.topCategory')}
                    value={`${summary.topCategory.name} ${formatAmount(summary.topCategory.amount, '')}`}
                    sub={t('summary.topShare', { pct: summary.topCategory.pct })}
                    palette={palette}
                  />
                ) : null}
                {summary.topRecorder ? (
                  <StatRow
                    icon="pencil.circle.fill"
                    label={t('summary.topRecorder')}
                    value={summary.topRecorder.name}
                    sub={
                      isCurrent
                        ? t('summary.recordedSoFar', { count: summary.topRecorder.count })
                        : t('summary.recordedCount', { count: summary.topRecorder.count })
                    }
                    palette={palette}
                  />
                ) : null}
                <StatRow
                  icon="arrow.left.arrow.right"
                  label={t('summary.vsLastMonth')}
                  value={t('summary.vsExpense', { delta: momText(summary.momExpense) })}
                  sub={
                    isCurrent
                      ? t('summary.vsIncomeSame', { delta: momText(summary.momIncome) })
                      : t('summary.vsIncome', { delta: momText(summary.momIncome) })
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
                <Text style={[styles.footnote, { color: palette.textTertiary }]}>{t('summary.inProgressHint')}</Text>
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
  navBack: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navSide: { width: 36 },
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
