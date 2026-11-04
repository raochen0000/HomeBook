import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PageSheet } from '@/components/page-sheet';
import { SHEET_CONTENT_TOP_PADDING, SheetHeader } from '@/components/sheet-header';
import { Radius, Space, usePalette, useSheetPalette } from '@/constants/design';
import { t } from '@/i18n';
import { formatAmount, maskAmount } from '@/lib/format';
import { type Dimension } from '@/lib/report';
import { buildExpensePeriodStats, type ExpenseDay } from './more-stats';

type Range = { start: Date; end: Date };
type Palette = ReturnType<typeof usePalette>;
type Props = { days: ExpenseDay[]; range: Range; today: Date; hidden: boolean };

function periodLabel(range: Range) {
  const end = new Date(range.end);
  end.setDate(end.getDate() - 1);
  const label = (d: Date) => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  return `${label(range.start)} – ${label(end)}`;
}
function amount(value: number, hidden: boolean) {
  return maskAmount(formatAmount(Math.round(value), ''), hidden);
}

export function MoreStatsEntryCard({
  days,
  range,
  today,
  palette,
  onPress,
}: Props & { palette: Palette; onPress: () => void }) {
  const stats = useMemo(() => buildExpensePeriodStats(days, range, today), [days, range, today]);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.entry, { backgroundColor: palette.card, opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={[styles.icon, { backgroundColor: palette.cardPill }]}>
        <SymbolView name="calendar.badge.clock" tintColor={palette.accent} size={22} />
      </View>
      <View style={styles.flex}>
        <Text style={[styles.title, { color: palette.textPrimary }]}>{t('report.moreStats')}</Text>
        <Text style={[styles.meta, { color: palette.textSecondary }]}>{periodLabel(range)}</Text>
        <Text style={[styles.meta, { color: palette.textSecondary }]}>
          {t('report.expenseDays', { count: stats.recordedDays })}
        </Text>
      </View>
      <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={16} />
    </Pressable>
  );
}

export function MoreStatsSheet({
  visible,
  onClose,
  dimension,
  ...props
}: Props & { visible: boolean; onClose: () => void; dimension: Dimension }) {
  const palette = useSheetPalette();
  const { width } = useWindowDimensions();
  const stats = useMemo(
    () => buildExpensePeriodStats(props.days, props.range, props.today),
    [props.days, props.range, props.today],
  );
  const monthKeys = Array.from(new Set(stats.days.map((day) => day.date.slice(0, 7))));
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const short = dimension === 'week' || (dimension === 'custom' && stats.days.length <= 7);
  const calendar = dimension === 'month';
  const visibleDays =
    short || calendar ? stats.days : stats.days.filter((day) => day.date.startsWith(selectedMonth ?? '---'));
  const selected = stats.days.find((day) => day.date === selectedDate && visibleDays.includes(day));
  const peak = stats.days.reduce((max, day) => Math.max(max, day.amount), 1);
  const showRhythm = stats.days.filter((day) => !day.future).length >= 14 && stats.recordedDays >= 2;
  const weekdayTotals = Array.from({ length: 7 }, () => 0);
  for (const day of stats.days) {
    if (!day.future) {
      const [year, month, date] = day.date.split('-').map(Number);
      weekdayTotals[new Date(year, month - 1, date).getDay()] += day.amount;
    }
  }
  const weekdayKeys = [
    'dates.weekdaySun',
    'dates.weekdayMon',
    'dates.weekdayTue',
    'dates.weekdayWed',
    'dates.weekdayThu',
    'dates.weekdayFri',
    'dates.weekdaySat',
  ];
  const firstDate = visibleDays[0]?.date;
  const firstParts = firstDate?.split('-').map(Number);
  const offset = firstParts ? (new Date(firstParts[0], firstParts[1] - 1, firstParts[2]).getDay() + 6) % 7 : 0;
  const heatOffset = (props.range.start.getDay() + 6) % 7;
  const heatColumns = Math.ceil((heatOffset + stats.days.length) / 7);
  const labelFor = (day: (typeof stats.days)[number]) =>
    `${day.date} · ${day.future ? t('report.futureDay') : day.amount > 0 ? amount(day.amount, props.hidden) : t('report.noExpenseDay')}`;
  return (
    <PageSheet visible={visible} onClose={onClose}>
      <View style={[styles.flex, { backgroundColor: palette.base }]}>
        <SafeAreaView edges={['top', 'left', 'right']} style={styles.flex}>
          <ScrollView contentContainerStyle={styles.content}>
            <View style={[styles.card, { backgroundColor: palette.card }]}>
              <Text style={[styles.title, { color: palette.textPrimary }]}>{t('report.expenseStats')}</Text>
              <Text style={[styles.meta, { color: palette.textSecondary }]}>
                {periodLabel(props.range)}
                {props.today >= props.range.start && props.today < props.range.end
                  ? ` · ${t('report.periodOngoing')}`
                  : ''}
              </Text>
              <Text style={[styles.body, { color: palette.textPrimary }]}>
                {t('report.expenseDays', { count: stats.recordedDays })}
              </Text>
              <Text style={[styles.meta, { color: palette.textSecondary }]}>
                {stats.recordedDayAverage === null
                  ? t('report.noExpenseStats')
                  : t('report.expenseDayAvg', { amount: amount(stats.recordedDayAverage, props.hidden) })}
              </Text>
            </View>
            {dimension === 'year' && (
              <View style={[styles.card, { backgroundColor: palette.card }]}>
                <Text style={[styles.title, { color: palette.textPrimary }]}>{t('report.annualHeat')}</Text>
                <Text style={[styles.meta, { color: palette.textSecondary }]}>{t('report.annualHeatHint')}</Text>
                <View accessible accessibilityLabel={t('report.annualHeatAccessible', { count: stats.recordedDays })}>
                  {Array.from({ length: 7 }, (_, row) => (
                    <View key={row} style={styles.heatRow}>
                      {Array.from({ length: heatColumns }, (_, column) => {
                        const day = stats.days[column * 7 + row - heatOffset];
                        return (
                          <View
                            key={column}
                            style={[
                              styles.heatCell,
                              {
                                backgroundColor: !day
                                  ? 'transparent'
                                  : day.future
                                    ? palette.textTertiary
                                    : day.amount > 0
                                      ? palette.expense
                                      : palette.base,
                                opacity: !day
                                  ? 0
                                  : day.future
                                    ? 0.25
                                    : day.amount > 0 && !props.hidden
                                      ? 0.35 + (0.65 * day.amount) / peak
                                      : 1,
                              },
                            ]}
                          />
                        );
                      })}
                    </View>
                  ))}
                </View>
              </View>
            )}
            {!short && !calendar && (
              <View style={[styles.card, { backgroundColor: palette.card }]}>
                <Text style={[styles.title, { color: palette.textPrimary }]}>{t('report.monthlyExpense')}</Text>
                <Text style={[styles.meta, { color: palette.textSecondary }]}>{t('report.monthlyExpenseHint')}</Text>
                {monthKeys.map((monthKey) => {
                  const month = stats.months.find((item) => item.month === monthKey);
                  return (
                    <Pressable
                      key={monthKey}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: selectedMonth === monthKey }}
                      onPress={() => {
                        setSelectedMonth(selectedMonth === monthKey ? null : monthKey);
                        setSelectedDate(null);
                      }}
                      style={[styles.row, { borderBottomColor: palette.base }]}
                    >
                      <Text style={[styles.body, { color: palette.textPrimary }]}>{monthKey}</Text>
                      <Text style={[styles.body, { color: palette.textPrimary }]}>
                        {month ? amount(month.amount, props.hidden) : t('report.futureDay')} ›
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
            {visibleDays.length > 0 && (
              <View style={[styles.card, { backgroundColor: palette.card }]}>
                <Text style={[styles.title, { color: palette.textPrimary }]}>
                  {short ? t('report.dailyExpense') : t('report.expenseCalendar')}
                </Text>
                {short || width < 360 ? (
                  visibleDays.map((day) => (
                    <Text
                      key={day.date}
                      style={[styles.dailyRow, { color: palette.textPrimary, borderBottomColor: palette.base }]}
                    >
                      {labelFor(day)}
                    </Text>
                  ))
                ) : (
                  <>
                    <Text style={[styles.meta, { color: palette.textSecondary }]}>{t('report.calendarHint')}</Text>
                    <View style={styles.grid}>
                      {weekdayKeys
                        .slice(1)
                        .concat(weekdayKeys[0])
                        .map((weekday) => (
                          <Text key={weekday} style={[styles.weekday, { color: palette.textSecondary }]}>
                            {t(weekday)}
                          </Text>
                        ))}
                      {Array.from({ length: offset }, (_, index) => (
                        <View key={`empty-${index}`} style={styles.dayPlaceholder} />
                      ))}
                      {visibleDays.map((day) => (
                        <Pressable
                          key={day.date}
                          accessibilityRole="button"
                          accessibilityLabel={labelFor(day)}
                          accessibilityState={{ selected: selected?.date === day.date, disabled: day.future }}
                          disabled={day.future}
                          onPress={() => setSelectedDate(day.date)}
                          style={[
                            styles.day,
                            {
                              backgroundColor: palette.base,
                              borderColor: selected?.date === day.date ? palette.textPrimary : 'transparent',
                            },
                          ]}
                        >
                          <Text style={{ color: day.future ? palette.textTertiary : palette.textPrimary }}>
                            {Number(day.date.slice(-2))}
                          </Text>
                          {!day.future && day.amount > 0 && (
                            <View
                              style={{
                                width: 7,
                                height: 7,
                                borderRadius: 4,
                                backgroundColor: palette.expense,
                                opacity: props.hidden ? 1 : 0.35 + (0.65 * day.amount) / peak,
                              }}
                            />
                          )}
                        </Pressable>
                      ))}
                    </View>
                    <Text style={[styles.body, { color: palette.textPrimary }]}>
                      {selected ? labelFor(selected) : t('report.selectDate')}
                    </Text>
                  </>
                )}
              </View>
            )}
            {!short && (
              <View style={[styles.card, { backgroundColor: palette.card }]}>
                <Text style={[styles.title, { color: palette.textPrimary }]}>{t('report.spendingRhythmTitle')}</Text>
                {showRhythm ? (
                  <>
                    <Text style={[styles.body, { color: palette.textPrimary }]}>
                      {t('report.workdayAverage', {
                        count: stats.workday.days,
                        amount: stats.workday.average === null ? '—' : amount(stats.workday.average, props.hidden),
                      })}
                    </Text>
                    <Text style={[styles.body, { color: palette.textPrimary }]}>
                      {t('report.weekendAverage', {
                        count: stats.weekend.days,
                        amount: stats.weekend.average === null ? '—' : amount(stats.weekend.average, props.hidden),
                      })}
                    </Text>
                    <Text style={[styles.meta, { color: palette.textSecondary }]}>{t('report.rhythmNote')}</Text>
                    {weekdayKeys.map((weekday, index) => (
                      <Text key={weekday} style={[styles.body, { color: palette.textPrimary }]}>
                        {t(weekday)} · {amount(weekdayTotals[index], props.hidden)}
                      </Text>
                    ))}
                  </>
                ) : (
                  <Text style={[styles.meta, { color: palette.textSecondary }]}>{t('report.rhythmInsufficient')}</Text>
                )}
              </View>
            )}
          </ScrollView>
          <SheetHeader title={t('report.moreStats')} />
        </SafeAreaView>
      </View>
    </PageSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: Space[3], borderRadius: Radius.lg, padding: Space[4] },
  icon: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  content: {
    paddingHorizontal: Space[4],
    paddingTop: SHEET_CONTENT_TOP_PADDING,
    paddingBottom: Space[6],
    gap: Space[3],
  },
  card: { borderRadius: Radius.lg, padding: Space[4], gap: Space[2] },
  title: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22 },
  meta: { fontSize: 13, lineHeight: 19 },
  row: {
    minHeight: 48,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dailyRow: { minHeight: 44, paddingVertical: 12, fontSize: 15, borderBottomWidth: StyleSheet.hairlineWidth },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  heatRow: { flexDirection: 'row', gap: 1, marginBottom: 1 },
  heatCell: { flex: 1, aspectRatio: 1, borderRadius: 1 },
  weekday: { width: '14.2857%', textAlign: 'center', fontSize: 12 },
  dayPlaceholder: { width: '14.2857%', height: 44 },
  day: {
    width: '14.2857%',
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    borderWidth: 2,
  },
});
