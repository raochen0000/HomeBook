/**
 * 定时收支编辑面板（PRD §18 自定义能力）。复用记账面板（record-sheet）的视觉语言：
 * 原生 pageSheet 壳 + 支出/收入分段 + 大号金额 + 自定义键盘 + 分类横滑 + 记账人（户主可选）。
 * 支持每天、每月和每年；每日新规则的起始日期由服务端按北京时间确定。
 */
import { BottomSheet, Group, Host, Picker, RNHostView, Text as UIText } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  ignoreSafeArea,
  labelsHidden,
  pickerStyle,
  presentationBackground,
  presentationDetents,
  tag,
} from '@expo/ui/swift-ui/modifiers';
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
  useAllCategories,
  useCategoryLayout,
  useCreateRecurringRule,
  useHiddenCategoryIds,
  useMemberships,
  useUpdateRecurringRule,
  type Category,
  type FamilyMembership,
  type RecurringFrequency,
  type RecurringRule,
} from '@/api';
import { PageSheet } from '@/components/page-sheet';
import { Radius, Space, useCategoryColors, usePalette, useSheetPalette } from '@/constants/design';
import { alertOk, displayCategoryName, t, useLocalePreference } from '@/i18n';
import { categoryColorKey, categorySymbol } from '@/lib/category-style';
import { buildCategoryHierarchy, categoryPath, selectableRecordCategories } from '@/lib/category-hierarchy';

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
    <PageSheet visible={visible} onClose={onClose}>
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

  const categoriesQ = useAllCategories();
  const layoutQ = useCategoryLayout();
  const hiddenQ = useHiddenCategoryIds();
  const membersQ = useMemberships();
  const createM = useCreateRecurringRule();
  const updateM = useUpdateRecurringRule();
  const saving = createM.isPending || updateM.isPending;

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
  const showRecorder = members.some((m) => m.userId === recorderId && m.role === 'owner');
  const recorderName = members.find((m) => m.userId === recorderUserId)?.nickname ?? t('common.me');

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
    !hierarchy.layoutById.get(editing.category_id)?.parent_category_id;

  const effectiveCategoryId = useMemo(() => {
    if (keepingOriginalGroup) return categoryId;
    if (categoryId && categories.some((c) => c.id === categoryId)) return categoryId;
    return categories[0]?.id ?? null;
  }, [categoryId, categories, keepingOriginalGroup]);

  const cents = rawToCents(raw);
  const canSave =
    cents > 0 &&
    !!effectiveCategoryId &&
    !!familyId &&
    !saving &&
    categoriesQ.isSuccess &&
    layoutQ.isSuccess &&
    hiddenQ.isSuccess;
  const amountColor = type === 'expense' ? palette.expense : palette.income;
  const sign = type === 'expense' ? '-' : '+';
  const parts = displayParts(raw);
  const daysInMonth = frequency === 'monthly' ? 31 : new Date(2000, monthOfYear, 0).getDate();
  const selectedDay = Math.min(dayOfMonth, daysInMonth);

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
    if (!canSave || !effectiveCategoryId) return;
    try {
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
      Alert.alert(t('record.saveFailed'), (e as Error).message ?? String(e), alertOk());
    }
  };

  const renderCat = (c: Category) => {
    const active = c.id === effectiveCategoryId;
    const color = catColors[categoryColorKey(c.name, type, c.color_key)];
    return (
      <Pressable
        key={c.id}
        style={styles.catItem}
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
        <View
          style={[
            styles.catCircle,
            { backgroundColor: color, opacity: active ? 1 : 0.55 },
            active && { borderWidth: 2, borderColor: palette.textPrimary },
          ]}
        >
          <SymbolView name={categorySymbol(c.icon, type) as SymbolViewProps['name']} tintColor="#FFFFFF" size={22} />
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
          {displayCategoryName(c.name, c.is_system)}
        </Text>
      </Pressable>
    );
  };

  const divider = <View style={[styles.divider, { backgroundColor: palette.separator }]} />;

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
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
              if (value === 'expense' || value === 'income') setType(value);
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

        {/* 详情卡：分类 / 记账日 / 备注 / 记账人 */}
        <View style={[styles.detailCard, { backgroundColor: palette.card }]}>
          <View style={styles.catHeader}>
            <Text style={[styles.catHeaderLabel, { color: palette.textSecondary }]}>{t('record.category')}</Text>
          </View>
          {keepingOriginalGroup ? (
            <Text style={{ color: palette.textSecondary, fontSize: 12 }}>{t('record.legacyCategoryKept')}</Text>
          ) : null}
          {categoriesQ.isSuccess &&
          layoutQ.isSuccess &&
          hiddenQ.isSuccess &&
          categories.length === 0 &&
          !keepingOriginalGroup ? (
            <Text style={{ color: palette.textSecondary }}>{t('record.noSubcategories')}</Text>
          ) : null}
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
              {categories.map(renderCat)}
            </ScrollView>
          )}

          {divider}

          <Pressable
            style={styles.rowInner}
            onPress={() => {
              setScheduleMounted(true);
              setScheduleOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={`${t('record.recurringFrequency')}: ${frequency === 'daily' ? t('record.recurringDaily') : frequency === 'monthly' ? t('common.everyMonthDay', { day: selectedDay }) : t('record.recurringYearlyOn', { month: monthOfYear, day: selectedDay })} ${formatScheduleTime(scheduledMinute)}`}
          >
            <SymbolView name="calendar" tintColor={palette.textTertiary} size={16} />
            <Text style={[styles.infoLabel, { color: palette.textPrimary }]}>{t('record.recurringFrequency')}</Text>
            <View style={styles.rowSpacer} />
            <Text style={[styles.infoValue, { color: palette.info }]} numberOfLines={1}>
              {frequency === 'daily'
                ? t('record.recurringDaily')
                : frequency === 'monthly'
                  ? t('common.everyMonthDay', { day: selectedDay })
                  : t('record.recurringYearlyOn', { month: monthOfYear, day: selectedDay })}{' '}
              {formatScheduleTime(scheduledMinute)}
            </Text>
            <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={13} />
          </Pressable>
          {divider}

          {/* 备注 */}
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

          {/* 记账人：仅户主可选 */}
          {showRecorder ? (
            <>
              {divider}
              <Pressable style={styles.rowInner} onPress={() => setMemberOpen(true)}>
                <SymbolView name="person.crop.circle" tintColor={palette.textTertiary} size={16} />
                <Text style={[styles.infoLabel, { color: palette.textPrimary }]}>{t('record.recorder')}</Text>
                <View style={styles.rowSpacer} />
                <Text style={[styles.infoValue, { color: palette.textSecondary }]}>{recorderName}</Text>
                <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={13} />
              </Pressable>
            </>
          ) : null}
        </View>

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

        {/* 取消 / 保存 */}
        <View style={styles.actions}>
          <Pressable style={[styles.cancel, { borderColor: palette.separator }]} onPress={onClose}>
            <Text style={[styles.cancelText, { color: palette.textSecondary }]}>{t('common.cancel')}</Text>
          </Pressable>
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
      </ScrollView>

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

      <MemberPickerSheet
        visible={showRecorder && memberOpen}
        members={members}
        selectedUserId={recorderUserId}
        onSelect={(uid) => {
          setRecorderUserId(uid);
          setMemberOpen(false);
        }}
        onClose={() => setMemberOpen(false)}
      />
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

/** 记账人选择：从底部弹出的成员列表（与 record-sheet 同款）。 */
function MemberPickerSheet({
  visible,
  members,
  selectedUserId,
  onSelect,
  onClose,
}: {
  visible: boolean;
  members: FamilyMembership[];
  selectedUserId: string;
  onSelect: (userId: string) => void;
  onClose: () => void;
}) {
  const palette = usePalette();
  useLocalePreference();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.memberSheet, { backgroundColor: palette.elevated, paddingBottom: insets.bottom + Space[3] }]}
          onPress={() => {}}
        >
          <View style={[styles.grabber, { backgroundColor: palette.separator, marginTop: Space[2] }]} />
          <View style={styles.memberHeader}>
            <View style={styles.memberHeaderSide} />
            <Text style={[styles.memberTitle, { color: palette.textPrimary }]}>{t('record.recorder')}</Text>
            <Pressable style={styles.memberHeaderSide} hitSlop={8} onPress={onClose}>
              <SymbolView name="xmark" tintColor={palette.textTertiary} size={16} />
            </Pressable>
          </View>
          {members.map((m) => {
            const active = m.userId === selectedUserId;
            return (
              <Pressable key={m.id} style={styles.memberRow} onPress={() => onSelect(m.userId)}>
                <SymbolView name="person.crop.circle.fill" tintColor={palette.textTertiary} size={32} />
                <Text style={[styles.memberName, { color: palette.textPrimary }]} numberOfLines={1}>
                  {m.nickname}
                </Text>
                <View style={styles.rowSpacer} />
                {active ? <SymbolView name="checkmark" tintColor={palette.info} size={18} /> : null}
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: Space[4], paddingTop: Space[2] },
  grabberWrap: { alignItems: 'center', paddingBottom: Space[1] },
  grabber: { width: 36, height: 5, borderRadius: Radius.full, alignSelf: 'center' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: Space[1] },
  topTitle: { fontSize: 17, fontWeight: '600' },
  segmentHost: { height: 34, marginTop: Space[2] },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', paddingVertical: Space[5] },
  amountSign: { fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] },
  amountInt: { fontSize: 48, fontWeight: '700', fontVariant: ['tabular-nums'] },
  amountDec: { fontSize: 28, fontWeight: '400', fontVariant: ['tabular-nums'] },
  detailCard: { borderRadius: Radius.lg, paddingHorizontal: Space[4] },
  catHeader: { paddingTop: Space[3], paddingBottom: Space[1] },
  catHeaderLabel: { fontSize: 13, fontWeight: '600' },
  catLoading: { height: 80, alignItems: 'center', justifyContent: 'center' },
  catRow: { paddingVertical: Space[2], gap: Space[3] },
  catItem: { alignItems: 'center', gap: Space[1], width: 60 },
  catCircle: { width: 52, height: 52, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: Space[6] },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: Space[2], paddingVertical: Space[3], minHeight: 48 },
  noteInput: { flex: 1, fontSize: 15, padding: 0 },
  infoLabel: { fontSize: 15 },
  infoValue: { fontSize: 15 },
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
  rowSpacer: { flex: 1 },
  dayHost: { minWidth: 72, minHeight: 28 },
  keypad: { marginTop: Space[5], gap: Space[2] },
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
  actions: { flexDirection: 'row', gap: Space[3], marginTop: Space[3], marginBottom: Space[6] },
  cancel: {
    width: 100,
    height: 50,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { fontSize: 17, fontWeight: '500' },
  save: { flex: 1, height: 50, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontSize: 17, fontWeight: '600' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  memberSheet: {
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    paddingHorizontal: Space[4],
    alignItems: 'stretch',
  },
  memberHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Space[3],
  },
  memberHeaderSide: { width: 24, alignItems: 'flex-end' },
  memberTitle: { fontSize: 16, fontWeight: '600' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: Space[3], paddingVertical: Space[3] },
  memberName: { flexShrink: 1, fontSize: 16, fontWeight: '500' },
});
