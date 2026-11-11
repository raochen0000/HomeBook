import {
  Button as NativeButton,
  DatePicker,
  Host,
  HStack,
  Image as NativeImage,
  Popover,
  Spacer,
  Text as NativeText,
  VStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  buttonStyle,
  datePickerStyle,
  environment,
  foregroundColor,
  frame,
  labelsHidden,
  lineLimit,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import { useQuery } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Radius, Space, Typography, useSheetPalette } from '@/constants/design';
import { INTL_LOCALE, t, useLocalePreference } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { validateFilters, type SearchFilters, type TxnType } from '@/lib/search';
import { compactAmountFilterLabel, customDateFilterLabel, DATE_PRESET_LABELS } from '@/lib/search-labels';
import { AMOUNT_SLIDER_STEP, isValidAmountInput, moveAmountBound, SEARCH_DATE_PRESETS } from './filter-logic';
import { createAmountSliderSession, type AmountSliderDraft } from './amount-slider-session';

const ranges = [
  ['0', '100'],
  ['100', '500'],
  ['500', '1000'],
  ['1000', ''],
] as const;

function Card({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  const palette = useSheetPalette();
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.card, { backgroundColor: palette.card }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={styles.heading}
      >
        <Text style={[styles.title, { color: palette.textPrimary }]}>{title}</Text>
        <View style={styles.headingRight}>
          {!open && (
            <Text numberOfLines={1} style={{ color: palette.textSecondary, flexShrink: 1 }}>
              {summary}
            </Text>
          )}
          <SymbolView name={open ? 'chevron.down' : 'chevron.right'} size={14} tintColor={palette.textSecondary} />
        </View>
      </Pressable>
      {open && <View style={styles.body}>{children}</View>}
    </View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const palette = useSheetPalette();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: selected ? palette.accentTint : palette.cardPill }]}
    >
      <Text style={{ color: selected ? palette.accent : palette.textPrimary }}>{label}</Text>
    </Pressable>
  );
}

export function TypeFilterCard({
  filters,
  onType,
}: {
  filters: SearchFilters;
  onType: (type: TxnType | null) => void;
}) {
  const type = filters.types.has('expense') ? 'expense' : filters.types.has('income') ? 'income' : null;
  const label = type ? t(type === 'expense' ? 'record.expense' : 'record.income') : t('common.all');
  return (
    <Card title={t('search.type')} summary={label}>
      <View style={styles.chips}>
        <Chip label={t('common.all')} selected={!type} onPress={() => onType(null)} />
        <Chip label={t('record.expense')} selected={type === 'expense'} onPress={() => onType('expense')} />
        <Chip label={t('record.income')} selected={type === 'income'} onPress={() => onType('income')} />
      </View>
    </Card>
  );
}

function DateField({ label, value, onChange }: { label: string; value: Date | null; onChange: (date: Date) => void }) {
  const palette = useSheetPalette();
  const { locale } = useLocalePreference();
  const [open, setOpen] = useState(false);
  const dateLabel = value ? value.toLocaleDateString(INTL_LOCALE[locale]) : t('search.unlimited');
  return (
    <View style={[styles.dateField, { backgroundColor: palette.cardPill }]}>
      {Platform.OS === 'ios' ? (
        <Host matchContents={{ vertical: true }} style={styles.dateHost}>
          <Popover isPresented={open} onIsPresentedChange={setOpen}>
            <Popover.Trigger>
              <NativeButton
                onPress={() => setOpen(true)}
                modifiers={[
                  buttonStyle('plain'),
                  frame({ maxWidth: 9999, minHeight: 44 }),
                  accessibilityLabel(`${label}: ${dateLabel}`),
                ]}
              >
                <HStack spacing={Space[2]} modifiers={[frame({ maxWidth: 9999 })]}>
                  <NativeText modifiers={[foregroundColor(palette.textPrimary), lineLimit(1)]}>{dateLabel}</NativeText>
                  <Spacer />
                  <NativeImage systemName="calendar" color={palette.textTertiary} size={15} />
                </HStack>
              </NativeButton>
            </Popover.Trigger>
            <Popover.Content>
              <VStack modifiers={[padding({ all: 16 }), frame({ width: 300 })]}>
                <DatePicker
                  selection={value ?? new Date()}
                  displayedComponents={['date']}
                  onDateChange={onChange}
                  modifiers={[
                    datePickerStyle('graphical'),
                    labelsHidden(),
                    environment('locale', INTL_LOCALE[locale]),
                    accessibilityLabel(label),
                  ]}
                />
              </VStack>
            </Popover.Content>
          </Popover>
        </Host>
      ) : (
        <View style={styles.dateValue}>
          <Text style={{ color: palette.textPrimary }}>{dateLabel}</Text>
          <SymbolView name="calendar" tintColor={palette.textTertiary} size={15} />
        </View>
      )}
    </View>
  );
}

export function DateFilterCard({
  filters,
  onChange,
}: {
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
}) {
  const palette = useSheetPalette();
  const invalid = validateFilters(filters).date;
  return (
    <Card
      title={t('dates.date')}
      summary={
        filters.datePreset === 'all'
          ? t('common.all')
          : filters.datePreset === 'custom'
            ? customDateFilterLabel(filters.customFrom, filters.customTo)
            : DATE_PRESET_LABELS[filters.datePreset]
      }
    >
      <View style={styles.chips}>
        {SEARCH_DATE_PRESETS.map((key) => (
          <Chip
            key={key}
            label={t(`dates.${key}`)}
            selected={filters.datePreset === key}
            onPress={() => onChange({ ...filters, datePreset: key })}
          />
        ))}
      </View>
      <View style={styles.row}>
        <DateField
          label={t('dates.startDate')}
          value={filters.customFrom}
          onChange={(date) => onChange({ ...filters, customFrom: date, datePreset: 'custom' })}
        />
        <DateField
          label={t('dates.endDate')}
          value={filters.customTo}
          onChange={(date) => onChange({ ...filters, customTo: date, datePreset: 'custom' })}
        />
      </View>
      {invalid && (
        <Text accessibilityRole="alert" style={{ color: palette.danger }}>
          {t('search.dateOrderError')}
        </Text>
      )}
    </Card>
  );
}

function AmountSlider({
  min,
  max,
  limit,
  onChange,
  onSlidingStart,
  onSlidingEnd,
}: {
  min: string;
  max: string;
  limit: number;
  onChange: (min: string, max: string) => void;
  onSlidingStart: () => void;
  onSlidingEnd: (cancelled: boolean) => void;
}) {
  const palette = useSheetPalette();
  const track = useRef<View>(null);
  const left = useRef(0);
  const dragging = useRef(false);
  const [width, setWidth] = useState(1);
  const lower = min.trim() && isValidAmountInput(min) ? Math.min(Number(min) || 0, limit) : 0;
  const upper = max.trim() && isValidAmountInput(max) ? Math.min(Number(max) || 0, limit) : limit;
  const update = (which: 'min' | 'max', pageX: number) => {
    const next = moveAmountBound(which, (pageX - left.current) / width, limit, min, max);
    onChange(next.min, next.max);
  };
  const handle = (which: 'min' | 'max', value: number) => (
    <View
      key={which}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={t(which === 'min' ? 'search.minAmount' : 'search.maxAmount')}
      accessibilityValue={{
        min: 0,
        max: limit,
        now: value,
        text: (which === 'min' ? min : max) || t('search.unlimited'),
      }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        const next =
          event.nativeEvent.actionName === 'increment'
            ? (Math.floor(value / AMOUNT_SLIDER_STEP) + 1) * AMOUNT_SLIDER_STEP
            : (Math.ceil(value / AMOUNT_SLIDER_STEP) - 1) * AMOUNT_SLIDER_STEP;
        const bounds = moveAmountBound(which, next / limit, limit, min, max);
        onChange(bounds.min, bounds.max);
      }}
      onStartShouldSetResponder={() => true}
      onResponderGrant={(event) => {
        dragging.current = true;
        onSlidingStart();
        const pageX = event.nativeEvent.pageX;
        track.current?.measureInWindow((x) => {
          if (!dragging.current) return;
          left.current = x;
          update(which, pageX);
        });
      }}
      onResponderMove={(event) => {
        if (dragging.current) update(which, event.nativeEvent.pageX);
      }}
      onResponderTerminationRequest={() => false}
      onResponderRelease={() => {
        dragging.current = false;
        onSlidingEnd(false);
      }}
      onResponderTerminate={() => {
        dragging.current = false;
        onSlidingEnd(true);
      }}
      style={[
        styles.thumbTarget,
        { left: `${(value / limit) * 100}%` },
        lower === upper && { transform: [{ translateY: which === 'min' ? -10 : 10 }] },
      ]}
    >
      <View style={[styles.thumb, { backgroundColor: palette.card, borderColor: palette.accent }]} />
    </View>
  );
  return (
    <View ref={track} onLayout={(e) => setWidth(Math.max(1, e.nativeEvent.layout.width))} style={styles.trackArea}>
      <View style={[styles.track, { backgroundColor: palette.separator }]} />
      <View
        style={[
          styles.track,
          {
            left: `${(lower / limit) * 100}%`,
            width: `${Math.max(0, (upper - lower) / limit) * 100}%`,
            backgroundColor: palette.accent,
          },
        ]}
      />
      {handle('min', lower)}
      {handle('max', upper)}
    </View>
  );
}

export function AmountFilterCard({
  filters,
  familyId,
  onChange,
  onSlidingChange,
}: {
  filters: SearchFilters;
  familyId: string | undefined;
  onChange: (filters: SearchFilters) => void;
  onSlidingChange: (sliding: boolean) => void;
}) {
  const palette = useSheetPalette();
  const [sliderDraft, setSliderDraft] = useState<AmountSliderDraft | null>(null);
  const sliderSession = useRef<ReturnType<typeof createAmountSliderSession> | null>(null);
  const maxQuery = useQuery({
    queryKey: ['search', 'amount-limit', familyId],
    enabled: !!familyId,
    staleTime: 60_000,
    queryFn: async () => {
      if (!familyId) return 0;
      const { data, error } = await supabase
        .from('transactions')
        .select('amount')
        .eq('family_id', familyId)
        .eq('is_deleted', false)
        .order('amount', { ascending: false })
        .limit(1);
      if (error) throw error;
      return data[0]?.amount ?? 0;
    },
  });
  const maxValue = Math.max(
    1000,
    Math.ceil((maxQuery.data ?? 0) / 100),
    isValidAmountInput(filters.amountMinYuan) ? Number(filters.amountMinYuan) || 0 : 0,
    isValidAmountInput(filters.amountMaxYuan) ? Number(filters.amountMaxYuan) || 0 : 0,
  );
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(maxValue)) - 1);
  const limit = Math.ceil(maxValue / magnitude) * magnitude;
  const displayedMin = sliderDraft?.min ?? filters.amountMinYuan;
  const displayedMax = sliderDraft?.max ?? filters.amountMaxYuan;
  const invalid = validateFilters(filters).amount;
  const invalidInput = !isValidAmountInput(filters.amountMinYuan) || !isValidAmountInput(filters.amountMaxYuan);
  return (
    <Card
      title={t('search.amount')}
      summary={
        filters.amountMinYuan || filters.amountMaxYuan
          ? compactAmountFilterLabel(filters.amountMinYuan, filters.amountMaxYuan)
          : t('common.all')
      }
    >
      <AmountSlider
        min={displayedMin}
        max={displayedMax}
        limit={sliderDraft?.limit ?? limit}
        onChange={(min, max) => {
          if (sliderSession.current) {
            setSliderDraft(sliderSession.current.update(min, max));
          } else {
            onChange({ ...filters, amountMinYuan: min, amountMaxYuan: max });
          }
        }}
        onSlidingStart={() => {
          const initial = { min: filters.amountMinYuan, max: filters.amountMaxYuan, limit };
          sliderSession.current = createAmountSliderSession(initial, (range) =>
            onChange({ ...filters, amountMinYuan: range.min, amountMaxYuan: range.max }),
          );
          setSliderDraft(initial);
          onSlidingChange(true);
        }}
        onSlidingEnd={(cancelled) => {
          sliderSession.current?.finish(cancelled);
          sliderSession.current = null;
          setSliderDraft(null);
          onSlidingChange(false);
        }}
      />
      <View style={styles.row}>
        {(['amountMinYuan', 'amountMaxYuan'] as const).map((key) => (
          <View key={key} style={[styles.field, { backgroundColor: palette.cardPill }]}>
            <Text style={[Typography.caption, { color: palette.textSecondary }]}>
              {t(key === 'amountMinYuan' ? 'search.minAmount' : 'search.maxAmount')}
            </Text>
            <View style={styles.valueRow}>
              <Text style={{ color: palette.textPrimary }}>¥</Text>
              <TextInput
                accessibilityLabel={t(key === 'amountMinYuan' ? 'search.minAmount' : 'search.maxAmount')}
                keyboardType="decimal-pad"
                value={key === 'amountMinYuan' ? displayedMin : displayedMax}
                placeholder={t('search.unlimited')}
                placeholderTextColor={palette.textTertiary}
                onChangeText={(value) => onChange({ ...filters, [key]: value })}
                style={{ color: palette.textPrimary, minHeight: 32, flex: 1 }}
              />
            </View>
          </View>
        ))}
      </View>
      {(invalid || invalidInput) && (
        <Text accessibilityRole="alert" style={{ color: palette.danger }}>
          {t(invalidInput ? 'search.amountFormatError' : 'search.amountOrderError')}
        </Text>
      )}
      <Text style={[styles.label, { color: palette.textPrimary }]}>{t('search.quickRanges')}</Text>
      <View style={styles.chips}>
        {ranges.map(([min, max]) => (
          <Chip
            key={min}
            label={max ? `${min}–${max}` : t('search.above1000')}
            selected={filters.amountMinYuan === min && filters.amountMaxYuan === max}
            onPress={() => onChange({ ...filters, amountMinYuan: min, amountMaxYuan: max })}
          />
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.lg, overflow: 'hidden' },
  heading: {
    minHeight: 56,
    paddingHorizontal: Space[4],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space[2],
  },
  title: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
  headingRight: { flexDirection: 'row', alignItems: 'center', gap: Space[2], flexShrink: 1 },
  body: { paddingHorizontal: Space[4], paddingBottom: Space[4], gap: Space[2] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space[2] },
  chip: { minHeight: 38, paddingHorizontal: Space[3], borderRadius: Radius.full, justifyContent: 'center' },
  label: { fontSize: 14, fontWeight: '600', marginTop: Space[2] },
  row: { flexDirection: 'row', gap: Space[2] },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: Space[1] },
  field: {
    flex: 1,
    minHeight: 64,
    borderRadius: Radius.md,
    padding: Space[2],
    justifyContent: 'center',
    gap: Space[1],
    overflow: 'hidden',
  },
  dateField: {
    flex: 1,
    minHeight: 44,
    borderRadius: Radius.md,
    paddingHorizontal: Space[2],
    justifyContent: 'center',
    overflow: 'hidden',
  },
  dateValue: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dateHost: { width: '100%' },
  trackArea: { height: 48, justifyContent: 'center', marginHorizontal: 22 },
  track: { position: 'absolute', height: 4, left: 0, right: 0, borderRadius: 2 },
  thumbTarget: {
    position: 'absolute',
    width: 44,
    height: 44,
    marginLeft: -22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: { width: 24, height: 24, borderWidth: 2, borderRadius: 12 },
});
