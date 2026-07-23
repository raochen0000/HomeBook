/**
 * P1 高级报表卡（PRD §11.5.1）：结余率仪表 / 累计同期对比 / 收支对比双柱 / 分类环比
 * / 大额支出 Top 5 / 收入结构。
 * 全部沿用已安装的 react-native-svg 自绘（与 donut.tsx / 趋势折线一致），不引入 Skia/Victory。
 * 口径：结余率 = 结余÷收入、收支对比（对账，含储蓄）；累计同期/分类环比为日常消费（排除储蓄类）；
 * 收入结构仅算 source=normal 收入（排除储蓄取出）。
 */
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, Path, Pattern, Polyline, Rect, Text as SvgText } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Radius, Space, usePalette } from '@/constants/design';
import { Donut } from '@/features/report/donut';
import { formatAmount, maskAmount, signForNet } from '@/lib/format';
import type { CumulativeSeries, PeriodFlow } from '@/lib/report';

type Palette = ReturnType<typeof usePalette>;
type Sym = SymbolViewProps['name'];

export type MomItem = { id: string; name: string; color: string; symbol: string; cur: number; prev: number };
export type TopItem = {
  id: string;
  note: string;
  category: string;
  color: string;
  symbol: string;
  amount: number;
  date: string;
};
export type IncomeSlice = { id: string; name: string; color: string; symbol: string; amount: number };

// ── 极坐标 / 弧线 helper（仪表用）──────────────────────────────────────────────
function polar(cx: number, cy: number, r: number, deg: number): readonly [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
}
function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const [x0, y0] = polar(cx, cy, r, startDeg);
  const [x1, y1] = polar(cx, cy, r, endDeg);
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  const sweep = endDeg < startDeg ? 1 : 0; // 角度递减 = 屏幕顺时针（沿上半圆）
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} ${sweep} ${x1} ${y1}`;
}

function chartTicks(max: number, count = 3): number[] {
  const top = Math.max(1, max);
  return Array.from({ length: count }, (_, index) => Math.round((top * (count - 1 - index)) / (count - 1)));
}

function axisAmountLabel(value: number): string {
  const yuan = Math.round(value / 100);
  if (yuan >= 10000) return `${Math.round(yuan / 1000) / 10}万`;
  if (yuan >= 1000) return `${Math.round(yuan / 100) / 10}k`;
  return String(yuan);
}

function SvgYAxis({
  ticks,
  width,
  yOf,
  chartRight,
  color,
  gridColor,
}: {
  ticks: number[];
  width: number;
  yOf: (value: number) => number;
  chartRight: number;
  color: string;
  gridColor: string;
}) {
  return (
    <>
      {ticks.map((tick) => {
        const y = yOf(tick);
        return (
          <G key={tick}>
            <Line x1={width + 6} y1={y} x2={chartRight} y2={y} stroke={gridColor} strokeWidth="1" opacity={0.42} />
            <SvgText x={width} y={y + 3} fontSize="9" fill={color} textAnchor="end">
              {axisAmountLabel(tick)}
            </SvgText>
          </G>
        );
      })}
    </>
  );
}

// ── 结余率仪表 ────────────────────────────────────────────────────────────────
export function BalanceGaugeCard({ rate, palette }: { rate: number | null; palette: Palette }) {
  const W = 280;
  const H = 160;
  const cx = W / 2;
  const cy = 140;
  const r = 108;
  const sw = 18;
  const over = rate != null && rate < 0;
  const frac = rate == null ? 0 : Math.max(0, Math.min(1, rate));
  const pct = rate == null ? '—' : `${Math.round(Math.abs(rate) * 100)}%`;
  const fillColor = over ? palette.danger : palette.info;

  return (
    <View style={[styles.card, { backgroundColor: palette.card }]}>
      <ThemedText style={[styles.title, { color: palette.textPrimary }]}>结余率</ThemedText>
      <View style={styles.gaugeWrap}>
        <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
          <Path
            d={arcPath(cx, cy, r, 180, 0)}
            stroke={palette.base}
            strokeWidth={sw}
            fill="none"
            strokeLinecap="round"
          />
          {rate != null && frac > 0 ? (
            <Path
              d={arcPath(cx, cy, r, 180, 180 - frac * 180)}
              stroke={fillColor}
              strokeWidth={sw}
              fill="none"
              strokeLinecap="round"
            />
          ) : null}
        </Svg>
        <View style={styles.gaugeCenter} pointerEvents="none">
          {rate == null ? (
            <ThemedText style={[styles.gaugeHint, { color: palette.textTertiary }]}>暂无收入</ThemedText>
          ) : (
            <>
              <ThemedText
                style={[styles.gaugePct, { color: over ? palette.danger : palette.textPrimary }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.72}
              >
                {over ? `超支 ${pct}` : pct}
              </ThemedText>
              <ThemedText style={[styles.gaugeSub, { color: palette.textSecondary }]}>结余 ÷ 收入</ThemedText>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

// ── 累计同期对比（双线）────────────────────────────────────────────────────────
export function CumulativeCard({
  series,
  palette,
  hidden,
}: {
  series: CumulativeSeries;
  palette: Palette;
  hidden?: boolean;
}) {
  const W = 320;
  const H = 132;
  const axisW = 34;
  const chartRight = W - 2;
  const padY = 14;
  const n = series.labels.length;
  const currVals = series.curr.filter((v): v is number => v != null);
  const max = Math.max(1, ...currVals, ...series.prev);
  const hasData = currVals.some((v) => v > 0) || series.prev.some((v) => v > 0);
  const stepX = n > 1 ? (chartRight - axisW) / (n - 1) : 0;
  const xOf = (i: number) => axisW + i * stepX;
  const yOf = (v: number) => padY + (H - padY * 2) * (1 - v / max);
  const ticks = chartTicks(max);

  const currPts = series.curr
    .map((v, i) => (v == null ? null : `${xOf(i)},${yOf(v)}`))
    .filter((p): p is string => p != null)
    .join(' ');
  const prevPts = series.prev.map((v, i) => `${xOf(i)},${yOf(v)}`).join(' ');
  const labelEvery = Math.max(1, Math.ceil(n / 6));

  const delta =
    series.prevToDate > 0 ? Math.round(((series.currToDate - series.prevToDate) / series.prevToDate) * 100) : null;
  const deltaText =
    delta == null
      ? '上期同期无消费'
      : delta === 0
        ? '与上期同期持平'
        : `较上期同期 ${delta > 0 ? '↑' : '↓'} ${Math.abs(delta)}%`;
  const deltaColor = delta == null ? palette.textTertiary : delta > 0 ? palette.danger : palette.expense;

  return (
    <View style={[styles.card, { backgroundColor: palette.card }]}>
      <View style={styles.legendRow}>
        <ThemedText style={[styles.title, { color: palette.textPrimary }]}>累计同期对比</ThemedText>
        <View style={styles.flex} />
        <LegendDot color={palette.expense} label="本期" palette={palette} />
        <LegendDot color={palette.textTertiary} label="上期" palette={palette} dashed />
      </View>
      {!hasData ? (
        <View style={styles.empty}>
          <SymbolView name="chart.line.uptrend.xyaxis" tintColor={palette.textTertiary} size={36} />
          <ThemedText style={{ color: palette.textSecondary }}>这个周期还没有消费</ThemedText>
        </View>
      ) : (
        <>
          <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
            <SvgYAxis
              ticks={ticks}
              width={axisW - 8}
              yOf={yOf}
              chartRight={chartRight}
              color={palette.textTertiary}
              gridColor={palette.separator}
            />
            {prevPts ? (
              <Polyline
                points={prevPts}
                fill="none"
                stroke={palette.textTertiary}
                strokeWidth={1.5}
                strokeDasharray="4 4"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null}
            {currPts ? (
              <Polyline
                points={currPts}
                fill="none"
                stroke={palette.expense}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null}
          </Svg>
          <View style={[styles.trendLabels, { paddingLeft: axisW }]}>
            {series.labels.map((l, i) => (
              <Text key={i} style={[styles.trendLabel, { color: palette.textTertiary }]}>
                {i % labelEvery === 0 ? l : ''}
              </Text>
            ))}
          </View>
          <ThemedText style={[styles.cumCaption, { color: palette.textSecondary }]}>
            本期至今 {maskAmount(formatAmount(series.currToDate, ''), !!hidden)} ·{' '}
            <Text style={{ color: deltaColor }}>{deltaText}</Text>
          </ThemedText>
        </>
      )}
    </View>
  );
}

function LegendDot({
  color,
  label,
  palette,
  dashed,
}: {
  color: string;
  label: string;
  palette: Palette;
  dashed?: boolean;
}) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendLine, { backgroundColor: color, opacity: dashed ? 0.7 : 1 }]} />
      <Text style={[styles.legendText, { color: palette.textSecondary }]}>{label}</Text>
    </View>
  );
}

// ── 收支趋势（近 6 期分组双柱 + 结余折线）───────────────────────────────────────
export function IncomeExpenseCard({
  series,
  palette,
  hidden,
  currentPeriod,
}: {
  series: PeriodFlow[];
  palette: Palette;
  hidden?: boolean;
  /** 当前期进行中时，末位柱形使用斜纹，并补充口径说明。 */
  currentPeriod?: boolean;
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const W = 320;
  const H = 150;
  const axisW = 34;
  const chartRight = W - 2;
  const padY = 14;
  const n = series.length;
  const max = Math.max(1, ...series.flatMap((s) => [s.income, s.expense]));
  const nonZeroCount = series.filter((s) => s.income > 0 || s.expense > 0).length;
  const hasData = nonZeroCount >= 2;
  const groupW = (chartRight - axisW) / n;
  const barW = Math.min(13, groupW / 3.2);
  const gap = 4;
  const chartBottom = H - 16;
  // 有值的柱至少 2px，避免小额完全不可见。
  const hOf = (v: number) => (v > 0 ? Math.max(2, ((chartBottom - padY) * v) / max) : 0);

  const cur = series[n - 1];
  const balance = cur.income - cur.expense;
  const balances = series.map((s) => s.income - s.expense);
  const minBalance = Math.min(0, ...balances);
  const maxBalance = Math.max(0, ...balances);
  const balanceSpan = Math.max(1, maxBalance - minBalance);
  const balanceY = (value: number) => padY + ((maxBalance - value) / balanceSpan) * (chartBottom - padY);
  const balancePoints = balances.map((value, i) => `${axisW + groupW * i + groupW / 2},${balanceY(value)}`).join(' ');
  const focusedIndex = selectedIndex ?? n - 1;
  const focused = series[focusedIndex];
  const focusedBalance = focused.income - focused.expense;
  const ticks = chartTicks(max);

  return (
    <View style={[styles.card, { backgroundColor: palette.card }]}>
      <View style={styles.legendRow}>
        <ThemedText style={[styles.title, { color: palette.textPrimary }]}>收支趋势</ThemedText>
        <View style={styles.flex} />
        <LegendDot color={palette.income} label="收入" palette={palette} />
        <LegendDot color={palette.expense} label="支出" palette={palette} />
        <LegendDot color={palette.warning} label="结余" palette={palette} />
      </View>
      {!hasData ? (
        <View style={styles.empty}>
          <SymbolView name="chart.bar.xaxis" tintColor={palette.textTertiary} size={36} />
          <ThemedText style={{ color: palette.textSecondary, textAlign: 'center' }}>
            当前只有 {nonZeroCount} 个周期有收支记录；再积累到 2 个以上周期后展示趋势。
          </ThemedText>
        </View>
      ) : (
        <>
          <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
            <Defs>
              <Pattern id="current-month-stripe" width="8" height="8" patternUnits="userSpaceOnUse">
                <Line x1="-2" y1="8" x2="8" y2="-2" stroke="#FFFFFF" strokeWidth="2" opacity="0.28" />
                <Line x1="2" y1="12" x2="12" y2="2" stroke="#FFFFFF" strokeWidth="2" opacity="0.28" />
              </Pattern>
            </Defs>
            <SvgYAxis
              ticks={ticks}
              width={axisW - 8}
              yOf={(value) => chartBottom - ((chartBottom - padY) * value) / max}
              chartRight={chartRight}
              color={palette.textTertiary}
              gridColor={palette.separator}
            />
            <Line
              x1={axisW}
              y1={chartBottom}
              x2={chartRight}
              y2={chartBottom}
              stroke={palette.separator}
              strokeWidth="1"
            />
            {series.map((s, i) => {
              const groupX = axisW + groupW * i;
              const cx = groupX + groupW / 2;
              const ih = hOf(s.income);
              const eh = hOf(s.expense);
              const isCurrent = currentPeriod && i === n - 1;
              return (
                <G key={i}>
                  {isCurrent ? (
                    <Rect
                      x={groupX + 4}
                      y={0}
                      width={groupW - 8}
                      height={chartBottom + 5}
                      rx={10}
                      fill={palette.info}
                      opacity={0.18}
                    />
                  ) : null}
                  {ih > 0 ? (
                    <>
                      <Rect
                        x={cx - gap / 2 - barW}
                        y={chartBottom - ih}
                        width={barW}
                        height={ih}
                        rx={2.5}
                        fill={palette.income}
                      />
                      {isCurrent ? (
                        <Rect
                          x={cx - gap / 2 - barW}
                          y={chartBottom - ih}
                          width={barW}
                          height={ih}
                          rx={2.5}
                          fill="url(#current-month-stripe)"
                        />
                      ) : null}
                    </>
                  ) : null}
                  {eh > 0 ? (
                    <>
                      <Rect
                        x={cx + gap / 2}
                        y={chartBottom - eh}
                        width={barW}
                        height={eh}
                        rx={2.5}
                        fill={palette.expense}
                      />
                      {isCurrent ? (
                        <Rect
                          x={cx + gap / 2}
                          y={chartBottom - eh}
                          width={barW}
                          height={eh}
                          rx={2.5}
                          fill="url(#current-month-stripe)"
                        />
                      ) : null}
                    </>
                  ) : null}
                  <Rect
                    x={groupX}
                    y={0}
                    width={groupW}
                    height={chartBottom + 12}
                    fill="transparent"
                    onPress={() => setSelectedIndex(i)}
                    accessibilityLabel={`${s.label}，收入 ${formatAmount(s.income, '+')}，支出 ${formatAmount(s.expense, '-')}，结余 ${formatAmount(s.income - s.expense, signForNet(s.income - s.expense))}`}
                  />
                </G>
              );
            })}
            <Polyline
              points={balancePoints}
              fill="none"
              stroke={palette.warning}
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {balances.map((value, i) => (
              <Circle key={i} cx={axisW + groupW * i + groupW / 2} cy={balanceY(value)} r={3} fill={palette.warning} />
            ))}
          </Svg>
          <View style={[styles.trendLabels, { paddingLeft: axisW }]}>
            {series.map((s, i) => (
              <Text
                key={i}
                style={[
                  styles.trendLabel,
                  { color: i === n - 1 && currentPeriod ? palette.info : palette.textTertiary },
                ]}
              >
                {s.label}
              </Text>
            ))}
          </View>
          <ThemedText style={[styles.cumCaption, { color: palette.textSecondary }]}>
            {selectedIndex == null && currentPeriod
              ? '斜纹为当前期，数据为累计值；点按柱形查看精确值。'
              : `${focused.label}：收入 `}
            {selectedIndex == null && currentPeriod ? null : (
              <Text style={{ color: palette.income, fontWeight: '600' }}>
                {maskAmount(formatAmount(focused.income, '+'), !!hidden)}
              </Text>
            )}
            {selectedIndex == null && currentPeriod ? null : ' · 支出 '}
            {selectedIndex == null && currentPeriod ? null : (
              <Text style={{ color: palette.expense, fontWeight: '600' }}>
                {maskAmount(formatAmount(focused.expense, '-'), !!hidden)}
              </Text>
            )}
            {selectedIndex == null && currentPeriod ? null : ' · 结余 '}
            {selectedIndex == null && currentPeriod ? null : (
              <Text style={{ color: focusedBalance < 0 ? palette.danger : palette.textPrimary, fontWeight: '600' }}>
                {maskAmount(formatAmount(focusedBalance, signForNet(focusedBalance)), !!hidden)}
              </Text>
            )}
            {selectedIndex == null && !currentPeriod ? '本期结余 ' : null}
            {selectedIndex == null && !currentPeriod ? (
              <Text style={{ color: balance < 0 ? palette.danger : palette.textPrimary, fontWeight: '600' }}>
                {maskAmount(formatAmount(balance, signForNet(balance)), !!hidden)}
              </Text>
            ) : null}
          </ThemedText>
        </>
      )}
    </View>
  );
}

// ── 分类环比 ──────────────────────────────────────────────────────────────────
export function CategoryMomCard({ items, palette, hidden }: { items: MomItem[]; palette: Palette; hidden?: boolean }) {
  if (items.length === 0) return null;
  return (
    <View style={[styles.card, { backgroundColor: palette.card }]}>
      <ThemedText style={[styles.title, { color: palette.textPrimary }]}>分类环比</ThemedText>
      <View style={styles.list}>
        {items.map((it, i) => {
          const isNew = it.prev === 0 && it.cur > 0;
          const gone = it.cur === 0 && it.prev > 0;
          const pct = it.prev > 0 ? Math.round(((it.cur - it.prev) / it.prev) * 100) : 0;
          const up = it.cur >= it.prev;
          const chipColor = isNew ? palette.danger : gone ? palette.expense : up ? palette.danger : palette.expense;
          const chipText = isNew
            ? '新增'
            : gone
              ? '↓ 100%'
              : pct === 0
                ? '持平'
                : `${up ? '↑' : '↓'} ${Math.abs(pct)}%`;
          return (
            <View key={it.id}>
              {i > 0 ? <View style={[styles.divider, { backgroundColor: palette.separator }]} /> : null}
              <View style={styles.momRow}>
                <View style={[styles.dot, { backgroundColor: it.color }]}>
                  <SymbolView name={it.symbol as Sym} tintColor="#FFFFFF" size={15} />
                </View>
                <ThemedText style={[styles.itemName, { color: palette.textPrimary }]} numberOfLines={1}>
                  {it.name}
                </ThemedText>
                <View style={styles.flex} />
                <ThemedText style={[styles.itemAmount, { color: palette.textPrimary }]}>
                  {maskAmount(formatAmount(it.cur, ''), !!hidden)}
                </ThemedText>
                <Text style={[styles.chip, { color: chipColor }]}>{chipText}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ── 大额支出 Top 5 ────────────────────────────────────────────────────────────
export function TopExpensesCard({ items, palette, hidden }: { items: TopItem[]; palette: Palette; hidden?: boolean }) {
  if (items.length === 0) return null;
  const max = Math.max(1, ...items.map((i) => i.amount));
  return (
    <View style={[styles.card, { backgroundColor: palette.card }]}>
      <ThemedText style={[styles.title, { color: palette.textPrimary }]}>大额支出 Top {items.length}</ThemedText>
      <View style={styles.list}>
        {items.map((it, i) => (
          <View key={it.id} style={styles.topItem}>
            <View style={styles.topRow}>
              <Text style={[styles.rank, { color: palette.textTertiary }]}>{i + 1}</Text>
              <View style={[styles.dot, { backgroundColor: it.color }]}>
                <SymbolView name={it.symbol as Sym} tintColor="#FFFFFF" size={15} />
              </View>
              <View style={styles.flex}>
                <ThemedText style={[styles.itemName, { color: palette.textPrimary }]} numberOfLines={1}>
                  {it.note || it.category}
                </ThemedText>
                <Text style={[styles.topSub, { color: palette.textSecondary }]}>
                  {it.category} · {it.date}
                </Text>
              </View>
              <ThemedText style={[styles.itemAmount, { color: palette.textPrimary }]}>
                {maskAmount(formatAmount(it.amount, '-'), !!hidden)}
              </ThemedText>
            </View>
            <View style={[styles.barTrack, { backgroundColor: palette.base }]}>
              <View style={[styles.barFill, { backgroundColor: it.color, width: `${(it.amount / max) * 100}%` }]} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── 收入结构 ──────────────────────────────────────────────────────────────────
export function IncomeStructureCard({
  slices,
  palette,
  hidden,
}: {
  slices: IncomeSlice[];
  palette: Palette;
  hidden?: boolean;
}) {
  if (slices.length === 0) return null;
  const total = slices.reduce((s, x) => s + x.amount, 0);
  return (
    <View style={[styles.card, { backgroundColor: palette.card }]}>
      <ThemedText style={[styles.title, { color: palette.textPrimary }]}>收入结构</ThemedText>
      <View style={styles.donutWrap}>
        <Donut slices={slices.map((s) => ({ value: s.amount, color: s.color }))} trackColor={palette.base}>
          <ThemedText style={[styles.donutCaption, { color: palette.textSecondary }]}>总收入</ThemedText>
          <ThemedText style={[styles.donutTotal, { color: palette.textPrimary }]}>
            {maskAmount(formatAmount(total, ''), !!hidden)}
          </ThemedText>
        </Donut>
      </View>
      <View style={styles.list}>
        {slices.map((s, i) => {
          const pct = total > 0 ? Math.round((s.amount / total) * 100) : 0;
          return (
            <View key={s.id}>
              {i > 0 ? <View style={[styles.divider, { backgroundColor: palette.separator }]} /> : null}
              <View style={styles.momRow}>
                <View style={[styles.dot, { backgroundColor: s.color }]}>
                  <SymbolView name={s.symbol as Sym} tintColor="#FFFFFF" size={15} />
                </View>
                <ThemedText style={[styles.itemName, { color: palette.textPrimary }]} numberOfLines={1}>
                  {s.name}
                </ThemedText>
                <ThemedText style={[styles.pct, { color: palette.textSecondary }]}>{pct}%</ThemedText>
                <View style={styles.flex} />
                <ThemedText style={[styles.itemAmount, { color: palette.income }]}>
                  {maskAmount(formatAmount(s.amount, ''), !!hidden)}
                </ThemedText>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { borderRadius: Radius.lg, padding: Space[4] },
  title: { fontSize: 17, fontWeight: '600', marginBottom: Space[3] },
  empty: { alignItems: 'center', justifyContent: 'center', gap: Space[2], paddingVertical: Space[6] },
  list: { marginTop: Space[1] },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 40 },
  dot: { width: 28, height: 28, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  itemName: { fontSize: 16, fontWeight: '500' },
  itemAmount: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  pct: { fontSize: 13, fontVariant: ['tabular-nums'], marginLeft: Space[2] },
  // 仪表
  gaugeWrap: { alignItems: 'center', justifyContent: 'center', minHeight: 160 },
  gaugeCenter: { position: 'absolute', left: Space[2], right: Space[2], top: 74, alignItems: 'center' },
  gaugePct: {
    alignSelf: 'stretch',
    textAlign: 'center',
    fontSize: 34,
    fontWeight: '700',
    lineHeight: 40,
    fontVariant: ['tabular-nums'],
  },
  gaugeSub: { fontSize: 14, marginTop: 2 },
  gaugeHint: { fontSize: 17, fontWeight: '600' },
  // 累计同期
  legendRow: { flexDirection: 'row', alignItems: 'center', marginBottom: Space[3] },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Space[1], marginLeft: Space[3] },
  legendLine: { width: 14, height: 3, borderRadius: Radius.full },
  legendText: { fontSize: 12 },
  trendLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Space[1] },
  trendLabel: { fontSize: 10, flex: 1, textAlign: 'center' },
  cumCaption: { fontSize: 13, marginTop: Space[3], textAlign: 'center' },
  // 分类环比
  momRow: { flexDirection: 'row', alignItems: 'center', gap: Space[3], paddingVertical: Space[3] },
  chip: {
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    marginLeft: Space[3],
    minWidth: 56,
    textAlign: 'right',
  },
  // Top N
  topItem: { paddingVertical: Space[3], gap: Space[2] },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: Space[3] },
  rank: { width: 16, fontSize: 15, fontWeight: '700', textAlign: 'center', fontVariant: ['tabular-nums'] },
  topSub: { fontSize: 12, marginTop: 2 },
  barTrack: { height: 6, borderRadius: Radius.full, overflow: 'hidden', marginLeft: 35 },
  barFill: { height: '100%', borderRadius: Radius.full },
  // 收入结构 donut
  donutWrap: { alignItems: 'center', paddingVertical: Space[2] },
  donutCaption: { fontSize: 12 },
  donutTotal: { fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
