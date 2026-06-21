/**
 * 搜索（流程 14 / PRD §16）：全屏页，按参考图实现。
 * 顶栏搜索框 + X；筛选为一行下拉胶囊（类型 / 时间 / 分类(多选) / 成员(多选) / 金额区间），
 * 各胶囊点开底部下拉面板选值，已设值的胶囊高亮（中性黑）。
 * 空 / 无条件态展示搜索历史（标签云，点回填 / 长按删 / 清空）；有条件时展示按日分组结果。
 * 结果行：分类图标 + 分类名 + 备注 + 「时间 · 成员」，点击复用记账面板编辑 / 删除（流程 10）。
 *
 * 检索为内存过滤（数据已由 useTransactions 全量加载）；过滤逻辑集中在 lib/search.ts，
 * 将来切本地 WatermelonDB 只改那一层。
 */
import {
  DatePicker,
  Host,
  HStack,
  ScrollView as UIScrollView,
  Spacer,
  Text as UIText,
  VStack,
} from '@expo/ui/swift-ui';
import {
  background,
  contentShape,
  cornerRadius,
  datePickerStyle,
  font,
  foregroundColor,
  frame,
  labelsHidden,
  onTapGesture,
  padding,
  shadow,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCategories, useFamilyMembers, useMyFamily, useMyProfile, useTransactions, type Transaction } from '@/api';
import { Toast } from '@/components/toast';
import { Radius, Space, useCategoryColors, usePalette } from '@/constants/design';
import { AmountText, CategoryAvatar } from '@/features/home/components';
import { RecordSheet } from '@/features/record/record-sheet';
import { categoryColorKey, categorySymbol } from '@/lib/category-style';
import { dayKey, formatAmount, humanDay, signForNet, signForType } from '@/lib/format';
import {
  hasAnyQuery,
  runSearch,
  validateFilters,
  type DatePresetKey,
  type SearchFilters,
  type TxnType,
} from '@/lib/search';

import { useSearchHistory } from './use-search-history';

const DATE_PRESETS: { key: DatePresetKey; label: string }[] = [
  { key: 'all', label: '全部时间' },
  { key: 'thisMonth', label: '本月' },
  { key: 'lastMonth', label: '上月' },
  { key: 'last7', label: '近 7 天' },
  { key: 'last30', label: '近 30 天' },
  { key: 'thisYear', label: '今年' },
  { key: 'custom', label: '自定义' },
];

/** 哪个筛选下拉面板正打开。 */
type FilterKind = 'type' | 'date' | 'category' | 'member' | 'amount';

/** 单条结果行数据（比首页更丰富：含时间与成员两段）。 */
type ResultRowData = {
  id: string;
  title: string;
  note: string | null;
  meta: string;
  symbol: string;
  iconColor: string;
  amountCents: number;
  sign: '+' | '-';
  amountColor: string;
};
type ResultGroup = { key: string; label: string; totalCents: number; rows: ResultRowData[] };

/** 记账时间 → HH:MM。 */
function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export function SearchSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      {visible ? <SearchBody onClose={onClose} /> : null}
    </Modal>
  );
}

function SearchBody({ onClose }: { onClose: () => void }) {
  const palette = usePalette();
  const catColors = useCategoryColors();

  const txnsQ = useTransactions();
  const catsQ = useCategories();
  const membersQ = useFamilyMembers();
  const familyQ = useMyFamily();
  const profileQ = useMyProfile();

  const history = useSearchHistory();

  const [keyword, setKeyword] = useState('');
  const [types, setTypes] = useState<Set<TxnType>>(new Set());
  const [categoryIds, setCategoryIds] = useState<Set<string>>(new Set());
  const [recorderIds, setRecorderIds] = useState<Set<string>>(new Set());
  const [datePreset, setDatePreset] = useState<DatePresetKey>('all');
  const [customFrom, setCustomFrom] = useState<Date | null>(null);
  const [customTo, setCustomTo] = useState<Date | null>(null);
  const [amountMinYuan, setAmountMinYuan] = useState('');
  const [amountMaxYuan, setAmountMaxYuan] = useState('');

  const [openFilter, setOpenFilter] = useState<FilterKind | null>(null);
  // 点击结果行 → 复用记账面板编辑（流程 10）；储蓄类不可在此编辑（PRD §12.2）。
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const multiMember = (familyQ.data?.member_count ?? 1) > 1;
  const myId = profileQ.data?.id;

  const filters = useMemo<SearchFilters>(
    () => ({
      keyword,
      types,
      categoryIds,
      recorderIds,
      datePreset,
      customFrom,
      customTo,
      amountMinYuan,
      amountMaxYuan,
    }),
    [keyword, types, categoryIds, recorderIds, datePreset, customFrom, customTo, amountMinYuan, amountMaxYuan],
  );

  const hasQuery = hasAnyQuery(filters);
  const errors = validateFilters(filters);

  const { groups, valid } = useMemo(() => {
    const txns = txnsQ.data ?? [];
    const cats = catsQ.data ?? [];
    const members = membersQ.data ?? [];
    const catById = new Map(cats.map((c) => [c.id, c]));
    const nameById = new Map(members.map((m) => [m.id, m.nickname]));

    const result = runSearch(txns, filters, {
      categoryNameById: new Map(cats.map((c) => [c.id, c.name])),
      recorderNameById: nameById,
      myId,
    });

    const map = new Map<string, ResultGroup>();
    for (const t of result.matched) {
      const cat = catById.get(t.category_id);
      const ttype: 'income' | 'expense' = t.type === 'income' ? 'income' : 'expense';
      const who = t.recorder_user_id === myId ? '我' : (nameById.get(t.recorder_user_id) ?? '成员');
      const isSavings = t.source !== 'normal';
      // 储蓄类在备注行单独标注，金额不并入合计口径（已在 lib/search.ts 处理）。
      const note = isSavings ? (t.note ? `储蓄 · ${t.note}` : '储蓄') : t.note;
      const meta = multiMember ? `${hhmm(t.occurred_at)} · ${who}` : hhmm(t.occurred_at);

      const key = dayKey(t.occurred_at);
      const group =
        map.get(key) ??
        (() => {
          const g: ResultGroup = { key, label: humanDay(t.occurred_at), totalCents: 0, rows: [] };
          map.set(key, g);
          return g;
        })();
      group.totalCents += ttype === 'income' ? t.amount : -t.amount;
      group.rows.push({
        id: t.id,
        title: cat?.name ?? '未分类',
        note,
        meta,
        symbol: categorySymbol(cat?.icon ?? null, ttype),
        iconColor: catColors[categoryColorKey(cat?.name ?? '', ttype)],
        amountCents: t.amount,
        sign: signForType(ttype),
        amountColor: ttype === 'income' ? palette.income : palette.expense,
      });
    }
    return { groups: Array.from(map.values()), valid: result.valid };
  }, [txnsQ.data, catsQ.data, membersQ.data, filters, myId, multiMember, catColors, palette]);

  const categories = catsQ.data ?? [];
  const members = membersQ.data ?? [];
  const typeIsAll = types.size === 0;

  const setType = (v: TxnType | null) => setTypes(v ? new Set([v]) : new Set());

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const onPickPreset = (key: DatePresetKey) => {
    setDatePreset(key);
    if (key === 'custom') {
      const now = new Date();
      setCustomFrom((v) => v ?? new Date(now.getFullYear(), now.getMonth(), 1));
      setCustomTo((v) => v ?? now);
    } else {
      setOpenFilter(null);
    }
  };

  // 点击结果行：储蓄类引导去目标页；已被他人删除时提示并刷新。
  const onRowPress = (id: string) => {
    const txn = (txnsQ.data ?? []).find((t) => t.id === id);
    if (!txn) {
      setHint('该记录已不存在');
      txnsQ.refetch();
      return;
    }
    if (txn.source !== 'normal') {
      setHint('储蓄流水请在对应储蓄目标内管理');
      return;
    }
    setEditing(txn);
  };

  // 筛选胶囊：固定标签，已设值仅变色（方案 A：标签恒定，5 个全部可见、不横滑）。
  const amountSet = amountMinYuan.trim() !== '' || amountMaxYuan.trim() !== '';

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        {/* 顶栏：搜索框（含关闭 X） */}
        <View style={styles.topBar}>
          <View style={[styles.searchBox, { backgroundColor: palette.card }]}>
            <SymbolView name="magnifyingglass" tintColor={palette.textTertiary} size={17} />
            <TextInput
              style={[styles.searchInput, { color: palette.textPrimary }]}
              placeholder="搜索备注 / 分类 / 成员 / 金额"
              placeholderTextColor={palette.textTertiary}
              value={keyword}
              onChangeText={setKeyword}
              onSubmitEditing={() => history.push(keyword)}
              autoFocus
              autoCorrect={false}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
            <View style={[styles.searchDivider, { backgroundColor: palette.separator }]} />
            <Pressable hitSlop={10} onPress={onClose}>
              <SymbolView name="xmark" tintColor={palette.textSecondary} size={16} />
            </Pressable>
          </View>
        </View>

        {/* 筛选：等宽平铺一行（标签固定，已设值变色，全部可见、不横滑） */}
        <View style={styles.pillRow}>
          <FilterPill
            icon="arrow.up.arrow.down"
            label="类型"
            active={!typeIsAll}
            onPress={() => setOpenFilter('type')}
          />
          <FilterPill
            icon="calendar"
            label="时间"
            active={datePreset !== 'all'}
            onPress={() => setOpenFilter('date')}
          />
          <FilterPill
            icon="square.grid.2x2"
            label="分类"
            active={categoryIds.size > 0}
            onPress={() => setOpenFilter('category')}
          />
          {multiMember ? (
            <FilterPill
              icon="person"
              label="成员"
              active={recorderIds.size > 0}
              onPress={() => setOpenFilter('member')}
            />
          ) : null}
          <FilterPill icon="yensign" label="金额" active={amountSet} onPress={() => setOpenFilter('amount')} />
        </View>

        <View style={[styles.separator, { backgroundColor: palette.separator }]} />

        {/* 主体：搜索历史 / 校验提示 / 结果 / 空结果 */}
        {!hasQuery ? (
          <HistoryCloud history={history} onPick={setKeyword} />
        ) : !valid ? (
          <View style={styles.center}>
            <SymbolView name="exclamationmark.circle" tintColor={palette.textTertiary} size={44} />
            <Text style={{ color: palette.textSecondary }}>筛选条件有误，请检查金额 / 日期区间</Text>
          </View>
        ) : groups.length === 0 ? (
          <View style={styles.center}>
            <SymbolView name="magnifyingglass" tintColor={palette.textTertiary} size={44} />
            <Text style={{ color: palette.textSecondary }}>没有匹配的流水，换个词或放宽条件</Text>
          </View>
        ) : (
          <Host style={styles.flex}>
            <UIScrollView>
              <VStack
                spacing={Space[5]}
                modifiers={[padding({ horizontal: Space[4], top: Space[2], bottom: Space[10] })]}
              >
                {groups.map((g) => (
                  <ResultDayGroup
                    key={g.key}
                    label={g.label}
                    totalCents={g.totalCents}
                    rows={g.rows}
                    onRowPress={onRowPress}
                  />
                ))}
              </VStack>
            </UIScrollView>
          </Host>
        )}
      </SafeAreaView>

      {/* 筛选下拉面板（底部） */}
      <FilterDropdown
        kind={openFilter}
        onClose={() => setOpenFilter(null)}
        types={types}
        setType={setType}
        typeIsAll={typeIsAll}
        datePreset={datePreset}
        onPickPreset={onPickPreset}
        customFrom={customFrom}
        customTo={customTo}
        setCustomFrom={setCustomFrom}
        setCustomTo={setCustomTo}
        dateError={errors.date}
        categories={categories}
        categoryIds={categoryIds}
        setCategoryIds={setCategoryIds}
        members={members}
        myId={myId}
        recorderIds={recorderIds}
        setRecorderIds={setRecorderIds}
        amountMinYuan={amountMinYuan}
        amountMaxYuan={amountMaxYuan}
        setAmountMinYuan={setAmountMinYuan}
        setAmountMaxYuan={setAmountMaxYuan}
        amountError={errors.amount}
        toggle={toggle}
      />

      {/* 编辑 / 删除（流程 10）；保存后 RQ 失效 → 结果自动重算 */}
      <RecordSheet
        visible={!!editing}
        editing={editing}
        familyId={editing?.family_id ?? ''}
        recorderId={myId ?? ''}
        onClose={() => setEditing(null)}
      />

      <Toast visible={!!hint} text={hint ?? ''} onHide={() => setHint(null)} />
    </View>
  );
}

// ── 筛选胶囊 ──────────────────────────────────────────────────────────────────
function FilterPill({
  icon,
  label,
  active,
  onPress,
}: {
  icon: SymbolViewProps['name'];
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  const fg = active ? palette.onAccent : palette.textPrimary;
  return (
    <Pressable onPress={onPress} style={[styles.pill, { backgroundColor: active ? palette.accent : palette.card }]}>
      <SymbolView name={icon} tintColor={active ? palette.onAccent : palette.textSecondary} size={13} />
      <Text numberOfLines={1} style={{ color: fg, fontSize: 13 }}>
        {label}
      </Text>
      <SymbolView name="chevron.down" tintColor={active ? palette.onAccent : palette.textTertiary} size={9} />
    </Pressable>
  );
}

// ── 搜索历史（标签云）─────────────────────────────────────────────────────────
function HistoryCloud({
  history,
  onPick,
}: {
  history: ReturnType<typeof useSearchHistory>;
  onPick: (kw: string) => void;
}) {
  const palette = usePalette();
  if (history.items.length === 0) {
    return (
      <View style={styles.center}>
        <SymbolView name="text.magnifyingglass" tintColor={palette.textTertiary} size={44} />
        <Text style={{ color: palette.textSecondary }}>输入关键词或选择筛选条件，开始搜索</Text>
      </View>
    );
  }
  return (
    <View style={styles.historyWrap}>
      <View style={styles.historyHeader}>
        <View style={styles.historyTitleWrap}>
          <SymbolView name="clock" tintColor={palette.textSecondary} size={15} />
          <Text style={[styles.historyTitle, { color: palette.textPrimary }]}>搜索历史</Text>
        </View>
        <Pressable hitSlop={8} onPress={history.clear}>
          <Text style={[styles.historyClear, { color: palette.info }]}>清空历史</Text>
        </Pressable>
      </View>
      <View style={styles.cloud}>
        {history.items.map((kw) => (
          <Pressable
            key={kw}
            style={[styles.historyTag, { backgroundColor: palette.card }]}
            onPress={() => onPick(kw)}
            onLongPress={() => history.remove(kw)}
          >
            <Text style={[styles.historyTagText, { color: palette.textPrimary }]} numberOfLines={1}>
              {kw}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={[styles.historyHint, { color: palette.textTertiary }]}>长按可删除单条</Text>
    </View>
  );
}

// ── 结果：按日分组（SwiftUI 卡片，含富信息行）─────────────────────────────────
function ResultDayGroup({
  label,
  totalCents,
  rows,
  onRowPress,
}: {
  label: string;
  totalCents: number;
  rows: ResultRowData[];
  onRowPress: (id: string) => void;
}) {
  const palette = usePalette();
  return (
    <VStack alignment="leading" spacing={Space[2]}>
      <HStack modifiers={[padding({ horizontal: Space[1] })]}>
        <UIText modifiers={[font({ size: 13 }), foregroundColor(palette.textSecondary)]}>{label}</UIText>
        <Spacer />
        <UIText modifiers={[font({ size: 13 }), foregroundColor(palette.textSecondary)]}>
          {formatAmount(totalCents, signForNet(totalCents))}
        </UIText>
      </HStack>
      <VStack
        spacing={0}
        modifiers={[
          background(palette.card),
          cornerRadius(Radius.lg),
          shadow({ radius: 8, x: 0, y: 1, color: palette.shadow }),
        ]}
      >
        {rows.map((row, i) => (
          <VStack key={row.id} spacing={0}>
            {i > 0 ? (
              <HStack modifiers={[padding({ leading: 70 })]}>
                <HStack modifiers={[frame({ height: 0.5, maxWidth: 9999 }), background(palette.separator)]}>
                  <Spacer />
                </HStack>
              </HStack>
            ) : null}
            <ResultRow row={row} onPress={onRowPress} />
          </VStack>
        ))}
      </VStack>
    </VStack>
  );
}

function ResultRow({ row, onPress }: { row: ResultRowData; onPress: (id: string) => void }) {
  const palette = usePalette();
  return (
    <HStack
      spacing={Space[3]}
      alignment="center"
      modifiers={[
        padding({ vertical: Space[3], horizontal: Space[4] }),
        // 整行（含 Spacer 空隙）都可点，否则结果行留白处点不动
        contentShape(shapes.rectangle()),
        onTapGesture(() => onPress(row.id)),
      ]}
    >
      <CategoryAvatar symbol={row.symbol} color={row.iconColor} />
      <VStack alignment="leading" spacing={2}>
        <UIText modifiers={[font({ size: 17, weight: 'medium' }), foregroundColor(palette.textPrimary)]}>
          {row.title}
        </UIText>
        {row.note ? (
          <UIText modifiers={[font({ size: 13 }), foregroundColor(palette.textSecondary)]}>{row.note}</UIText>
        ) : null}
        <UIText modifiers={[font({ size: 13 }), foregroundColor(palette.textTertiary)]}>{row.meta}</UIText>
      </VStack>
      <Spacer />
      <AmountText
        cents={row.amountCents}
        sign={row.sign}
        color={row.amountColor}
        integerSize={17}
        decimalSize={13}
        weight="semibold"
      />
    </HStack>
  );
}

// ── 筛选下拉面板（底部 sheet，按 kind 切换内容）──────────────────────────────
type DropdownProps = {
  kind: FilterKind | null;
  onClose: () => void;
  types: Set<TxnType>;
  setType: (v: TxnType | null) => void;
  typeIsAll: boolean;
  datePreset: DatePresetKey;
  onPickPreset: (k: DatePresetKey) => void;
  customFrom: Date | null;
  customTo: Date | null;
  setCustomFrom: (d: Date) => void;
  setCustomTo: (d: Date) => void;
  dateError: boolean;
  categories: { id: string; name: string }[];
  categoryIds: Set<string>;
  setCategoryIds: (s: Set<string>) => void;
  members: { id: string; nickname: string }[];
  myId: string | undefined;
  recorderIds: Set<string>;
  setRecorderIds: (s: Set<string>) => void;
  amountMinYuan: string;
  amountMaxYuan: string;
  setAmountMinYuan: (s: string) => void;
  setAmountMaxYuan: (s: string) => void;
  amountError: boolean;
  toggle: (set: Set<string>, setter: (s: Set<string>) => void, id: string) => void;
};

const TITLES: Record<FilterKind, string> = {
  type: '类型',
  date: '时间',
  category: '分类',
  member: '成员',
  amount: '金额区间',
};

function FilterDropdown(props: DropdownProps) {
  const { kind, onClose } = props;
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={kind !== null} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.flex}>
        <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetAnchor}
          pointerEvents="box-none"
        >
          <View
            style={[styles.sheet, { backgroundColor: palette.elevated, paddingBottom: insets.bottom + Space[3] }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={[styles.grabber, { backgroundColor: palette.separator }]} />
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderSide} />
              <Text style={[styles.sheetTitle, { color: palette.textPrimary }]}>{kind ? TITLES[kind] : ''}</Text>
              <Pressable style={styles.sheetHeaderSide} hitSlop={8} onPress={onClose}>
                <Text style={[styles.sheetDone, { color: palette.info }]}>完成</Text>
              </Pressable>
            </View>
            {kind ? <DropdownContent {...props} kind={kind} /> : null}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function DropdownContent(props: DropdownProps & { kind: FilterKind }) {
  const palette = usePalette();
  const {
    kind,
    types,
    setType,
    typeIsAll,
    datePreset,
    onPickPreset,
    customFrom,
    customTo,
    setCustomFrom,
    setCustomTo,
    dateError,
    categories,
    categoryIds,
    setCategoryIds,
    members,
    myId,
    recorderIds,
    setRecorderIds,
    amountMinYuan,
    amountMaxYuan,
    setAmountMinYuan,
    setAmountMaxYuan,
    amountError,
    toggle,
  } = props;

  if (kind === 'type') {
    return (
      <View>
        <OptionRow label="不限" active={typeIsAll} onPress={() => setType(null)} />
        <OptionRow label="支出" active={types.has('expense')} onPress={() => setType('expense')} />
        <OptionRow label="收入" active={types.has('income')} onPress={() => setType('income')} />
      </View>
    );
  }

  if (kind === 'date') {
    return (
      <View>
        {DATE_PRESETS.map((p) => (
          <OptionRow key={p.key} label={p.label} active={datePreset === p.key} onPress={() => onPickPreset(p.key)} />
        ))}
        {datePreset === 'custom' ? (
          <View style={styles.customDateRow}>
            <Text style={[styles.fieldLabel, { color: palette.textSecondary }]}>从</Text>
            <Host matchContents style={styles.dateHost}>
              <DatePicker
                selection={customFrom ?? new Date()}
                displayedComponents={['date']}
                onDateChange={setCustomFrom}
                modifiers={[datePickerStyle('compact'), labelsHidden()]}
              />
            </Host>
            <Text style={[styles.fieldLabel, { color: palette.textSecondary }]}>到</Text>
            <Host matchContents style={styles.dateHost}>
              <DatePicker
                selection={customTo ?? new Date()}
                displayedComponents={['date']}
                onDateChange={setCustomTo}
                modifiers={[datePickerStyle('compact'), labelsHidden()]}
              />
            </Host>
          </View>
        ) : null}
        {dateError ? <Text style={[styles.errorText, { color: palette.danger }]}>起始日期不能晚于结束日期</Text> : null}
      </View>
    );
  }

  if (kind === 'category') {
    return (
      <ScrollView style={styles.sheetScroll} keyboardShouldPersistTaps="handled">
        <OptionRow label="全部分类" active={categoryIds.size === 0} onPress={() => setCategoryIds(new Set())} />
        {categories.map((c) => (
          <OptionRow
            key={c.id}
            label={c.name}
            active={categoryIds.has(c.id)}
            onPress={() => toggle(categoryIds, setCategoryIds, c.id)}
          />
        ))}
      </ScrollView>
    );
  }

  if (kind === 'member') {
    return (
      <ScrollView style={styles.sheetScroll} keyboardShouldPersistTaps="handled">
        <OptionRow label="全部成员" active={recorderIds.size === 0} onPress={() => setRecorderIds(new Set())} />
        {members.map((m) => (
          <OptionRow
            key={m.id}
            label={m.id === myId ? '我' : m.nickname}
            active={recorderIds.has(m.id)}
            onPress={() => toggle(recorderIds, setRecorderIds, m.id)}
          />
        ))}
      </ScrollView>
    );
  }

  // amount
  return (
    <View style={styles.amountSheet}>
      <View style={styles.amountRow}>
        <TextInput
          style={[styles.amountInput, { backgroundColor: palette.card, color: palette.textPrimary }]}
          placeholder="最小"
          placeholderTextColor={palette.textTertiary}
          value={amountMinYuan}
          onChangeText={setAmountMinYuan}
          keyboardType="decimal-pad"
        />
        <Text style={[styles.fieldLabel, { color: palette.textSecondary }]}>至</Text>
        <TextInput
          style={[styles.amountInput, { backgroundColor: palette.card, color: palette.textPrimary }]}
          placeholder="最大"
          placeholderTextColor={palette.textTertiary}
          value={amountMaxYuan}
          onChangeText={setAmountMaxYuan}
          keyboardType="decimal-pad"
        />
        <Text style={[styles.fieldUnit, { color: palette.textTertiary }]}>元</Text>
      </View>
      {amountError ? <Text style={[styles.errorText, { color: palette.danger }]}>最小金额不能大于最大金额</Text> : null}
    </View>
  );
}

function OptionRow({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable style={styles.optionRow} onPress={onPress}>
      <Text style={{ color: palette.textPrimary, fontSize: 16 }}>{label}</Text>
      <View style={styles.flex} />
      {active ? <SymbolView name="checkmark" tintColor={palette.info} size={18} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  topBar: { paddingHorizontal: Space[4], paddingTop: Space[2], paddingBottom: Space[2] },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[2],
    height: 40,
    borderRadius: Radius.md,
    paddingHorizontal: Space[3],
  },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 0 },
  searchDivider: { width: StyleSheet.hairlineWidth, height: 20 },
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[2],
    paddingHorizontal: Space[4],
    paddingVertical: Space[2],
  },
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space[1],
    paddingHorizontal: Space[2],
    height: 34,
    borderRadius: Radius.full,
  },
  separator: { height: StyleSheet.hairlineWidth, marginTop: Space[1] },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space[3] },
  // 搜索历史
  historyWrap: { paddingHorizontal: Space[4], paddingTop: Space[4] },
  historyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  historyTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: Space[2] },
  historyTitle: { fontSize: 15, fontWeight: '600' },
  historyClear: { fontSize: 14 },
  cloud: { flexDirection: 'row', flexWrap: 'wrap', gap: Space[2], marginTop: Space[4] },
  historyTag: { paddingHorizontal: Space[4], paddingVertical: Space[2], borderRadius: Radius.full, maxWidth: 200 },
  historyTagText: { fontSize: 14 },
  historyHint: { fontSize: 12, marginTop: Space[4] },
  // 底部下拉面板
  backdrop: { backgroundColor: 'rgba(0,0,0,0.35)' },
  sheetAnchor: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    paddingHorizontal: Space[4],
  },
  grabber: { width: 36, height: 5, borderRadius: Radius.full, alignSelf: 'center', marginTop: Space[2] },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Space[3],
  },
  sheetHeaderSide: { width: 48, alignItems: 'flex-end' },
  sheetTitle: { fontSize: 16, fontWeight: '600' },
  sheetDone: { fontSize: 16 },
  sheetScroll: { maxHeight: 360 },
  optionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: Space[3], minHeight: 48 },
  customDateRow: { flexDirection: 'row', alignItems: 'center', gap: Space[2], paddingVertical: Space[3] },
  dateHost: { minWidth: 120, minHeight: 30 },
  amountSheet: { paddingVertical: Space[3] },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: Space[2] },
  amountInput: { width: 96, height: 38, borderRadius: Radius.sm, paddingHorizontal: Space[3], fontSize: 15 },
  fieldLabel: { fontSize: 14 },
  fieldUnit: { fontSize: 13 },
  errorText: { fontSize: 12, paddingTop: Space[2] },
});
