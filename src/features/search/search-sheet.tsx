/**
 * 搜索（流程 14 / PRD §16）：独立路由页，按参考图实现。
 * 顶栏：返回 + 搜索框 + 取消；筛选为单行横向滚动摘要胶囊。
 * 空态：最近搜索卡片 + 引导插图；无结果：search-empty.png 占位图。
 * 金额 / 日期筛选为底部 BottomSheet；结果列表复用首页 DayGroup（点击查看详情、左滑编辑/删除）。
 */
import { DatePicker, Host, List, Section, VStack } from '@expo/ui/swift-ui';
import {
  datePickerStyle,
  labelsHidden,
  listRowBackground,
  listRowInsets,
  listRowSeparator,
  listSectionSpacing,
  listStyle,
} from '@expo/ui/swift-ui/modifiers';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useMemo, useState } from 'react';
import {
  Alert,
  Image,
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

import {
  useCategories,
  useFamilyMembers,
  useMyFamily,
  useMyProfile,
  useSoftDeleteTransaction,
  useTransactions,
  type Transaction,
} from '@/api';
import { Toast } from '@/components/toast';
import { Radius, Space, useCategoryColors, usePalette } from '@/constants/design';
import { avatarTint, DayGroup, EndOfListHint, type AvatarInfo, type RowData } from '@/features/home/components';
import { TransactionDetailSheet } from '@/features/home/transaction-detail-sheet';
import { useAvatarFiles } from '@/features/home/use-avatar-files';
import { RecordSheet } from '@/features/record/record-sheet';
import { categoryColorKey, categorySymbol } from '@/lib/category-style';
import { clockTime, dayKey, humanDay, signForType } from '@/lib/format';
import {
  hasAnyQuery,
  runSearch,
  validateFilters,
  type DatePresetKey,
  type SearchFilters,
  type TxnType,
} from '@/lib/search';
import {
  compactAmountFilterLabel,
  customDateFilterLabel,
  DATE_PRESET_LABELS,
  summarizeSelectedLabels,
} from '@/lib/search-labels';

import { useSearchHistory } from './use-search-history';

const DATE_PRESET_OPTIONS: { key: DatePresetKey; label: string }[] = [
  { key: 'all', label: '不限' },
  { key: 'thisMonth', label: '本月' },
  { key: 'lastMonth', label: '上月' },
  { key: 'last7', label: '近 7 天' },
  { key: 'last30', label: '近 30 天' },
  { key: 'thisYear', label: '今年' },
];

/** 哪个筛选下拉面板正打开。 */
type FilterKind = 'type' | 'date' | 'category' | 'member' | 'amount';

type ResultGroup = { key: string; label: string; totalCents: number; rows: RowData[] };

const AMOUNT_RANGES = [
  { label: '0–100', min: '0', max: '100' },
  { label: '100–500', min: '100', max: '500' },
  { label: '500–1000', min: '500', max: '1000' },
  { label: '1000 以上', min: '1000', max: '' },
] as const;

export function SearchScreen({ onClose }: { onClose: () => void }) {
  return <SearchBody onClose={onClose} />;
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
  // 点击结果行 → 详情；左滑 → 编辑 / 删除，与首页列表一致。
  const [detail, setDetail] = useState<{ open: boolean; txn: Transaction | null }>({ open: false, txn: null });
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const softDeleteM = useSoftDeleteTransaction();

  const multiMember = (familyQ.data?.member_count ?? 1) > 1;
  const myId = profileQ.data?.id;
  const avatarFiles = useAvatarFiles(membersQ.data ?? []);

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
    const memberById = new Map(members.map((m) => [m.id, m]));
    const myNick = profileQ.data?.nickname;

    const result = runSearch(txns, filters, {
      categoryNameById: new Map(cats.map((c) => [c.id, c.name])),
      recorderNameById: nameById,
      myId,
    });

    const avatarOf = (userId: string): AvatarInfo => {
      const nick = (userId === myId ? myNick : memberById.get(userId)?.nickname) ?? '成员';
      const initial = [...nick.trim()][0]?.toUpperCase() ?? '?';
      return { uri: avatarFiles.get(userId) ?? null, initial, tint: avatarTint(userId) };
    };

    const map = new Map<string, ResultGroup>();
    for (const t of result.matched) {
      const cat = catById.get(t.category_id);
      const ttype: 'income' | 'expense' = t.type === 'income' ? 'income' : 'expense';
      const isSavings = t.source !== 'normal';
      // 储蓄类在备注行单独标注，金额不并入合计口径（已在 lib/search.ts 处理）。
      const note = isSavings ? (t.note ? `储蓄 · ${t.note}` : '储蓄') : t.note;
      const editedByOther = !!t.last_editor_user_id && t.last_editor_user_id !== t.recorder_user_id;

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
        symbol: categorySymbol(cat?.icon ?? null, ttype),
        iconColor: catColors[categoryColorKey(cat?.name ?? '', ttype)],
        amountCents: t.amount,
        sign: signForType(ttype),
        amountColor: ttype === 'income' ? palette.income : palette.expense,
        timeLabel: clockTime(editedByOther ? t.updated_at : t.occurred_at),
        recorder: avatarOf(t.recorder_user_id),
        editor: editedByOther ? avatarOf(t.last_editor_user_id as string) : null,
      });
    }
    return { groups: Array.from(map.values()), valid: result.valid };
  }, [txnsQ.data, catsQ.data, membersQ.data, profileQ.data, filters, myId, avatarFiles, catColors, palette]);

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
    }
  };

  const onRowPress = (id: string) => {
    const txn = (txnsQ.data ?? []).find((t) => t.id === id);
    if (!txn) {
      setHint('该记录已不存在');
      txnsQ.refetch();
      return;
    }
    setDetail({ open: true, txn });
  };

  const openEdit = (id: string) => {
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

  const confirmDelete = (id: string) => {
    const txn = (txnsQ.data ?? []).find((t) => t.id === id);
    if (txn?.source !== 'normal') {
      setHint('储蓄流水请在对应储蓄目标内管理');
      return;
    }
    Alert.alert('删除这笔记录？', '删除后将从账单中移除，无法在 App 内恢复。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => softDeleteM.mutate(id, { onError: (e) => Alert.alert('删除失败', (e as Error).message) }),
      },
    ]);
  };

  const amountSet = amountMinYuan.trim() !== '' || amountMaxYuan.trim() !== '';
  const filtersActive = !typeIsAll || categoryIds.size > 0 || recorderIds.size > 0 || datePreset !== 'all' || amountSet;
  const typeLabel = types.has('expense') ? '支出' : types.has('income') ? '收入' : '类型';
  const categoryLabel =
    categoryIds.size > 0
      ? summarizeSelectedLabels(categories.filter((c) => categoryIds.has(c.id)).map((c) => c.name))
      : '分类';
  const memberLabel =
    recorderIds.size > 0
      ? summarizeSelectedLabels(
          members.filter((m) => recorderIds.has(m.id)).map((m) => (m.id === myId ? '我' : m.nickname)),
        )
      : '成员';
  const dateLabel =
    datePreset === 'custom' ? customDateFilterLabel(customFrom, customTo) : DATE_PRESET_LABELS[datePreset];
  const amountLabel = compactAmountFilterLabel(amountMinYuan, amountMaxYuan);

  const clearFilters = () => {
    setTypes(new Set());
    setCategoryIds(new Set());
    setRecorderIds(new Set());
    setDatePreset('all');
    setCustomFrom(null);
    setCustomTo(null);
    setAmountMinYuan('');
    setAmountMaxYuan('');
  };

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        {/* 顶栏：返回 + 搜索框 + 取消，独立路由页形态。 */}
        <View style={styles.topBar}>
          <Pressable
            style={styles.navIconButton}
            hitSlop={10}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="返回"
          >
            <SymbolView name="chevron.left" tintColor={palette.textPrimary} size={21} />
          </Pressable>
          <View style={[styles.searchBox, { backgroundColor: palette.card }]}>
            <SymbolView name="magnifyingglass" tintColor={palette.textTertiary} size={17} />
            <TextInput
              style={[styles.searchInput, { color: palette.textPrimary }]}
              placeholder="搜索备注、分类或成员"
              placeholderTextColor={palette.textTertiary}
              value={keyword}
              onChangeText={setKeyword}
              onSubmitEditing={() => history.push(keyword)}
              autoFocus
              autoCorrect={false}
              returnKeyType="search"
              clearButtonMode="never"
            />
            {keyword.trim() ? (
              <Pressable
                hitSlop={8}
                onPress={() => setKeyword('')}
                accessibilityRole="button"
                accessibilityLabel="清空搜索关键词"
              >
                <SymbolView name="xmark.circle.fill" tintColor={palette.textTertiary} size={17} />
              </Pressable>
            ) : null}
          </View>
          <Pressable style={styles.cancelButton} hitSlop={10} onPress={onClose} accessibilityRole="button">
            <Text style={[styles.cancelText, { color: palette.info }]}>取消</Text>
          </Pressable>
        </View>

        {/* 筛选：单行横向滚动，每个维度聚合为一个摘要胶囊。 */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.pillScroller}
          contentContainerStyle={styles.pillRow}
        >
          <FilterPill
            icon="arrow.up.arrow.down"
            label={typeLabel}
            active={!typeIsAll}
            onPress={() => setOpenFilter('type')}
          />
          <FilterPill
            icon="calendar"
            label={dateLabel}
            active={datePreset !== 'all'}
            onPress={() => setOpenFilter('date')}
          />
          <FilterPill
            icon="square.grid.2x2"
            label={categoryLabel}
            active={categoryIds.size > 0}
            onPress={() => setOpenFilter('category')}
          />
          {multiMember ? (
            <FilterPill
              icon="person"
              label={memberLabel}
              active={recorderIds.size > 0}
              onPress={() => setOpenFilter('member')}
            />
          ) : null}
          <FilterPill icon="yensign" label={amountLabel} active={amountSet} onPress={() => setOpenFilter('amount')} />
          {filtersActive ? <ResetPill onPress={clearFilters} /> : null}
        </ScrollView>

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
          <NoResultEmpty filtersActive={filtersActive} onClearFilters={clearFilters} />
        ) : (
          <Host style={styles.flex}>
            <List modifiers={[listStyle('insetGrouped'), listSectionSpacing(Space[3])]}>
              {groups.map((g) => (
                <DayGroup
                  key={g.key}
                  label={g.label}
                  totalCents={g.totalCents}
                  rows={g.rows}
                  onRowPress={onRowPress}
                  onEdit={openEdit}
                  onDelete={confirmDelete}
                />
              ))}
              <Section modifiers={[listRowBackground(palette.base), listRowSeparator('hidden')]}>
                <VStack
                  modifiers={[
                    listRowInsets({ top: Space[2], bottom: Space[6], leading: Space[4], trailing: Space[4] }),
                  ]}
                >
                  <EndOfListHint />
                </VStack>
              </Section>
            </List>
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
        setDatePreset={setDatePreset}
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

      <TransactionDetailSheet
        visible={detail.open}
        transaction={detail.txn}
        onClose={() => setDetail({ open: false, txn: null })}
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
  const fg = active ? palette.info : palette.textPrimary;
  const bg = active ? 'rgba(0,122,255,0.12)' : palette.cardPill;
  return (
    <Pressable onPress={onPress} style={[styles.pill, { backgroundColor: bg }]}>
      <SymbolView name={icon} tintColor={palette.info} size={13} />
      <Text numberOfLines={1} style={{ color: fg, fontSize: 13, maxWidth: 140, fontWeight: active ? '500' : '400' }}>
        {label}
      </Text>
      <SymbolView name="chevron.down" tintColor={palette.textTertiary} size={9} />
    </Pressable>
  );
}

function ResetPill({ onPress }: { onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable onPress={onPress} hitSlop={6} style={styles.resetPill}>
      <Text style={{ color: palette.info, fontSize: 13, fontWeight: '500' }}>重置</Text>
    </Pressable>
  );
}

// ── 无结果占位 ────────────────────────────────────────────────────────────────
function NoResultEmpty({ filtersActive, onClearFilters }: { filtersActive: boolean; onClearFilters: () => void }) {
  const palette = usePalette();
  return (
    <View style={styles.center}>
      <Image
        source={require('@/assets/images/search/search-empty.png')}
        style={styles.emptyImage}
        resizeMode="contain"
        accessibilityLabel="无搜索结果"
      />
      <Text style={[styles.emptyTitle, { color: palette.textPrimary }]}>没有找到相关记录</Text>
      <Text style={[styles.emptySubtitle, { color: palette.textSecondary }]}>试试更换关键词或放宽筛选条件</Text>
      {filtersActive ? (
        <Pressable onPress={onClearFilters} hitSlop={10} style={{ marginTop: Space[4] }}>
          <Text style={{ color: palette.info, fontSize: 15 }}>清除筛选条件</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ── 搜索历史 + 默认引导空态 ─────────────────────────────────────────────────
function HistoryCloud({
  history,
  onPick,
}: {
  history: ReturnType<typeof useSearchHistory>;
  onPick: (kw: string) => void;
}) {
  const palette = usePalette();
  return (
    <View style={styles.historyContainer}>
      {history.items.length > 0 ? (
        <View style={[styles.historyCard, { backgroundColor: palette.card }]}>
          <View style={styles.historyHeader}>
            <View style={styles.historyTitleWrap}>
              <SymbolView name="clock" tintColor={palette.textSecondary} size={15} />
              <Text style={[styles.historyTitle, { color: palette.textPrimary }]}>最近搜索</Text>
            </View>
            <Pressable hitSlop={8} onPress={history.clear} accessibilityRole="button">
              <Text style={[styles.historyClear, { color: palette.info }]}>清空</Text>
            </Pressable>
          </View>
          <View style={styles.cloud}>
            {history.items.map((kw) => (
              <Pressable
                key={kw}
                style={[styles.historyTag, { backgroundColor: palette.cardPill }]}
                onPress={() => onPick(kw)}
                onLongPress={() => history.remove(kw)}
                accessibilityHint="长按可删除"
              >
                <Text style={[styles.historyTagText, { color: palette.textPrimary }]} numberOfLines={1}>
                  {kw}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.historyHint, { color: palette.textTertiary }]}>长按可删除</Text>
        </View>
      ) : null}

      <View style={styles.defaultEmpty}>
        <View style={[styles.defaultEmptyIconWrap, { backgroundColor: palette.cardPill }]}>
          <SymbolView name="magnifyingglass" tintColor={palette.textTertiary} size={44} />
        </View>
        <Text style={[styles.defaultEmptyText, { color: palette.textSecondary }]}>
          输入关键词或选择筛选条件，开始搜索
        </Text>
      </View>
    </View>
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
  setDatePreset: (k: DatePresetKey) => void;
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
  date: '日期',
  category: '分类',
  member: '成员',
  amount: '金额',
};

function formatSlashDate(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}/${m}/${day}`;
}

function matchesQuickRange(minYuan: string, maxYuan: string, range: (typeof AMOUNT_RANGES)[number]): boolean {
  return minYuan.trim() === range.min && maxYuan.trim() === range.max;
}

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
    setDatePreset,
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
    const onCustomFrom = (d: Date) => {
      setCustomFrom(d);
      setDatePreset('custom');
    };
    const onCustomTo = (d: Date) => {
      setCustomTo(d);
      setDatePreset('custom');
    };
    return (
      <View style={styles.sheetBody}>
        <View style={[styles.optionCard, { backgroundColor: palette.card }]}>
          {DATE_PRESET_OPTIONS.map((p, i) => (
            <OptionRow
              key={p.key}
              label={p.label}
              active={datePreset === p.key}
              onPress={() => onPickPreset(p.key)}
              showDivider={i < DATE_PRESET_OPTIONS.length - 1}
            />
          ))}
        </View>
        <View style={[styles.customDateCard, { backgroundColor: palette.card }]}>
          <Text style={[styles.customDateTitle, { color: palette.textPrimary }]}>自定义日期</Text>
          <View style={styles.customDateFields}>
            <DateFieldBox label="开始日期" date={customFrom} onChange={onCustomFrom} />
            <Text style={[styles.customDateDash, { color: palette.textTertiary }]}>—</Text>
            <DateFieldBox label="结束日期" date={customTo} onChange={onCustomTo} />
          </View>
        </View>
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
      <View style={styles.amountInputsRow}>
        <AmountField label="最低金额" value={amountMinYuan} onChange={setAmountMinYuan} />
        <AmountField label="最高金额" value={amountMaxYuan} onChange={setAmountMaxYuan} />
      </View>
      <Text style={[styles.quickRangeTitle, { color: palette.textPrimary }]}>快捷区间</Text>
      <View style={styles.quickRangeRow}>
        {AMOUNT_RANGES.map((range) => {
          const selected = matchesQuickRange(amountMinYuan, amountMaxYuan, range);
          return (
            <Pressable
              key={range.label}
              style={[
                styles.quickRangeChip,
                {
                  backgroundColor: selected ? 'rgba(0,122,255,0.12)' : palette.cardPill,
                },
              ]}
              onPress={() => {
                setAmountMinYuan(range.min);
                setAmountMaxYuan(range.max);
              }}
            >
              <Text
                style={{
                  color: selected ? palette.info : palette.textPrimary,
                  fontSize: 14,
                  fontWeight: selected ? '500' : '400',
                }}
              >
                {range.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.amountHint, { color: palette.textTertiary }]}>可单独填写最低或最高金额</Text>
      {amountError ? <Text style={[styles.errorText, { color: palette.danger }]}>最小金额不能大于最大金额</Text> : null}
    </View>
  );
}

function AmountField({ label, value, onChange }: { label: string; value: string; onChange: (s: string) => void }) {
  const palette = usePalette();
  return (
    <View style={[styles.amountFieldBox, { backgroundColor: palette.cardPill }]}>
      <Text style={[styles.amountFieldLabel, { color: palette.textTertiary }]}>{label}</Text>
      <View style={styles.amountFieldValueRow}>
        <Text style={[styles.amountFieldPrefix, { color: palette.textPrimary }]}>¥</Text>
        <TextInput
          style={[styles.amountFieldInput, { color: palette.textPrimary }]}
          value={value}
          onChangeText={onChange}
          placeholder="0"
          placeholderTextColor={palette.textTertiary}
          keyboardType="decimal-pad"
        />
      </View>
    </View>
  );
}

function DateFieldBox({ label, date, onChange }: { label: string; date: Date | null; onChange: (d: Date) => void }) {
  const palette = usePalette();
  return (
    <View style={[styles.dateFieldBox, { backgroundColor: palette.cardPill, borderColor: palette.separator }]}>
      <Text style={[styles.dateFieldLabel, { color: palette.textTertiary }]}>{label}</Text>
      <View style={styles.dateFieldValueRow}>
        <Text style={[styles.dateFieldValue, { color: palette.textPrimary }]}>
          {date ? formatSlashDate(date) : '选择日期'}
        </Text>
        <SymbolView name="calendar" tintColor={palette.textTertiary} size={15} />
      </View>
      <Host matchContents style={styles.datePickerOverlay}>
        <DatePicker
          selection={date ?? new Date()}
          displayedComponents={['date']}
          onDateChange={onChange}
          modifiers={[datePickerStyle('compact'), labelsHidden()]}
        />
      </Host>
    </View>
  );
}

function OptionRow({
  label,
  active,
  onPress,
  showDivider = false,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  showDivider?: boolean;
}) {
  const palette = usePalette();
  return (
    <>
      <Pressable style={styles.optionRow} onPress={onPress}>
        <Text style={{ color: active ? palette.info : palette.textPrimary, fontSize: 16 }}>{label}</Text>
        <View style={styles.flex} />
        {active ? <SymbolView name="checkmark" tintColor={palette.info} size={18} /> : null}
      </Pressable>
      {showDivider ? <View style={[styles.optionDivider, { backgroundColor: palette.separator }]} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[2],
    paddingHorizontal: Space[4],
    paddingTop: Space[2],
    paddingBottom: Space[2],
  },
  navIconButton: {
    width: 32,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[2],
    height: 40,
    borderRadius: Radius.md,
    paddingHorizontal: Space[3],
  },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 0 },
  cancelButton: {
    minWidth: 44,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space[1],
  },
  cancelText: { fontSize: 16 },
  pillScroller: { flexGrow: 0 },
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[2],
    paddingHorizontal: Space[4],
    paddingVertical: Space[2],
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[1],
    paddingHorizontal: Space[3],
    height: 34,
    borderRadius: Radius.full,
  },
  resetPill: {
    height: 34,
    justifyContent: 'center',
    paddingHorizontal: Space[2],
  },
  separator: { height: StyleSheet.hairlineWidth, marginTop: Space[1] },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space[3],
    paddingHorizontal: Space[6],
  },
  emptyImage: { width: 180, height: 180 },
  emptyTitle: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  emptySubtitle: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  historyContainer: { flex: 1, paddingHorizontal: Space[4], paddingTop: Space[3] },
  historyCard: {
    borderRadius: Radius.lg,
    paddingHorizontal: Space[4],
    paddingTop: Space[4],
    paddingBottom: Space[3],
  },
  historyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  historyTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: Space[2] },
  historyTitle: { fontSize: 15, fontWeight: '600' },
  historyClear: { fontSize: 14 },
  cloud: { flexDirection: 'row', flexWrap: 'wrap', gap: Space[2], marginTop: Space[3] },
  historyTag: { paddingHorizontal: Space[4], paddingVertical: Space[2], borderRadius: Radius.full, maxWidth: 200 },
  historyTagText: { fontSize: 14 },
  historyHint: { fontSize: 12, marginTop: Space[3] },
  defaultEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space[4],
    paddingBottom: Space[10],
  },
  defaultEmptyIconWrap: {
    width: 120,
    height: 120,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  defaultEmptyText: { fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: Space[6] },
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
  sheetBody: { gap: Space[3], paddingBottom: Space[2] },
  sheetScroll: { maxHeight: 360 },
  optionCard: { borderRadius: Radius.lg, overflow: 'hidden' },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Space[3],
    paddingHorizontal: Space[4],
    minHeight: 48,
  },
  optionDivider: { height: StyleSheet.hairlineWidth, marginLeft: Space[4] },
  customDateCard: { borderRadius: Radius.lg, padding: Space[4], gap: Space[3] },
  customDateTitle: { fontSize: 15, fontWeight: '600' },
  customDateFields: { flexDirection: 'row', alignItems: 'center', gap: Space[2] },
  customDateDash: { fontSize: 16, paddingHorizontal: Space[1] },
  dateFieldBox: {
    flex: 1,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Space[3],
    paddingVertical: Space[2],
    minHeight: 64,
    overflow: 'hidden',
  },
  dateFieldLabel: { fontSize: 12, marginBottom: Space[1] },
  dateFieldValueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dateFieldValue: { fontSize: 15, fontVariant: ['tabular-nums'] },
  datePickerOverlay: {
    position: 'absolute',
    right: Space[2],
    bottom: Space[1],
    opacity: 0.02,
    minWidth: 44,
    minHeight: 44,
  },
  amountSheet: { paddingVertical: Space[2], gap: Space[4] },
  amountInputsRow: { flexDirection: 'row', gap: Space[3] },
  amountFieldBox: {
    flex: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Space[3],
    paddingVertical: Space[3],
    gap: Space[1],
  },
  amountFieldLabel: { fontSize: 12 },
  amountFieldValueRow: { flexDirection: 'row', alignItems: 'baseline' },
  amountFieldPrefix: { fontSize: 18, fontWeight: '600', marginRight: Space[1] },
  amountFieldInput: { flex: 1, fontSize: 18, fontWeight: '600', paddingVertical: 0, fontVariant: ['tabular-nums'] },
  quickRangeTitle: { fontSize: 15, fontWeight: '600' },
  quickRangeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Space[2] },
  quickRangeChip: {
    paddingHorizontal: Space[4],
    paddingVertical: Space[2],
    borderRadius: Radius.full,
    minHeight: 36,
    justifyContent: 'center',
  },
  amountHint: { fontSize: 12 },
  errorText: { fontSize: 12, paddingTop: Space[1] },
});
