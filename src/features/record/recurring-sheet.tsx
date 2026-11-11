/**
 * 定时收支编辑面板（PRD §18 自定义能力）。复用记账面板（record-sheet）的视觉语言：
 * 原生 pageSheet 壳 + 支出/收入分段 + 大号金额 + 自定义键盘 + 分类网格 + 记账人（户主可选）。
 * 支持每天、每月和每年；每日新规则的起始日期由服务端按北京时间确定。
 */
import {
  BottomSheet,
  Button as UIButton,
  Group,
  Host,
  HStack,
  Picker,
  RNHostView,
  ScrollView as UIScrollView,
  Text as UIText,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  background,
  fixedSize,
  frame,
  padding,
  shapes,
  tint,
  ignoreSafeArea,
  labelsHidden,
  pickerStyle,
  presentationBackground,
  presentationDetents,
  tag,
} from '@expo/ui/swift-ui/modifiers';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { onlineManager } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  useAllCategories,
  useCategoryLayout,
  useCreateRecurringRule,
  useHiddenCategoryIds,
  useMemberships,
  useMyFamily,
  useMyProfile,
  useUpdateRecurringRule,
  type Category,
  type RecurringFrequency,
  type RecurringRule,
} from '@/api';
import { PageSheet } from '@/components/page-sheet';
import { CacheInlineNotice, hasSettledRefreshFailure } from '@/features/sync/cache-inline-notice';
import { Radius, Space, useCategoryColors, useSheetPalette } from '@/constants/design';
import { alertOk, displayCategoryName, t, useLocalePreference } from '@/i18n';
import { categoryColorKey, categorySymbol } from '@/lib/category-style';
import { buildCategoryHierarchy, categoryPath, selectableRecordCategories } from '@/lib/category-hierarchy';
import { isNetworkAvailable } from '@/lib/query-network';

import { MemberPopover } from './member-popover';
import { isLikelyNetworkError, isSaveAttemptTimeout, SAVE_NETWORK_TIMEOUT_MS, withDeadline } from './save-attempt';

type TxnType = 'expense' | 'income';

export type RecurringSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** 当前家庭 id。 */
  familyId: string;
  /** 当前登录用户 id（created_by + 记账人默认值）。 */
  recorderId: string;
  /** null = 新建；非 null = 编辑该规则。 */
  editing: RecurringRule | null;
  /** 保存成功回调（父层据此尝试补记已到期的规则）。 */
  onSaved?: () => void;
};

const KEY_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', '⌫'],
] as const;

function displayParts(raw: string): { integer: string; decimal: string; hasDot: boolean } {
  const [intRaw = '', decRaw] = raw.split('.');
  const intNum = intRaw === '' ? 0 : Number(intRaw);
  return { integer: intNum.toLocaleString('en-US'), decimal: decRaw ?? '', hasDot: raw.includes('.') };
}

function rawToCents(raw: string): number {
  return Math.round(Number(raw || '0') * 100);
}

/** 当月 1 日的 YYYY-MM-DD（新建规则的 start_date）。 */
function firstOfCurrentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export function RecurringSheet({ visible, onClose, familyId, recorderId, editing, onSaved }: RecurringSheetProps) {
  return (
    <PageSheet visible={visible} onClose={onClose} allowSwipeDismissal>
      <RecurringForm
        familyId={familyId}
        recorderId={recorderId}
        editing={editing}
        onClose={onClose}
        onSaved={onSaved}
      />
    </PageSheet>
  );
}

function RecurringForm({ familyId, recorderId, editing, onClose, onSaved }: Omit<RecurringSheetProps, 'visible'>) {
  const palette = useSheetPalette();
  useLocalePreference();
  const catColors = useCategoryColors();
  const { fontScale } = useWindowDimensions();
  const [catAreaW, setCatAreaW] = useState(0);

  const categoriesQ = useAllCategories();
  const layoutQ = useCategoryLayout();
  const hiddenQ = useHiddenCategoryIds();
  const membersQ = useMemberships();
  const familyQ = useMyFamily();
  const profileQ = useMyProfile();
  const createM = useCreateRecurringRule();
  const updateM = useUpdateRecurringRule();
  const [validating, setValidating] = useState(false);
  const saveInFlight = useRef(false);
  const saving = createM.isPending || updateM.isPending || validating;

  const [type, setType] = useState<TxnType>(editing?.type === 'income' ? 'income' : 'expense');
  const [raw, setRaw] = useState(editing?.amount ? (editing.amount / 100).toString() : '');
  const [categoryId, setCategoryId] = useState<string | null>(editing?.category_id ?? null);
  const [note, setNote] = useState(editing?.note ?? '');
  const [frequency, setFrequency] = useState<RecurringFrequency>(
    editing?.frequency === 'daily' || editing?.frequency === 'yearly' ? editing.frequency : 'monthly',
  );
  const [dayOfMonth, setDayOfMonth] = useState<number>(editing?.day_of_month ?? 1);
  const [monthOfYear, setMonthOfYear] = useState<number>(editing?.month_of_year ?? 1);
  const [recorderUserId, setRecorderUserId] = useState(editing?.recorder_user_id ?? recorderId);
  const [memberOpen, setMemberOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleMounted, setScheduleMounted] = useState(false);
  const [scheduledMinute, setScheduledMinute] = useState(editing?.scheduled_minute ?? 360);

  const members = membersQ.data ?? [];
  const showRecorder = members.length > 1 && members.some((m) => m.userId === recorderId && m.role === 'owner');
  const catColumns = catAreaW > 0 ? Math.max(1, Math.min(5, Math.floor(catAreaW / 60))) : 5;
  const catItemW = catAreaW > 0 ? catAreaW / catColumns : 64;

  const hierarchy = useMemo(
    () => buildCategoryHierarchy(categoriesQ.data ?? [], layoutQ.data ?? []),
    [categoriesQ.data, layoutQ.data],
  );
  const categories = useMemo<Category[]>(
    () => selectableRecordCategories(hierarchy, type, hiddenQ.data ?? new Set<string>(), editing?.category_id),
    [hierarchy, hiddenQ.data, type, editing?.category_id],
  );

  const keepingOriginalGroup =
    !!editing &&
    categoryId === editing.category_id &&
    type === editing.type &&
    !categories.some((category) => category.id === editing.category_id);

  const effectiveCategoryId = useMemo(() => {
    if (keepingOriginalGroup) return categoryId;
    if (categoryId) return categories.some((c) => c.id === categoryId) ? categoryId : null;
    return categories[0]?.id ?? null;
  }, [categoryId, categories, keepingOriginalGroup]);

  const cents = rawToCents(raw);
  const canSave =
    cents > 0 &&
    !!effectiveCategoryId &&
    !!familyId &&
    !saving &&
    categoriesQ.data !== undefined &&
    layoutQ.data !== undefined &&
    hiddenQ.data !== undefined;
  const amountColor = type === 'expense' ? palette.expense : palette.income;
  const sign = type === 'expense' ? '-' : '+';
  const parts = displayParts(raw);
  const daysInMonth = frequency === 'monthly' ? 31 : new Date(2000, monthOfYear, 0).getDate();
  const selectedDay = Math.min(dayOfMonth, daysInMonth);
  const scheduleLabel = `${frequency === 'daily' ? t('record.recurringDaily') : frequency === 'monthly' ? t('common.everyMonthDay', { day: selectedDay }) : t('record.recurringYearlyOn', { month: monthOfYear, day: selectedDay })} ${formatScheduleTime(scheduledMinute)}`;

  const press = (k: string) => {
    setRaw((prev) => {
      if (k === '⌫') return prev.slice(0, -1);
      if (k === '.') {
        if (prev.includes('.')) return prev;
        return prev === '' ? '0.' : prev + '.';
      }
      const [, dec] = prev.split('.');
      if (dec !== undefined && dec.length >= 2) return prev;
      if (prev === '0') return k;
      if (prev.replace('.', '').length >= 9) return prev;
      return prev + k;
    });
  };

  const handleSave = async () => {
    if (!canSave || !effectiveCategoryId || saveInFlight.current) return;
    saveInFlight.current = true;
    setValidating(true);
    let writeStarted = false;
    try {
      if (!onlineManager.isOnline()) {
        Alert.alert(t('record.networkRetry'), undefined, alertOk());
        return;
      }
      const [latestCategories, latestLayout, latestHidden, latestFamily, latestMembers] = await withDeadline(
        Promise.all([
          categoriesQ.refetch({ throwOnError: true, cancelRefetch: false }).then((r) => r.data),
          layoutQ.refetch({ throwOnError: true, cancelRefetch: false }).then((r) => r.data),
          hiddenQ.refetch({ throwOnError: true, cancelRefetch: false }).then((r) => r.data),
          familyQ.isStale || familyQ.isError
            ? familyQ.refetch({ throwOnError: true, cancelRefetch: false }).then((r) => r.data)
            : familyQ.data,
          membersQ.isStale || membersQ.isError
            ? membersQ.refetch({ throwOnError: true, cancelRefetch: false }).then((r) => r.data)
            : membersQ.data,
        ]),
        SAVE_NETWORK_TIMEOUT_MS,
      );
      if (!latestCategories || !latestLayout || !latestHidden || latestFamily?.id !== familyId || !latestMembers) {
        Alert.alert(t('record.networkRetry'), undefined, alertOk());
        return;
      }
      const selectable = selectableRecordCategories(
        buildCategoryHierarchy(latestCategories, latestLayout),
        type,
        latestHidden,
        editing?.category_id,
      );
      const preservingOriginal = !!editing && effectiveCategoryId === editing.category_id && type === editing.type;
      if (!preservingOriginal && !selectable.some((category) => category.id === effectiveCategoryId)) {
        setCategoryId(effectiveCategoryId);
        Alert.alert(t('common.categoryChanged'), undefined, alertOk());
        return;
      }
      if (
        !latestMembers.some((member) => member.userId === recorderUserId) ||
        (recorderUserId !== recorderId &&
          !latestMembers.some((member) => member.userId === recorderId && member.role === 'owner'))
      ) {
        Alert.alert(t('record.networkRetry'), undefined, alertOk());
        return;
      }
      writeStarted = true;
      if (editing) {
        await updateM.mutateAsync({
          id: editing.id,
          type,
          amount: cents,
          category_id: effectiveCategoryId,
          note: note || null,
          recorder_user_id: recorderUserId,
          frequency,
          scheduled_minute: scheduledMinute,
          month_of_year: frequency === 'yearly' ? monthOfYear : null,
          day_of_month: frequency === 'daily' ? 1 : selectedDay,
        });
      } else {
        await createM.mutateAsync({
          family_id: familyId,
          recorder_user_id: recorderUserId,
          created_by: recorderId,
          type,
          amount: cents,
          category_id: effectiveCategoryId,
          note: note || null,
          frequency,
          scheduled_minute: scheduledMinute,
          month_of_year: frequency === 'yearly' ? monthOfYear : null,
          day_of_month: frequency === 'daily' ? 1 : selectedDay,
          start_date: firstOfCurrentMonth(),
          end_date: null,
        });
      }
      onSaved?.();
      onClose();
    } catch (e) {
      if (writeStarted && isLikelyNetworkError(e))
        Alert.alert(t('record.recurringSaveUncertain'), undefined, alertOk());
      else if (isSaveAttemptTimeout(e) || isLikelyNetworkError(e))
        Alert.alert(t('record.networkRetry'), undefined, alertOk());
      else Alert.alert(t('record.saveFailed'), e instanceof Error ? e.message : String(e), alertOk());
    } finally {
      saveInFlight.current = false;
      setValidating(false);
    }
  };

  const renderCat = (c: Category) => {
    const active = c.id === effectiveCategoryId;
    const color = catColors[categoryColorKey(c.name, type, c.color_key)];
    return (
      <Pressable
        key={c.id}
        style={[styles.catItem, { width: catItemW }]}
        accessibilityRole="radio"
        accessibilityState={{ selected: active }}
        accessibilityLabel={
          categoryPath(
            c.id,
            hierarchy,
            (category) => displayCategoryName(category.name, category.is_system),
            t('category.unspecified'),
          ) ?? undefined
        }
        onPress={() => setCategoryId(c.id)}
      >
        <View style={[styles.catRing, active && { borderColor: palette.accent, borderWidth: 2 }]}>
          <View style={[styles.catCircle, { backgroundColor: color, opacity: active ? 1 : 0.78 }]}>
            <SymbolView name={categorySymbol(c.icon, type) as SymbolViewProps['name']} tintColor="#FFFFFF" size={22} />
          </View>
          {active ? (
            <View style={[styles.catCheck, { backgroundColor: palette.accent, borderColor: palette.card }]}>
              <SymbolView name="checkmark" tintColor="#FFFFFF" size={10} />
            </View>
          ) : null}
        </View>
        <Text
          numberOfLines={2}
          style={{
            color: active ? palette.accent : palette.textSecondary,
            fontSize: 12,
            fontWeight: active ? '600' : '400',
            maxWidth: 56,
          }}
        >
          {displayCategoryName(c.name, c.is_system)}
        </Text>
      </Pressable>
    );
  };

  const divider = <View style={[styles.divider, { backgroundColor: palette.separator }]} />;

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]} onAccessibilityEscape={onClose}>
      <View style={styles.formArea}>
        <View style={styles.grabberWrap}>
          <View style={[styles.grabber, { backgroundColor: palette.separator }]} />
        </View>

        <View style={styles.topBar}>
          <Text style={[styles.topTitle, { color: palette.textPrimary }]}>
            {editing ? t('record.editRecurring') : t('record.addRecurring')}
          </Text>
        </View>

        {/* 支出 / 收入 */}
        <Host style={styles.segmentHost}>
          <Picker
            modifiers={[pickerStyle('segmented')]}
            selection={type}
            onSelectionChange={(value) => {
              if ((value === 'expense' || value === 'income') && value !== type) {
                setType(value);
                setCategoryId(null);
              }
            }}
          >
            <UIText modifiers={[tag('expense')]}>{t('record.expense')}</UIText>
            <UIText modifiers={[tag('income')]}>{t('record.income')}</UIText>
          </Picker>
        </Host>

        {/* 大号金额 */}
        <View style={styles.amountRow}>
          <Text style={[styles.amountSign, { color: amountColor }]}>{`${sign}¥`}</Text>
          <Text style={[styles.amountInt, { color: amountColor }]}>{parts.integer}</Text>
          {parts.hasDot ? <Text style={[styles.amountDec, { color: amountColor }]}>{`.${parts.decimal}`}</Text> : null}
        </View>

        <View style={styles.middleFlex}>
          <View style={[styles.detailCard, { backgroundColor: palette.card }]}>
            <View style={styles.catArea} onLayout={(event) => setCatAreaW(event.nativeEvent.layout.width)}>
              {categoriesQ.data && layoutQ.data && hiddenQ.data ? (
                <CacheInlineNotice
                  failed={hasSettledRefreshFailure([familyQ, profileQ, categoriesQ, layoutQ, hiddenQ])}
                  updatedAt={Math.min(categoriesQ.dataUpdatedAt, layoutQ.dataUpdatedAt, hiddenQ.dataUpdatedAt)}
                />
              ) : null}
              {!categoriesQ.data || !layoutQ.data || !hiddenQ.data ? (
                categoriesQ.isLoading ||
                layoutQ.isLoading ||
                hiddenQ.isLoading ||
                (isNetworkAvailable() &&
                  !familyQ.isError &&
                  !profileQ.isError &&
                  [categoriesQ, layoutQ, hiddenQ].some((query) => query.fetchStatus === 'paused')) ? (
                  <View style={styles.catLoading}>
                    <ActivityIndicator />
                  </View>
                ) : (
                  <Pressable
                    onPress={() => {
                      void familyQ.refetch();
                      void profileQ.refetch();
                      void categoriesQ.refetch();
                      void layoutQ.refetch();
                      void hiddenQ.refetch();
                    }}
                    accessibilityRole="button"
                  >
                    <Text style={{ color: palette.textSecondary }}>
                      {t(isNetworkAvailable() ? 'common.loadFailed' : 'common.noCachedData')} · {t('common.retry')}
                    </Text>
                  </Pressable>
                )
              ) : (
                <ScrollView
                  style={styles.catScroll}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  {keepingOriginalGroup ? (
                    <Text style={{ color: palette.textSecondary, fontSize: 12, paddingVertical: Space[2] }}>
                      {t('record.legacyCategoryKept')}
                    </Text>
                  ) : null}
                  {categories.length === 0 && !keepingOriginalGroup ? (
                    <Text style={{ color: palette.textSecondary }}>{t('record.noSubcategories')}</Text>
                  ) : null}
                  {categoryId && !effectiveCategoryId ? (
                    <Text style={{ color: palette.textSecondary }}>{t('common.categoryChanged')}</Text>
                  ) : null}
                  <View style={styles.catGrid}>{categories.map(renderCat)}</View>
                </ScrollView>
              )}
            </View>
            {divider}
            <View style={styles.rowInner}>
              <SymbolView name="pencil" tintColor={palette.textTertiary} size={16} />
              <TextInput
                style={[styles.noteInput, { color: palette.textPrimary }]}
                placeholder={t('record.recurringNotePlaceholder')}
                placeholderTextColor={palette.textTertiary}
                value={note}
                onChangeText={setNote}
                maxLength={50}
                returnKeyType="done"
              />
            </View>
            {divider}
            <View style={styles.toolbar}>
              <Host style={[styles.toolbarHost, { height: Math.max(48, Math.ceil(48 * fontScale)) }]}>
                <UIScrollView axes="horizontal" showsIndicators>
                  <HStack spacing={Space[1]} alignment="center">
                    <UIButton
                      label={scheduleLabel}
                      systemImage="calendar"
                      onPress={() => {
                        setMemberOpen(false);
                        setScheduleMounted(true);
                        setScheduleOpen(true);
                      }}
                      modifiers={[
                        padding({ horizontal: 8, vertical: 4 }),
                        background(palette.cardPill, shapes.capsule()),
                        frame({ minHeight: 44 }),
                        tint(palette.accent),
                        fixedSize({ horizontal: true, vertical: false }),
                        accessibilityLabel(`${t('record.recurringFrequency')}: ${scheduleLabel}`),
                      ]}
                    />
                    {showRecorder ? (
                      <MemberPopover
                        members={members}
                        selectedUserId={recorderUserId}
                        open={memberOpen}
                        onOpenChange={setMemberOpen}
                        onSelect={setRecorderUserId}
                      />
                    ) : null}
                  </HStack>
                </UIScrollView>
              </Host>
            </View>
          </View>
        </View>
      </View>
      <View style={styles.bottomDock}>
        {/* 数字键盘 */}
        <View style={styles.keypad}>
          {KEY_ROWS.map((row, ri) => (
            <View key={ri} style={styles.keyRow}>
              {row.map((k) => (
                <Pressable
                  key={k}
                  style={({ pressed }) => [styles.key, { backgroundColor: pressed ? palette.separator : palette.card }]}
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
          ))}
        </View>

        <Pressable
          disabled={!canSave}
          onPress={handleSave}
          style={[styles.save, { backgroundColor: palette.ink, opacity: canSave ? 1 : 0.35 }]}
        >
          {saving ? (
            <ActivityIndicator color={palette.onInk} />
          ) : (
            <Text style={[styles.saveText, { color: palette.onInk }]}>{t('common.save')}</Text>
          )}
        </Pressable>
      </View>

      {scheduleMounted ? (
        <SchedulePickerSheet
          visible={scheduleOpen}
          frequency={frequency}
          day={selectedDay}
          month={monthOfYear}
          minute={scheduledMinute}
          showDailyStart={!editing || editing.frequency !== 'daily'}
          onClose={() => setScheduleOpen(false)}
          onDismiss={() => setScheduleMounted(false)}
          onDone={(nextFrequency, nextDay, nextMonth, nextMinute) => {
            setFrequency(nextFrequency);
            setDayOfMonth(nextDay);
            setMonthOfYear(nextMonth);
            setScheduledMinute(nextMinute);
            setScheduleOpen(false);
          }}
        />
      ) : null}
    </View>
  );
}

function formatScheduleTime(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function SchedulePickerSheet({
  visible,
  frequency,
  day,
  month,
  minute,
  showDailyStart,
  onClose,
  onDismiss,
  onDone,
}: {
  visible: boolean;
  frequency: RecurringFrequency;
  day: number;
  month: number;
  minute: number;
  showDailyStart: boolean;
  onClose: () => void;
  onDismiss: () => void;
  onDone: (frequency: RecurringFrequency, day: number, month: number, minute: number) => void;
}) {
  const palette = useSheetPalette();
  const insets = useSafeAreaInsets();
  const [draftFrequency, setDraftFrequency] = useState(frequency);
  const [draftDay, setDraftDay] = useState(day);
  const [draftMonth, setDraftMonth] = useState(month);
  const [hour, setHour] = useState(Math.floor(minute / 60));
  const [minutePart, setMinutePart] = useState(minute % 60);
  const maxDay = draftFrequency === 'yearly' ? new Date(2000, draftMonth, 0).getDate() : 31;
  const effectiveDay = Math.min(draftDay, maxDay);
  const wheel = (
    value: number,
    count: number,
    minimum: number,
    label: string,
    suffix: string,
    setValue: (value: number) => void,
  ) => (
    <Host style={styles.wheelHost}>
      <Picker
        selection={String(value)}
        modifiers={[pickerStyle('wheel'), labelsHidden(), accessibilityLabel(label)]}
        onSelectionChange={(selected) => {
          const n = Number(selected);
          if (Number.isInteger(n) && n >= minimum && n < minimum + count) setValue(n);
        }}
      >
        {Array.from({ length: count }, (_, i) => (
          <UIText
            key={i}
            modifiers={[tag(String(i + minimum))]}
          >{`${String(i + minimum).padStart(minimum === 0 ? 2 : 1, '0')}${suffix}`}</UIText>
        ))}
      </Picker>
    </Host>
  );
  return (
    <Host style={styles.sheetAnchor}>
      <BottomSheet
        isPresented={visible}
        onDismiss={onDismiss}
        onIsPresentedChange={(visible) => {
          if (!visible) onClose();
        }}
      >
        <Group modifiers={[presentationDetents([{ fraction: 0.6 }]), presentationBackground(palette.base)]}>
          <Group modifiers={[ignoreSafeArea({ regions: 'container', edges: 'bottom' })]}>
            <RNHostView>
              <View
                style={[
                  styles.scheduleSheet,
                  { backgroundColor: palette.base, paddingBottom: Math.max(Space[5], insets.bottom - Space[4]) },
                ]}
              >
                <Text style={[styles.scheduleTitle, { color: palette.textPrimary }]}>{t('record.scheduleTitle')}</Text>
                <Host style={styles.scheduleSegmentHost}>
                  <Picker
                    selection={draftFrequency}
                    modifiers={[pickerStyle('segmented'), accessibilityLabel(t('record.recurringFrequency'))]}
                    onSelectionChange={(value) => {
                      if (value === 'daily' || value === 'monthly' || value === 'yearly') setDraftFrequency(value);
                    }}
                  >
                    <UIText modifiers={[tag('daily')]}>{t('record.recurringDaily')}</UIText>
                    <UIText modifiers={[tag('monthly')]}>{t('record.recurringMonthly')}</UIText>
                    <UIText modifiers={[tag('yearly')]}>{t('record.recurringYearly')}</UIText>
                  </Picker>
                </Host>
                <View style={styles.wheels}>
                  {draftFrequency === 'yearly'
                    ? wheel(draftMonth, 12, 1, t('record.recurringMonth'), t('record.monthUnit'), setDraftMonth)
                    : null}
                  {draftFrequency !== 'daily'
                    ? wheel(effectiveDay, maxDay, 1, t('record.recurringDay'), t('record.dayUnit'), setDraftDay)
                    : null}
                  {wheel(hour, 24, 0, t('record.hourLabel'), t('record.hourUnit'), setHour)}
                  {wheel(minutePart, 60, 0, t('record.minuteLabel'), t('record.minuteUnit'), setMinutePart)}
                </View>
                <View style={styles.scheduleFooter}>
                  <Text style={[styles.scheduleHint, { color: palette.textSecondary }]}>
                    {draftFrequency === 'daily' && showDailyStart
                      ? t('record.recurringDailyStart', { time: formatScheduleTime(hour * 60 + minutePart) })
                      : draftFrequency === 'monthly' && effectiveDay >= 29
                        ? t('record.recurringMonthEnd')
                        : draftFrequency === 'yearly' && draftMonth === 2 && effectiveDay === 29
                          ? t('record.recurringLeapYear')
                          : t('record.recurringTimezone')}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    style={[styles.scheduleDone, { backgroundColor: palette.info }]}
                    onPress={() => onDone(draftFrequency, effectiveDay, draftMonth, hour * 60 + minutePart)}
                  >
                    <Text style={styles.scheduleDoneText}>{t('common.done')}</Text>
                  </Pressable>
                </View>
              </View>
            </RNHostView>
          </Group>
        </Group>
      </BottomSheet>
    </Host>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: Space[4], paddingTop: Space[2] },
  grabberWrap: { alignItems: 'center', paddingBottom: Space[1] },
  grabber: { width: 36, height: 5, borderRadius: Radius.full, alignSelf: 'center' },
  formArea: { flex: 1, minHeight: 0 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: Space[3] },
  topTitle: { fontSize: 17, fontWeight: '600' },
  segmentHost: { height: 34, marginTop: Space[2] },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', paddingVertical: Space[5] },
  amountSign: { fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] },
  amountInt: { fontSize: 48, fontWeight: '700', fontVariant: ['tabular-nums'] },
  amountDec: { fontSize: 28, fontWeight: '400', fontVariant: ['tabular-nums'] },
  middleFlex: { flex: 1, minHeight: 0 },
  detailCard: { flex: 1, minHeight: 0, borderRadius: Radius.lg, paddingHorizontal: Space[4] },
  catArea: { flex: 1, minHeight: 0 },
  catScroll: { flex: 1 },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: Space[3], paddingVertical: Space[2] },
  catRing: { width: 58, height: 58, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  catCheck: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 18,
    height: 18,
    borderRadius: Radius.full,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbar: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  toolbarHost: { flex: 1, minWidth: 0 },
  bottomDock: { paddingTop: Space[2], paddingBottom: Space[8] },
  catLoading: { height: 80, alignItems: 'center', justifyContent: 'center' },
  catItem: { alignItems: 'center', gap: Space[1] },
  catCircle: { width: 52, height: 52, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: Space[6] },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: Space[2], paddingVertical: Space[3], minHeight: 48 },
  noteInput: { flex: 1, fontSize: 15, padding: 0 },
  scheduleHint: { fontSize: 13, lineHeight: 18, textAlign: 'center', paddingVertical: Space[3] },
  sheetAnchor: { width: 1, height: 1 },
  scheduleSheet: { flex: 1, paddingHorizontal: Space[4], paddingTop: Space[6] },
  scheduleTitle: { textAlign: 'center', fontSize: 18, fontWeight: '600' },
  scheduleSegmentHost: { height: 34, marginTop: Space[4] },
  wheels: { flexDirection: 'row', height: 190, marginTop: Space[3] },
  wheelHost: { flex: 1, height: 190 },
  scheduleFooter: { marginTop: 'auto' },
  scheduleDone: {
    minHeight: 50,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleDoneText: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  keypad: { gap: Space[2] },
  keyRow: { flexDirection: 'row', gap: Space[2] },
  key: {
    flex: 1,
    height: 50,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 1 },
  },
  keyText: { fontSize: 26, fontWeight: '500', fontVariant: ['tabular-nums'] },
  save: { height: 50, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', marginTop: Space[3] },
  saveText: { fontSize: 17, fontWeight: '600' },
});
