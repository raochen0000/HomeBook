/**
 * 记账面板（流程 2 + 流程 10 编辑/删除）。
 *
 * DESIGN §5.3：记账面板 = 原生 Sheet 壳 + 自定义大号金额键盘（L-Custom）。
 * 这里用 RN `Modal`（iOS `pageSheet`，自带下滑关）承载原生 Sheet 观感，顶部用居中抓手提示「拖拽」，
 * 内部金额键盘按设计走自定义 RN 层（@expo/ui 无此交互），避免 RNHostView 桥接的脆弱性。
 *
 * 布局：固定区（抓手 / 标题 / 支出收入分段 / 大号金额）+ 弹性详情区（分类区可滚动；备注·时间·记账人固定）
 * + 底部 dock（数字键盘 / 保存）。分类始终以完整网格展示，并在详情卡内独立滚动。
 */
import {
  Button as UIButton,
  DatePicker,
  Host,
  HStack,
  Image as UIImage,
  Picker,
  Popover,
  Spacer,
  Text as UIText,
  VStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  background,
  datePickerStyle,
  environment,
  frame,
  labelsHidden,
  layoutPriority,
  lineLimit,
  padding,
  pickerStyle,
  shapes,
  tag,
  tint,
  truncationMode,
} from '@expo/ui/swift-ui/modifiers';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type DimensionValue,
} from 'react-native';

import {
  useAccountingPrefs,
  useAllCategories,
  useCategoryLayout,
  useCreateTransaction,
  useHasTransactions,
  useHiddenCategoryIds,
  useMemberships,
  useUpdateTransaction,
  type Category,
  type Transaction,
} from '@/api';
import { PageSheet } from '@/components/page-sheet';
import { ListUserAvatar } from '@/components/list-user-avatar';
import { playToastHaptic, toast, ToastNotice, type ToastItem } from '@/components/toast';
import { Radius, Space, useCategoryColors, useSheetPalette } from '@/constants/design';
import { useAvatarFiles } from '@/features/home/use-avatar-files';
import { alertOk, displayCategoryName, INTL_LOCALE, t, useLocalePreference } from '@/i18n';
import { categoryColorKey, categorySymbol } from '@/lib/category-style';
import { buildCategoryHierarchy, categoryPath, selectableRecordCategories } from '@/lib/category-hierarchy';

import {
  loadCategoryUsage,
  recentCategoryUsage,
  recordCategoryUsage,
  sortCategoriesByUsage,
  type CategoryUsageEvent,
} from './category-usage';
import { isLikelyNetworkError, isSaveAttemptTimeout, SAVE_NETWORK_TIMEOUT_MS, withDeadline } from './save-attempt';

type TxnType = 'expense' | 'income';

export type RecordSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** 当前家庭 id（记一笔必须，创建即绑定，不可变）。 */
  familyId: string;
  /** 当前登录用户 id（记账人默认值）。 */
  recorderId: string;
  /** null = 新建；非 null = 编辑该流水。 */
  editing: Transaction | null;
  /**
   * 保存成功回调。firstRecord=true 表示这是家庭第一笔（父层在面板关闭后弹庆祝）。
   * updated=true 表示编辑；「更新成功」由本面板在关闭动画结束后发出，父层不要再提示「已记一笔」。
   */
  onSaved?: (info: { firstRecord: boolean; updated?: boolean }) => void;
  /** 面板关闭动画结束（iOS）；父层用它在面板消失后再弹首次记账庆祝。 */
  onDismiss?: () => void;
};

/** 数字键盘按行排布（便于画分割线，形成网格分割感）。 */
const KEY_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', '⌫'],
] as const;

// 固定触发区域，使日期 / 时间文字变化时 Popover 锚点保持不变。
const DATE_TRIGGER_WIDTH = 132;
const TIME_TRIGGER_WIDTH = 96;

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
export function RecordSheet({ visible, onClose, onDismiss, familyId, recorderId, editing, onSaved }: RecordSheetProps) {
  const updateToastPending = useRef(false);

  return (
    <PageSheet
      visible={visible}
      onClose={onClose}
      onDismiss={() => {
        const showUpdated = updateToastPending.current;
        updateToastPending.current = false;
        onDismiss?.();
        // 面板已离开屏幕后再提示，避免被 pageSheet 挡住。
        if (showUpdated) toast.success(t('record.updated'));
      }}
    >
      <RecordForm
        familyId={familyId}
        recorderId={recorderId}
        editing={editing}
        onClose={onClose}
        onSaved={onSaved}
        onUpdated={() => {
          updateToastPending.current = true;
        }}
      />
    </PageSheet>
  );
}

function RecordForm({
  familyId,
  recorderId,
  editing,
  onClose,
  onSaved,
  onUpdated,
}: Omit<RecordSheetProps, 'visible' | 'onDismiss'> & { onUpdated: () => void }) {
  const palette = useSheetPalette();
  const { locale } = useLocalePreference();
  const { fontScale } = useWindowDimensions();
  const catColors = useCategoryColors();

  const categoriesQ = useAllCategories();
  const layoutQ = useCategoryLayout();
  const hiddenQ = useHiddenCategoryIds();
  const membersQ = useMemberships();
  const createM = useCreateTransaction();
  const updateM = useUpdateTransaction();
  const hasTransactionsQ = useHasTransactions(familyId);
  // 只用本次等待控制按钮。请求超过 8 秒后 mutation 可能仍在飞，按钮要先恢复。
  const [awaitingSave, setAwaitingSave] = useState(false);
  const [continueToast, setContinueToast] = useState<ToastItem | null>(null);
  const continueToastSeq = useRef(0);
  const mountedRef = useRef(true);
  const saving = awaitingSave;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 记账偏好（记账设置 §18.3.1）：默认记账类型 + 记一笔后行为。
  const prefs = useAccountingPrefs().data;
  const afterBehavior = prefs?.after_record_behavior ?? 'close';

  // 初值按 editing 还原（表单随每次打开重新挂载，初值即生效）；新建时用「默认记账类型」偏好。
  const [type, setType] = useState<TxnType>(
    editing ? (editing.type === 'income' ? 'income' : 'expense') : (prefs?.default_txn_type ?? 'expense'),
  );
  const [raw, setRaw] = useState(editing?.amount ? (editing.amount / 100).toString() : '');
  const [categoryId, setCategoryId] = useState<string | null>(editing?.category_id ?? null);
  const [recent, setRecent] = useState<{ expense: string | null; income: string | null }>({
    expense: null,
    income: null,
  });
  const [recentLoaded, setRecentLoaded] = useState(false);
  const [note, setNote] = useState(editing?.note ?? '');
  const [occurredAt, setOccurredAt] = useState<Date>(editing?.occurred_at ? new Date(editing.occurred_at) : new Date());
  const [recorderUserId, setRecorderUserId] = useState(editing?.recorder_user_id ?? recorderId);
  const [memberOpen, setMemberOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [usage, setUsage] = useState<CategoryUsageEvent[]>([]);
  const [usageLoaded, setUsageLoaded] = useState(false);
  // 分类区可用宽度（实测），用于网格每行 5 个、同一像素宽。
  const [catAreaW, setCatAreaW] = useState(0);

  // 同家庭成员；仅户主可查看并切换「记账人」，普通成员默认记到自己名下。
  const members = membersQ.data ?? [];
  const avatarFiles = useAvatarFiles(members.map((member) => ({ id: member.userId, avatar_url: member.avatarUrl })));
  const showRecorder = members.length > 1 && members.some((m) => m.userId === recorderId && m.role === 'owner');
  const recorderName = members.find((m) => m.userId === recorderUserId)?.nickname ?? t('common.me');

  // 可手动选择的分类：当前类型 + 排除储蓄类系统分类（储蓄走专门入口，PRD 口径）+ 排除本家庭隐藏的系统分类。
  // 仅显示当前 Tab 类型——支出 Tab 不混入收入分类，反之亦然。
  // 编辑时保留已隐藏的原分类，但一级分类不作为可选项。
  const hierarchy = useMemo(
    () => buildCategoryHierarchy(categoriesQ.data ?? [], layoutQ.data ?? []),
    [categoriesQ.data, layoutQ.data],
  );
  const categories = useMemo<Category[]>(
    () =>
      sortCategoriesByUsage(
        selectableRecordCategories(hierarchy, type, hiddenQ.data ?? new Set<string>(), editing?.category_id),
        usage,
        type,
      ),
    [hierarchy, hiddenQ.data, type, editing?.category_id, usage],
  );

  useEffect(() => {
    let active = true;
    void loadCategoryUsage(familyId, recorderId)
      .then((events) => {
        if (active) setUsage(events);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setUsageLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [familyId, recorderId]);

  useEffect(() => {
    let active = true;
    const prefix = `homebook:last-category:${familyId}:${recorderId}`;
    void AsyncStorage.multiGet([`${prefix}:expense`, `${prefix}:income`])
      .then((rows) => {
        if (active) setRecent({ expense: rows[0]?.[1] ?? null, income: rows[1]?.[1] ?? null });
      })
      .catch(() => {})
      .finally(() => {
        if (active) setRecentLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [familyId, recorderId]);

  // 旧流水若未重新选择分类，编辑时保留其原一级分类，避免自动改写历史。
  const keepingOriginalGroup =
    !!editing &&
    categoryId === editing.category_id &&
    type === editing.type &&
    !hierarchy.layoutById.get(editing.category_id)?.parent_category_id;

  // 用户选择优先；否则使用本人最近分类，首次或失效时回退到对应的「其他」。
  const effectiveCategoryId = useMemo(() => {
    if (keepingOriginalGroup) return categoryId;
    if (categoryId && categories.some((c) => c.id === categoryId)) return categoryId;
    if (recent[type] && categories.some((c) => c.id === recent[type])) return recent[type];
    return categories[0]?.id ?? null;
  }, [categoryId, categories, keepingOriginalGroup, recent, type]);

  // 常规宽度每行 5 个；窄屏减少列数，避免选中外环互相重叠。
  const catColumns = catAreaW > 0 ? Math.max(1, Math.min(5, Math.floor(catAreaW / 60))) : 5;
  const catItemW = catAreaW > 0 ? catAreaW / catColumns : 64;
  const toolbarHeight = Math.max(48, Math.ceil(48 * fontScale));

  const cents = rawToCents(raw);
  const categoriesReady = categoriesQ.isSuccess && layoutQ.isSuccess && hiddenQ.isSuccess;
  const canSave =
    cents > 0 && !!effectiveCategoryId && !!familyId && !saving && categoriesReady && (!!editing || recentLoaded);
  const amountColor = type === 'expense' ? palette.expense : palette.income;
  const sign = type === 'expense' ? '-' : '+';
  const parts = displayParts(raw);

  const press = (k: string) => {
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
    // 家庭第一笔？只查询是否存在任意流水，不加载历史列表。
    const isFirstRecord = !editing && hasTransactionsQ.isSuccess && !hasTransactionsQ.data;
    setAwaitingSave(true);
    try {
      if (editing) {
        await withDeadline(
          updateM.mutateAsync({
            id: editing.id,
            type,
            amount: cents,
            category_id: effectiveCategoryId,
            note: note || null,
            occurred_at: occurredAt.toISOString(),
            recorder_user_id: recorderUserId,
          }),
          SAVE_NETWORK_TIMEOUT_MS,
        );
        if (!mountedRef.current) return;
        onUpdated();
        onSaved?.({ firstRecord: false, updated: true });
        onClose();
        return;
      }

      await withDeadline(
        createM.mutateAsync({
          family_id: familyId,
          recorder_user_id: recorderUserId,
          type,
          amount: cents,
          category_id: effectiveCategoryId,
          note: note || null,
          occurred_at: occurredAt.toISOString(),
        }),
        SAVE_NETWORK_TIMEOUT_MS,
      );
      if (!mountedRef.current) return;
      if (recorderUserId === recorderId) {
        const savedAt = Date.now();
        if (usageLoaded) {
          setUsage((events) => [
            ...recentCategoryUsage(events, savedAt),
            { categoryId: effectiveCategoryId, type, savedAt },
          ]);
        }
        void recordCategoryUsage(familyId, recorderId, effectiveCategoryId, type).catch(() => {});
      }
      setRecent((previous) => ({ ...previous, [type]: effectiveCategoryId }));
      void AsyncStorage.setItem(`homebook:last-category:${familyId}:${recorderId}:${type}`, effectiveCategoryId).catch(
        () => {},
      );

      // 记一笔后行为（§18.3.1）：继续记下一笔 → 清空金额/备注/分类、面板不关；否则保存即关。
      if (afterBehavior === 'continue') {
        setRaw('');
        setNote('');
        setCategoryId(null);
        // 根上的 Toast 在 pageSheet 后面。面板不关时，把同一条提示画在面板里。
        playToastHaptic('success');
        setContinueToast({
          id: ++continueToastSeq.current,
          kind: 'success',
          text: t('record.savedContinue'),
          duration: 3000,
        });
      } else {
        // 庆祝交由父层在面板关闭后展示（onDismiss），这里只上报「是否家庭第一笔」并关闭面板。
        onSaved?.({ firstRecord: isFirstRecord });
        onClose();
      }
    } catch (e) {
      if (!mountedRef.current) return;
      if (isSaveAttemptTimeout(e) || isLikelyNetworkError(e)) {
        Alert.alert(t('record.networkRetry'), undefined, alertOk());
        return;
      }
      Alert.alert(t('record.saveFailed'), (e as Error).message ?? String(e), alertOk());
    } finally {
      if (mountedRef.current) setAwaitingSave(false);
    }
  };

  /** 单个分类圆底项（横滑与网格两种布局复用）。 */
  const renderCat = (c: Category, itemWidth: DimensionValue) => {
    const active = c.id === effectiveCategoryId;
    const color = catColors[categoryColorKey(c.name, type, c.color_key)];
    const name = displayCategoryName(c.name, c.is_system);
    const path =
      categoryPath(
        c.id,
        hierarchy,
        (category) => displayCategoryName(category.name, category.is_system),
        t('category.unspecified'),
      ) ?? name;
    const duplicate = categories.some(
      (other) => other.id !== c.id && displayCategoryName(other.name, other.is_system) === name,
    );
    return (
      <Pressable
        key={c.id}
        style={[styles.catItem, { width: itemWidth }]}
        accessibilityRole="radio"
        accessibilityLabel={path}
        accessibilityState={{ selected: active }}
        onPress={() => {
          setCategoryId(c.id);
          if (duplicate)
            setContinueToast({
              id: ++continueToastSeq.current,
              kind: 'info',
              text: t('category.selectedPath', { path }),
              duration: 2500,
            });
        }}
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
          {name}
        </Text>
      </Pressable>
    );
  };

  const divider = <View style={[styles.divider, { backgroundColor: palette.separator }]} />;
  const dateLabel = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(occurredAt);
  const timeLabel = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(occurredAt);

  // 详情卡（分类/备注/时间/记账人）。分类始终完整网格展示，且仅分类区在卡内纵向滚动。
  const detailCardNode = (
    <View style={[styles.detailCard, { backgroundColor: palette.card }]}>
      {/* 分类标题 */}
      <View style={styles.catHeader}>
        <Text style={[styles.catHeaderLabel, { color: palette.textSecondary }]}>{t('record.category')}</Text>
      </View>

      {/* 分类：完整网格；只在此区域滚动，备注／时间／记账人保持可见。 */}
      <View style={styles.catArea} onLayout={(e) => setCatAreaW(e.nativeEvent.layout.width)}>
        {categoriesQ.isLoading || layoutQ.isLoading || hiddenQ.isLoading || !usageLoaded ? (
          <View style={styles.catLoading}>
            <ActivityIndicator />
          </View>
        ) : !categoriesReady ? (
          <Pressable
            onPress={() => {
              void categoriesQ.refetch();
              void layoutQ.refetch();
              void hiddenQ.refetch();
            }}
          >
            <Text style={{ color: palette.textSecondary }}>{t('common.retry')}</Text>
          </Pressable>
        ) : (
          <ScrollView style={styles.catScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {keepingOriginalGroup ? (
              <Text style={{ color: palette.textSecondary, fontSize: 12, paddingVertical: Space[2] }}>
                {t('record.legacyCategoryKept')}
              </Text>
            ) : null}
            {categories.length === 0 && !keepingOriginalGroup ? (
              <Text style={{ color: palette.textSecondary }}>{t('record.noSubcategories')}</Text>
            ) : null}
            <View style={styles.catGrid}>{categories.map((c) => renderCat(c, catItemW))}</View>
          </ScrollView>
        )}
      </View>

      {divider}

      {/* 备注 */}
      <View style={styles.rowInner}>
        <SymbolView name="pencil" tintColor={palette.textTertiary} size={16} />
        <TextInput
          style={[styles.noteInput, { color: palette.textPrimary }]}
          placeholder={t('record.notePlaceholder')}
          placeholderTextColor={palette.textTertiary}
          value={note}
          onChangeText={setNote}
          maxLength={50}
          returnKeyType="done"
        />
      </View>

      {divider}

      {/* 日期、时间和记录人靠左排列，分别打开原生 popover。 */}
      <View style={styles.toolbar}>
        <Host style={[styles.toolbarHost, { height: toolbarHeight }]}>
          <HStack spacing={Space[1]} alignment="center">
            <HStack modifiers={[layoutPriority(1)]}>
              <Popover isPresented={dateOpen} onIsPresentedChange={setDateOpen}>
                <Popover.Trigger>
                  <UIButton
                    label={dateLabel}
                    systemImage="calendar"
                    onPress={() => {
                      setTimeOpen(false);
                      setMemberOpen(false);
                      setDateOpen(true);
                    }}
                    modifiers={[
                      padding({ horizontal: 8, vertical: 4 }),
                      frame({ width: DATE_TRIGGER_WIDTH }),
                      background(palette.cardPill, shapes.capsule()),
                      frame({ minHeight: 44 }),
                      tint(palette.accent),
                      accessibilityLabel(`${t('dates.date')}: ${dateLabel}`),
                    ]}
                  />
                </Popover.Trigger>
                <Popover.Content>
                  <VStack spacing={8} modifiers={[padding({ all: 16 }), frame({ width: 300 })]}>
                    <DatePicker
                      selection={occurredAt}
                      displayedComponents={['date']}
                      onDateChange={setOccurredAt}
                      modifiers={[
                        datePickerStyle('graphical'),
                        labelsHidden(),
                        environment('locale', INTL_LOCALE[locale]),
                        accessibilityLabel(t('dates.date')),
                      ]}
                    />
                  </VStack>
                </Popover.Content>
              </Popover>
            </HStack>
            <HStack modifiers={[layoutPriority(1)]}>
              <Popover isPresented={timeOpen} onIsPresentedChange={setTimeOpen}>
                <Popover.Trigger>
                  <UIButton
                    label={timeLabel}
                    systemImage="clock"
                    onPress={() => {
                      setDateOpen(false);
                      setMemberOpen(false);
                      setTimeOpen(true);
                    }}
                    modifiers={[
                      padding({ horizontal: 8, vertical: 4 }),
                      frame({ width: TIME_TRIGGER_WIDTH }),
                      background(palette.cardPill, shapes.capsule()),
                      frame({ minHeight: 44 }),
                      tint(palette.accent),
                      accessibilityLabel(`${t('record.time')}: ${timeLabel}`),
                    ]}
                  />
                </Popover.Trigger>
                <Popover.Content>
                  <VStack spacing={8} modifiers={[padding({ all: 16 }), frame({ width: 220 })]}>
                    <DatePicker
                      selection={occurredAt}
                      displayedComponents={['hourAndMinute']}
                      onDateChange={setOccurredAt}
                      modifiers={[
                        datePickerStyle('wheel'),
                        labelsHidden(),
                        environment('locale', INTL_LOCALE[locale]),
                        accessibilityLabel(t('record.time')),
                      ]}
                    />
                  </VStack>
                </Popover.Content>
              </Popover>
            </HStack>
            {showRecorder ? (
              <Popover isPresented={memberOpen} onIsPresentedChange={setMemberOpen}>
                <Popover.Trigger>
                  <UIButton
                    onPress={() => {
                      setDateOpen(false);
                      setTimeOpen(false);
                      setMemberOpen(true);
                    }}
                    modifiers={[
                      padding({ horizontal: 8, vertical: 4 }),
                      background(palette.cardPill, shapes.capsule()),
                      frame({ minHeight: 44 }),
                      tint(palette.accent),
                      accessibilityLabel(`${t('record.recorder')}: ${recorderName}`),
                    ]}
                  >
                    <HStack spacing={4} alignment="center">
                      <ListUserAvatar uri={avatarFiles.get(recorderUserId) ?? null} nickname={recorderName} size={22} />
                      <UIText modifiers={[lineLimit(1), truncationMode('tail')]}>{recorderName}</UIText>
                    </HStack>
                  </UIButton>
                </Popover.Trigger>
                <Popover.Content>
                  <VStack alignment="leading" spacing={4} modifiers={[padding({ all: 10 }), frame({ width: 220 })]}>
                    {members.map((member) => {
                      const active = member.userId === recorderUserId;
                      return (
                        <UIButton
                          key={member.id}
                          onPress={() => {
                            setRecorderUserId(member.userId);
                            setMemberOpen(false);
                          }}
                          modifiers={[
                            frame({ minHeight: 48, maxWidth: 200, alignment: 'leading' }),
                            accessibilityLabel(`${member.nickname}${active ? t('category.selected') : ''}`),
                          ]}
                        >
                          <HStack spacing={10} alignment="center">
                            <ListUserAvatar
                              uri={avatarFiles.get(member.userId) ?? null}
                              nickname={member.nickname}
                              size={32}
                            />
                            <UIText>{member.nickname}</UIText>
                            <Spacer minLength={0} />
                            {active ? <UIImage systemName="checkmark" color={palette.accent} size={16} /> : null}
                          </HStack>
                        </UIButton>
                      );
                    })}
                  </VStack>
                </Popover.Content>
              </Popover>
            ) : null}
            <Spacer minLength={0} />
          </HStack>
        </Host>
      </View>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <View style={styles.formArea}>
        {/* 居中抓手（替代「取消」：拖拽 / 下滑收起，由 pageSheet 原生处理） */}
        <View style={styles.grabberWrap}>
          <View style={[styles.grabber, { backgroundColor: palette.separator }]} />
        </View>

        {/* 标题行：标题居中（删除入口走列表左滑，DESIGN §9.9：非保存动作不放标题两侧） */}
        <View style={styles.topBar}>
          <View style={styles.topActionSpacer} />
          <Text style={[styles.topTitle, { color: palette.textPrimary }]}>
            {editing ? t('record.editTitle') : t('record.title')}
          </Text>
          <View style={styles.topActionSpacer} />
        </View>

        {/* 支出 / 收入：iOS 原生分段控件（SwiftUI Picker.segmented） */}
        <Host style={styles.segmentHost}>
          <Picker
            modifiers={[pickerStyle('segmented')]}
            selection={type}
            onSelectionChange={(value) => setType(value as TxnType)}
          >
            <UIText modifiers={[tag('expense')]}>{t('record.expense')}</UIText>
            <UIText modifiers={[tag('income')]}>{t('record.income')}</UIText>
          </Picker>
        </Host>

        {/* 大号金额（收入绿 / 支出红） */}
        <View style={styles.amountRow}>
          <Text style={[styles.amountSign, { color: amountColor }]}>{`${sign}¥`}</Text>
          <Text style={[styles.amountInt, { color: amountColor }]}>{parts.integer}</Text>
          {parts.hasDot ? <Text style={[styles.amountDec, { color: amountColor }]}>{`.${parts.decimal}`}</Text> : null}
        </View>

        {/* 详情卡固定在 dock 上方；只让分类区占用弹性高度并滚动。 */}
        <View style={styles.middleFlex}>{detailCardNode}</View>
      </View>

      {/* pageSheet 已为 Home Indicator 预留安全区；dock 不重复叠加 inset，才能贴近 sheet 底部。 */}
      <View style={styles.bottomDock}>
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

      {continueToast ? (
        <ToastNotice key={continueToast.id} item={continueToast} top={Space[8]} onHide={() => setContinueToast(null)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: Space[4], paddingTop: Space[2] },
  formArea: { flex: 1, minHeight: 0 },
  grabberWrap: { alignItems: 'center', paddingBottom: Space[1] },
  grabber: { width: 36, height: 5, borderRadius: Radius.full, alignSelf: 'center' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Space[3] },
  topAction: { fontSize: 16 },
  topActionRight: { width: 48, alignItems: 'flex-end' },
  topActionSpacer: { width: 48 },
  topTitle: { fontSize: 17, fontWeight: '600' },
  segmentHost: { height: 34, marginTop: Space[2] },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', paddingVertical: Space[5] },
  amountSign: { fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] },
  amountInt: { fontSize: 48, fontWeight: '700', fontVariant: ['tabular-nums'] },
  amountDec: { fontSize: 28, fontWeight: '400', fontVariant: ['tabular-nums'] },
  middleFlex: { flex: 1, minHeight: 0 },
  detailCard: { flex: 1, minHeight: 0, borderRadius: Radius.lg, paddingHorizontal: Space[4] },
  catHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Space[3],
    paddingBottom: Space[1],
  },
  catHeaderLabel: { fontSize: 13, fontWeight: '600' },
  catArea: { flex: 1, minHeight: 0 },
  catScroll: { flex: 1 },
  catLoading: { height: 80, alignItems: 'center', justifyContent: 'center' },
  // 完整网格按实测宽度均分，窄屏时自动减少列数。
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: Space[3], paddingVertical: Space[2] },
  catItem: { alignItems: 'center', gap: Space[1] },
  catRing: { width: 58, height: 58, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  catCircle: { width: 52, height: 52, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
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
  divider: { height: StyleSheet.hairlineWidth, marginLeft: Space[6] },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: Space[2], paddingVertical: Space[3], minHeight: 48 },
  noteInput: { flex: 1, fontSize: 15, padding: 0 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: Space[2], minHeight: 48 },
  toolbarHost: { flex: 1, minWidth: 0 },
  // pageSheet 自带安全区，额外留白用于避免按钮与底部圆角贴合。
  bottomDock: { paddingTop: Space[2], paddingBottom: Space[8] },
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
