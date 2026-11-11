/**
 * 搜索（流程 14 / PRD §16）：独立路由页，按参考图实现。
 * 顶栏：返回 + 搜索框 + 筛选入口；统一面板内编辑筛选草稿。
 * 空态：最近搜索卡片 + 引导插图；无结果：search-empty.png 占位图。
 * 结果列表复用首页 DayGroup（点击查看详情、左滑编辑/删除）。
 */
import { Button, Host, List, Section, VStack, type ButtonProps } from '@expo/ui/swift-ui';
import {
  buttonStyle,
  controlSize,
  foregroundColor,
  frame,
  glassEffect,
  labelStyle,
  listRowBackground,
  listRowInsets,
  listRowSeparator,
  listSectionSpacing,
  listStyle,
} from '@expo/ui/swift-ui/modifiers';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Alert, Animated, Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import {
  fetchTransaction,
  useAllCategories,
  useCategoryLayout,
  useFamilyMembers,
  useMyFamily,
  useMyProfile,
  useSearchTransactions,
  useSoftDeleteTransaction,
  useTransaction,
  type Transaction,
} from '@/api';
import { toast } from '@/components/toast';
import { Radius, Space, useCategoryColors, usePalette } from '@/constants/design';
import { DayGroup, EndOfListHint, type AvatarInfo, type RowData } from '@/features/home/components';
import { TransactionDetailSheet } from '@/features/home/transaction-detail-sheet';
import { useAvatarFiles } from '@/features/home/use-avatar-files';
import { RecordSheet } from '@/features/record/record-sheet';
import { alertOk, categorySearchNames, displayCategoryName, t, useLocalePreference } from '@/i18n';
import { categoryColorKey, categorySymbol } from '@/lib/category-style';
import { buildCategoryHierarchy, matchingCategoryIds } from '@/lib/category-hierarchy';
import { clockTime, dayKey, humanDay, signForType } from '@/lib/format';
import { memberDisplayName } from '@/lib/member-name';
import { isNetworkAvailable } from '@/lib/query-network';
import {
  hasAnyQuery,
  resolveAmountRange,
  validateFilters,
  type DatePresetKey,
  type SearchFilters,
  type TxnType,
} from '@/lib/search';

import { ReportFilterSheet } from '@/features/report/filter-sheet';
import { AmountFilterCard, DateFilterCard, TypeFilterCard } from './filter-extra';
import { categoriesForType, isValidAmountInput } from './filter-logic';

import { getSearchPresentation, shouldLockFilterControls } from './search-presentation';
import { useSearchHistory } from './use-search-history';

type ResultGroup = { key: string; label: string; totalCents: number; rows: RowData[] };

/** 搜索结果区统一与 insetGrouped 卡片外沿对齐；需要手调时只改这里。 */
const SEARCH_LIST_HORIZONTAL_INSET = 16;
/** 搜索结果较首页更紧凑；需要手调单项内容留白时只改这里。 */
const SEARCH_RESULT_ROW_INSETS = { horizontal: Space[3], vertical: Space[2] };
/** 关键词停止输入后再检索，避免每个字符都触发全量筛选与列表更新。 */
const KEYWORD_SEARCH_DEBOUNCE_MS = 300;

export function SearchScreen({ onClose }: { onClose: () => void }) {
  return <SearchBody onClose={onClose} />;
}

function SearchBody({ onClose }: { onClose: () => void }) {
  const palette = usePalette();
  const { locale } = useLocalePreference();
  const catColors = useCategoryColors();

  const catsQ = useAllCategories();
  const layoutQ = useCategoryLayout();
  const hierarchy = useMemo(
    () => buildCategoryHierarchy(catsQ.data ?? [], layoutQ.data ?? []),
    [catsQ.data, layoutQ.data],
  );
  const membersQ = useFamilyMembers();
  const familyQ = useMyFamily();
  const profileQ = useMyProfile();

  const history = useSearchHistory();

  const [keyword, setKeyword] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [types, setTypes] = useState<Set<TxnType>>(new Set());
  const [categoryIds, setCategoryIds] = useState<Set<string>>(new Set());
  const [recorderIds, setRecorderIds] = useState<Set<string>>(new Set());
  const [datePreset, setDatePreset] = useState<DatePresetKey>('all');
  const [customFrom, setCustomFrom] = useState<Date | null>(null);
  const [customTo, setCustomTo] = useState<Date | null>(null);
  const [amountMinYuan, setAmountMinYuan] = useState('');
  const [amountMaxYuan, setAmountMaxYuan] = useState('');

  const [draft, setDraft] = useState<SearchFilters | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sliderActive, setSliderActive] = useState(false);
  const [typeNotice, setTypeNotice] = useState(false);
  const [previewDraft, setPreviewDraft] = useState<SearchFilters | null>(null);
  useEffect(() => {
    if (!draft) return;
    const timer = setTimeout(() => setPreviewDraft(draft), 350);
    return () => clearTimeout(timer);
  }, [draft]);
  const [filterInteractionId, setFilterInteractionId] = useState(0);
  // 点击结果行 → 详情；左滑 → 编辑 / 删除，与首页列表一致。
  const [detail, setDetail] = useState<{ open: boolean; txn: Transaction | null }>({ open: false, txn: null });
  const [editing, setEditing] = useState<Transaction | null>(null);
  const softDeleteM = useSoftDeleteTransaction();
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null);
  const selectedTransactionQ = useTransaction(selectedTransactionId);

  useEffect(() => {
    const timeout = setTimeout(() => setSearchKeyword(keyword), KEYWORD_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [keyword]);

  const myId = profileQ.data?.id;
  const avatarFiles = useAvatarFiles(membersQ.data ?? []);

  const filters = useMemo<SearchFilters>(
    () => ({
      keyword: searchKeyword,
      types,
      categoryIds,
      recorderIds,
      datePreset,
      customFrom,
      customTo,
      amountMinYuan,
      amountMaxYuan,
    }),
    [searchKeyword, types, categoryIds, recorderIds, datePreset, customFrom, customTo, amountMinYuan, amountMaxYuan],
  );

  // 先提交筛选控件的即时状态；结果检索、分组与列表渲染则在可中断的低优先级更新中完成。
  const deferredFilters = useDeferredValue(filters);
  const deferredFilterInteractionId = useDeferredValue(filterInteractionId);
  const isSearching = deferredFilters !== filters;
  const filterControlsLocked = shouldLockFilterControls(filterInteractionId, deferredFilterInteractionId);
  const errors = validateFilters(filters);
  const valid = !errors.amount && !errors.date;
  const hasCurrentQuery = hasAnyQuery(filters);
  const categoryNameById = useMemo(() => {
    void locale;
    return new Map(
      (catsQ.data ?? []).map((category) => [category.id, displayCategoryName(category.name, category.is_system)]),
    );
  }, [catsQ.data, locale]);
  const presentation = getSearchPresentation({
    isValid: valid,
    hasCurrentQuery,
    isSearching,
  });

  const buildSearchInput = useCallback(
    (value: SearchFilters | null) => {
      void locale;
      if (!value || !catsQ.data || !layoutQ.data || !hasAnyQuery(value)) return null;
      const validation = validateFilters(value);
      if (
        validation.amount ||
        validation.date ||
        !isValidAmountInput(value.amountMinYuan) ||
        !isValidAmountInput(value.amountMaxYuan)
      )
        return null;
      const keywordLower = value.keyword.trim().toLowerCase();
      const keywordCategoryIds = matchingCategoryIds(
        keywordLower,
        hierarchy,
        (category) => categorySearchNames(category.name, category.is_system),
        t('category.unspecified'),
      );
      const keywordRecorderIds = keywordLower
        ? (membersQ.data ?? [])
            .filter(
              (member) =>
                member.nickname.toLowerCase().includes(keywordLower) ||
                memberDisplayName(member.nickname, member.departed).toLowerCase().includes(keywordLower) ||
                (member.id === myId && t('common.me').toLowerCase().includes(keywordLower)),
            )
            .map((member) => member.id)
        : [];
      const { minCents, maxCents } = resolveAmountRange(value);
      const dateText = (date: Date | null) =>
        date
          ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
          : null;
      return {
        keyword: value.keyword,
        keywordCategoryIds,
        keywordRecorderIds,
        types: [...value.types],
        categoryIds: [...value.categoryIds],
        recorderIds: [...value.recorderIds],
        datePreset: value.datePreset,
        customFrom: dateText(value.customFrom),
        customTo: dateText(value.customTo),
        amountMin: minCents,
        amountMax: maxCents,
      };
    },
    [catsQ.data, layoutQ.data, membersQ.data, myId, locale, hierarchy],
  );
  const searchInput = useMemo(() => buildSearchInput(deferredFilters), [buildSearchInput, deferredFilters]);
  const previewInput = useMemo(() => buildSearchInput(previewDraft), [buildSearchInput, previewDraft]);
  const previewQ = useSearchTransactions(filterOpen && !sliderActive && draft === previewDraft ? previewInput : null);
  const searchQ = useSearchTransactions(searchInput);

  const { groups } = useMemo(() => {
    const cats = catsQ.data ?? [];
    const members = membersQ.data ?? [];
    const catById = new Map(cats.map((c) => [c.id, c]));
    const memberById = new Map(members.map((m) => [m.id, m]));
    const myNick = profileQ.data?.nickname;
    const memberFallback = t('common.member');
    const uncategorized = t('common.uncategorized');

    const rows = searchQ.data?.pages.flatMap((page) => page.rows) ?? [];

    const avatarOf = (userId: string): AvatarInfo => {
      const nick = (userId === myId ? myNick : memberById.get(userId)?.nickname) ?? memberFallback;
      return { uri: avatarFiles.get(userId) ?? null, nickname: nick };
    };

    const map = new Map<string, ResultGroup>();
    for (const txn of rows) {
      const cat = catById.get(txn.categoryId);
      const layout = hierarchy.layoutById.get(txn.categoryId);
      const isGroupWithChildren =
        !!layout?.is_group && (hierarchy.childrenByParent.get(txn.categoryId)?.length ?? 0) > 0;
      const parent = layout?.parent_category_id
        ? catById.get(layout.parent_category_id)
        : isGroupWithChildren
          ? cat
          : null;
      const ttype = txn.type;
      const isSavings = txn.source !== 'normal';
      // 储蓄类在备注行单独标注，金额不并入合计口径（已在 lib/search.ts 处理）。
      const note = isSavings
        ? txn.note
          ? t('record.savingsNote', { note: txn.note })
          : t('record.savings')
        : txn.note;
      const editedByOther = !!txn.lastEditorUserId && txn.lastEditorUserId !== txn.recorderUserId;

      const key = dayKey(txn.occurredAt);
      const group =
        map.get(key) ??
        (() => {
          const g: ResultGroup = { key, label: humanDay(txn.occurredAt), totalCents: 0, rows: [] };
          map.set(key, g);
          return g;
        })();
      group.totalCents += ttype === 'income' ? txn.amount : -txn.amount;
      group.rows.push({
        id: txn.id,
        title: isGroupWithChildren
          ? t('category.unspecified')
          : (categoryNameById.get(txn.categoryId) ?? uncategorized),
        categoryParent: parent ? displayCategoryName(parent.name, parent.is_system) : undefined,
        note,
        symbol: categorySymbol(cat?.icon ?? null, ttype),
        iconColor: catColors[categoryColorKey(cat?.name ?? '', ttype, cat?.color_key)],
        amountCents: txn.amount,
        sign: signForType(ttype),
        amountColor: ttype === 'income' ? palette.income : palette.expense,
        timeLabel: clockTime(editedByOther ? txn.updatedAt : txn.occurredAt),
        recorder: avatarOf(txn.recorderUserId),
        editor: editedByOther ? avatarOf(txn.lastEditorUserId as string) : null,
      });
    }
    return { groups: Array.from(map.values()) };
  }, [
    searchQ.data,
    catsQ.data,
    membersQ.data,
    profileQ.data,
    myId,
    avatarFiles,
    catColors,
    palette,
    categoryNameById,
    hierarchy,
  ]);

  const categories = catsQ.data ?? [];
  const members = membersQ.data ?? [];
  const runFilterChange = useCallback(
    (change: () => void) => {
      if (filterControlsLocked) return;
      setFilterInteractionId((id) => id + 1);
      change();
    },
    [filterControlsLocked],
  );

  const applyDraft = (value: SearchFilters) => {
    setTypes(value.types);
    setCategoryIds(value.categoryIds);
    setRecorderIds(value.recorderIds);
    setDatePreset(value.datePreset);
    setCustomFrom(value.customFrom);
    setCustomTo(value.customTo);
    setAmountMinYuan(value.amountMinYuan);
    setAmountMaxYuan(value.amountMaxYuan);
    setSearchKeyword(value.keyword);
    setFilterOpen(false);
  };
  const changeType = (type: TxnType | null) => {
    if (!draft) return;
    const ids = categoriesForType(draft.categoryIds, type, hierarchy);
    setTypeNotice(ids.size !== draft.categoryIds.size);
    setDraft({ ...draft, types: type ? new Set([type]) : new Set(), categoryIds: ids });
  };

  const onRowPress = useCallback((id: string) => {
    setSelectedTransactionId(id);
    setDetail({ open: true, txn: null });
  }, []);

  const openEdit = useCallback(async (id: string) => {
    const txn = await fetchTransaction(id);
    if (!txn) return toast.error(t('home.missingTxn'));
    if (txn.source !== 'normal') {
      toast.info(t('home.savingsManageHint'));
      return;
    }
    setEditing(txn);
  }, []);

  const confirmDelete = useCallback(
    (id: string) => {
      const txn = searchQ.data?.pages.flatMap((page) => page.rows).find((row) => row.id === id);
      if (txn?.source !== 'normal') {
        toast.info(t('home.savingsManageHint'));
        return;
      }
      Alert.alert(t('home.deleteTxnTitle'), t('home.deleteTxnBody'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () =>
            softDeleteM.mutate(id, {
              onError: (e) => Alert.alert(t('home.deleteFailed'), (e as Error).message, alertOk()),
            }),
        },
      ]);
    },
    [softDeleteM, searchQ.data],
  );

  const amountSet = amountMinYuan.trim() !== '' || amountMaxYuan.trim() !== '';
  const filtersActive =
    types.size > 0 || categoryIds.size > 0 || recorderIds.size > 0 || datePreset !== 'all' || amountSet;

  const clearFilters = () => {
    runFilterChange(() => {
      setTypes(new Set());
      setCategoryIds(new Set());
      setRecorderIds(new Set());
      setDatePreset('all');
      setCustomFrom(null);
      setCustomTo(null);
      setAmountMinYuan('');
      setAmountMaxYuan('');
    });
  };

  const submitKeyword = () => {
    setSearchKeyword(keyword);
    history.push(keyword);
  };

  const clearKeyword = () => {
    setKeyword('');
    setSearchKeyword('');
  };

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        {/* 顶栏：原生玻璃返回键 + 玻璃搜索框。 */}
        <View style={styles.topBar}>
          <SearchBackButton onPress={onClose} />
          <SearchInput keyword={keyword} onChangeKeyword={setKeyword} onSubmit={submitKeyword} onClear={clearKeyword} />
          <SearchFilterButton
            active={filtersActive}
            onPress={() => {
              Keyboard.dismiss();
              setSliderActive(false);
              setSearchKeyword(keyword);
              setTypeNotice(false);
              setDraft({ ...filters, keyword });
              setFilterOpen(true);
            }}
          />
        </View>

        {/* 主体：搜索历史 / 校验提示 / 结果 / 空结果 */}
        {presentation === 'invalid' ? (
          <InvalidFiltersEmptyState />
        ) : presentation === 'history' ? (
          <HistoryCloud history={history} onPick={setKeyword} />
        ) : presentation === 'skeleton' ||
          searchQ.isLoading ||
          catsQ.isLoading ||
          layoutQ.isLoading ||
          (isNetworkAvailable() &&
            !familyQ.isError &&
            !profileQ.isError &&
            (!catsQ.data || !layoutQ.data || !searchQ.data) &&
            [catsQ, layoutQ, searchQ].some((query) => query.fetchStatus === 'paused')) ? (
          <SearchResultsSkeleton />
        ) : (!catsQ.data && (catsQ.isError || catsQ.fetchStatus === 'paused' || familyQ.isError)) ||
          (!layoutQ.data && (layoutQ.isError || layoutQ.fetchStatus === 'paused' || familyQ.isError)) ||
          (!searchQ.data && (searchQ.isError || searchQ.fetchStatus === 'paused' || familyQ.isError)) ? (
          <View style={styles.center}>
            <Text style={{ color: palette.textSecondary }}>
              {t(isNetworkAvailable() ? 'common.loadFailed' : 'common.noCachedData')}
            </Text>
            <Pressable
              onPress={() => {
                void familyQ.refetch();
                void profileQ.refetch();
                void catsQ.refetch();
                void layoutQ.refetch();
                void searchQ.refetch();
              }}
            >
              <Text style={{ color: palette.accent }}>{t('common.retry')}</Text>
            </Pressable>
          </View>
        ) : groups.length === 0 ? (
          <NoResultEmpty filtersActive={filtersActive} onClearFilters={clearFilters} />
        ) : (
          <SearchResults
            groups={groups}
            palette={palette}
            onRowPress={onRowPress}
            onEdit={openEdit}
            onDelete={confirmDelete}
            hasNextPage={searchQ.hasNextPage}
            isFetchingNextPage={searchQ.isFetchingNextPage}
            onLoadMore={() => searchQ.fetchNextPage()}
          />
        )}
      </SafeAreaView>

      {draft && (
        <ReportFilterSheet
          visible={filterOpen}
          filters={{ memberIds: [...draft.recorderIds], categoryIds: [...draft.categoryIds] }}
          members={members.map((member) => ({
            id: member.id,
            nickname: member.nickname,
            accessibilityLabel: memberDisplayName(member.nickname, member.departed),
            avatarUrl: member.avatar_url,
          }))}
          categories={categories}
          hierarchy={hierarchy}
          pending={null}
          error={false}
          onChange={(value) =>
            setDraft({ ...draft, recorderIds: new Set(value.memberIds), categoryIds: new Set(value.categoryIds) })
          }
          onClose={() => setFilterOpen(false)}
          onSubmit={(action) => {
            if (action === 'confirm') applyDraft(draft);
            else {
              setTypeNotice(false);
              setDraft({
                ...draft,
                types: new Set(),
                categoryIds: new Set(),
                recorderIds: new Set(),
                datePreset: 'all',
                customFrom: null,
                customTo: null,
                amountMinYuan: '',
                amountMaxYuan: '',
              });
            }
          }}
          search={{
            before: (
              <>
                <TypeFilterCard filters={draft} onType={changeType} />
                {typeNotice && (
                  <Text accessibilityRole="alert" style={{ color: palette.textSecondary }}>
                    {t('search.categoriesCleared')}
                  </Text>
                )}
              </>
            ),
            after: (
              <>
                <DateFilterCard filters={draft} onChange={setDraft} />
                <AmountFilterCard
                  filters={draft}
                  familyId={familyQ.data?.id}
                  onChange={setDraft}
                  onSlidingChange={setSliderActive}
                />
                {(previewQ.isError || (hasAnyQuery(draft) && previewQ.fetchStatus === 'paused')) && (
                  <Text accessibilityRole="alert" style={{ color: palette.textSecondary }}>
                    {t('search.previewFailed')}
                  </Text>
                )}
              </>
            ),
            showExpense: !draft.types.size || draft.types.has('expense'),
            showIncome: !draft.types.size || draft.types.has('income'),
            invalid:
              sliderActive ||
              validateFilters(draft).amount ||
              validateFilters(draft).date ||
              !isValidAmountInput(draft.amountMinYuan) ||
              !isValidAmountInput(draft.amountMaxYuan),
            loading:
              !sliderActive &&
              hasAnyQuery(draft) &&
              !validateFilters(draft).amount &&
              !validateFilters(draft).date &&
              isValidAmountInput(draft.amountMinYuan) &&
              isValidAmountInput(draft.amountMaxYuan) &&
              (draft !== previewDraft || (!!previewInput && previewQ.isFetching)),
            confirmLabel:
              !sliderActive &&
              draft === previewDraft &&
              previewInput &&
              previewQ.data &&
              !previewQ.isError &&
              previewQ.fetchStatus !== 'paused'
                ? t('search.showResultCount', { count: previewQ.data.pages[0].count })
                : t('search.showResults'),
          }}
        />
      )}

      <TransactionDetailSheet
        visible={detail.open}
        transaction={selectedTransactionQ.data ?? detail.txn}
        onClose={() => {
          setDetail({ open: false, txn: null });
          setSelectedTransactionId(null);
        }}
      />

      {/* 编辑 / 删除（流程 10）；保存后 RQ 失效 → 结果自动重算 */}
      <RecordSheet
        visible={!!editing}
        editing={editing}
        familyId={editing?.family_id ?? ''}
        recorderId={myId ?? ''}
        onClose={() => setEditing(null)}
      />
    </View>
  );
}

const SearchResults = memo(function SearchResults({
  groups,
  palette,
  onRowPress,
  onEdit,
  onDelete,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: {
  groups: ResultGroup[];
  palette: ReturnType<typeof usePalette>;
  onRowPress: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}) {
  return (
    <Host style={styles.flex}>
      <List modifiers={[listStyle('insetGrouped'), listSectionSpacing(Space[3])]}>
        {groups.map((g) => (
          <DayGroup
            key={g.key}
            label={g.label}
            totalCents={g.totalCents}
            rows={g.rows}
            onRowPress={onRowPress}
            onEdit={onEdit}
            onDelete={onDelete}
            headerHorizontalInset={SEARCH_LIST_HORIZONTAL_INSET}
            rowInsets={SEARCH_RESULT_ROW_INSETS}
          />
        ))}
        <Section modifiers={[listRowBackground(palette.base), listRowSeparator('hidden')]}>
          <VStack
            modifiers={[listRowInsets({ top: Space[2], bottom: Space[6], leading: Space[4], trailing: Space[4] })]}
          >
            {hasNextPage ? (
              <Button
                label={isFetchingNextPage ? t('common.loading') : t('common.loadMore')}
                onPress={isFetchingNextPage ? undefined : onLoadMore}
              />
            ) : (
              <EndOfListHint />
            )}
          </VStack>
        </Section>
      </List>
    </Host>
  );
});

function SearchResultsSkeleton() {
  const palette = usePalette();
  const [opacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [opacity]);

  return (
    <Animated.View style={[styles.flex, { opacity }]}>
      <View style={styles.resultsSkeleton} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {[0, 1, 2].map((group) => (
          <View key={group} style={styles.skeletonGroup}>
            <View style={[styles.skeletonDate, { backgroundColor: palette.cardPill }]} />
            <View style={[styles.skeletonCard, { backgroundColor: palette.card }]}>
              {[0, 1, 2].map((row) => (
                <View key={row} style={styles.skeletonRow}>
                  <View style={[styles.skeletonIcon, { backgroundColor: palette.cardPill }]} />
                  <View style={styles.skeletonTextStack}>
                    <View style={[styles.skeletonTitle, { backgroundColor: palette.cardPill }]} />
                    <View style={[styles.skeletonSubtitle, { backgroundColor: palette.cardPill }]} />
                  </View>
                  <View style={[styles.skeletonAmount, { backgroundColor: palette.cardPill }]} />
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>
    </Animated.View>
  );
}

function InvalidFiltersEmptyState() {
  const palette = usePalette();
  useLocalePreference();
  return (
    <View style={styles.center}>
      <SymbolView name="exclamationmark.circle" tintColor={palette.textTertiary} size={44} />
      <Text style={{ color: palette.textSecondary }}>{t('search.invalidFilters')}</Text>
    </View>
  );
}

function supportsLiquidGlass() {
  return Platform.OS === 'ios' && isGlassEffectAPIAvailable();
}

/** iOS 26+ 用原生 SwiftUI 圆形玻璃按钮；其他平台保留可感知的普通返回键。 */
function SearchBackButton({ onPress }: { onPress: () => void }) {
  const palette = usePalette();
  useLocalePreference();
  if (supportsLiquidGlass()) {
    return (
      <Host matchContents>
        <Button
          label={t('common.back')}
          systemImage={'chevron.left' as ButtonProps['systemImage']}
          onPress={onPress}
          modifiers={[
            labelStyle('iconOnly'),
            controlSize('large'),
            frame({ width: 40, height: 40 }),
            buttonStyle('plain'),
            foregroundColor(palette.textPrimary),
            glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'circle' }),
          ]}
        />
      </Host>
    );
  }

  return (
    <Pressable
      style={styles.navIconButton}
      hitSlop={10}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('common.back')}
    >
      <SymbolView name="chevron.left" tintColor={palette.textPrimary} size={21} />
    </Pressable>
  );
}

/**
 * 输入层继续使用 RN TextInput：与既有 React 状态、清除按钮和搜索提交直接绑定；
 * iOS 26+ 仅由原生 GlassView 承担容器材质，低版本回退为主题卡片底。
 */
function SearchInput({
  keyword,
  onChangeKeyword,
  onSubmit,
  onClear,
}: {
  keyword: string;
  onChangeKeyword: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
}) {
  const palette = usePalette();
  useLocalePreference();
  const content = (
    <>
      <SymbolView name="magnifyingglass" tintColor={palette.textTertiary} size={17} />
      <TextInput
        style={[styles.searchInput, { color: palette.textPrimary }]}
        placeholder={t('search.placeholder')}
        placeholderTextColor={palette.textTertiary}
        value={keyword}
        onChangeText={onChangeKeyword}
        onSubmitEditing={onSubmit}
        autoFocus
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="never"
      />
      {keyword.trim() ? (
        <Pressable
          hitSlop={8}
          onPress={onClear}
          accessibilityRole="button"
          accessibilityLabel={t('search.clearKeyword')}
        >
          <SymbolView name="xmark.circle.fill" tintColor={palette.textTertiary} size={17} />
        </Pressable>
      ) : null}
    </>
  );

  if (supportsLiquidGlass()) {
    return (
      <GlassView style={styles.searchBox} glassEffectStyle="regular" isInteractive colorScheme="auto">
        {content}
      </GlassView>
    );
  }

  return <View style={[styles.searchBox, { backgroundColor: palette.card }]}>{content}</View>;
}

function SearchFilterButton({ active, onPress }: { active: boolean; onPress: () => void }) {
  const palette = usePalette();
  return (
    <View>
      {Platform.OS === 'ios' ? (
        <Host matchContents>
          <Button
            label={t('search.filters')}
            systemImage="line.3.horizontal.decrease.circle"
            onPress={onPress}
            modifiers={[
              labelStyle('iconOnly'),
              controlSize('large'),
              frame({ width: 40, height: 40 }),
              buttonStyle('plain'),
              foregroundColor(palette.textPrimary),
              ...(supportsLiquidGlass()
                ? [glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'circle' })]
                : []),
            ]}
          />
        </Host>
      ) : (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={t('search.filters')}
          style={styles.navIconButton}
        >
          <SymbolView name="line.3.horizontal.decrease.circle" tintColor={palette.textPrimary} size={21} />
        </Pressable>
      )}
      {active && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            right: 1,
            top: 1,
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: palette.accent,
          }}
        />
      )}
    </View>
  );
}

// ── 无结果占位 ────────────────────────────────────────────────────────────────
function NoResultEmpty({ filtersActive, onClearFilters }: { filtersActive: boolean; onClearFilters: () => void }) {
  const palette = usePalette();
  useLocalePreference();
  return (
    <View style={styles.center}>
      <SearchEmptyIllustration />
      <Text style={[styles.emptyTitle, { color: palette.textPrimary }]}>{t('search.noResultsTitle')}</Text>
      <Text style={[styles.emptySubtitle, { color: palette.textSecondary }]}>{t('search.noResultsSub')}</Text>
      {filtersActive ? (
        <Pressable onPress={onClearFilters} hitSlop={10} style={{ marginTop: Space[4] }}>
          <Text style={{ color: palette.accent, fontSize: 15 }}>{t('search.clearFilters')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * 不使用带白色底图的 PNG：由主题色实时绘制，深浅模式都能自然融入页面背景。
 * 若需手调图形尺寸，调整 `styles.emptyIllustration` 的 width / height 即可。
 */
function SearchEmptyIllustration() {
  const palette = usePalette();
  useLocalePreference();
  return (
    <Svg
      width={150}
      height={150}
      viewBox="0 0 150 150"
      style={styles.emptyIllustration}
      accessibilityLabel={t('search.empty')}
    >
      <Path
        d="M36 39C48 23 75 20 91 34C106 48 121 48 125 68C130 91 111 110 92 116C71 123 56 113 39 104C19 93 17 57 36 39Z"
        fill={palette.cardPill}
      />
      <Circle cx={70} cy={70} r={30} fill="none" stroke={palette.textSecondary} strokeWidth={7} />
      <Line x1={92} y1={92} x2={112} y2={112} stroke={palette.textSecondary} strokeWidth={8} strokeLinecap="round" />
      <Path
        d="M23 76h13M28 70h7M28 82h7M116 78h11M119 72h6M119 84h6"
        stroke={palette.textTertiary}
        strokeWidth={3}
        strokeLinecap="round"
      />
      <Path d="M23 42l2.5 5L31 49.5L25.5 52L23 57L20.5 52L15 49.5L20.5 47L23 42Z" fill={palette.textTertiary} />
      <Path d="M116 28l2 4L122 34L118 36L116 40L114 36L110 34L114 32L116 28Z" fill={palette.textTertiary} />
      <Circle cx={121} cy={59} r={3} fill={palette.textTertiary} />
      <Circle cx={112} cy={90} r={6} fill="none" stroke={palette.textTertiary} strokeWidth={2} />
    </Svg>
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
  useLocalePreference();
  return (
    <View style={styles.historyContainer}>
      {history.items.length > 0 ? (
        <View style={[styles.historyCard, { backgroundColor: palette.card }]}>
          <View style={styles.historyHeader}>
            <View style={styles.historyTitleWrap}>
              <SymbolView name="clock" tintColor={palette.textSecondary} size={15} />
              <Text style={[styles.historyTitle, { color: palette.textPrimary }]}>{t('search.recent')}</Text>
              <Text style={[styles.historyHintInline, { color: palette.textTertiary }]}>
                {t('search.longPressDelete')}
              </Text>
            </View>
            <Pressable hitSlop={8} onPress={history.clear} accessibilityRole="button">
              <Text style={[styles.historyClear, { color: palette.accent }]}>{t('common.clear')}</Text>
            </Pressable>
          </View>
          <View style={styles.cloud}>
            {history.items.map((kw) => (
              <Pressable
                key={kw}
                style={[styles.historyTag, { backgroundColor: palette.cardPill }]}
                onPress={() => onPick(kw)}
                onLongPress={() => history.remove(kw)}
                accessibilityHint={t('search.longPressHint')}
              >
                <Text style={[styles.historyTagText, { color: palette.textPrimary }]} numberOfLines={1}>
                  {kw}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.defaultEmpty}>
        <View style={[styles.defaultEmptyIconWrap, { backgroundColor: palette.cardPill }]}>
          <SymbolView name="magnifyingglass" tintColor={palette.textTertiary} size={44} />
        </View>
        <Text style={[styles.defaultEmptyText, { color: palette.textSecondary }]}>{t('search.startHint')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    // 为 Liquid Glass 返回按钮的按压扩张态预留空间，避免遮住搜索框左沿。
    gap: Space[4],
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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space[3],
    paddingHorizontal: Space[6],
  },
  emptyIllustration: { marginBottom: Space[1] },
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
  historyHintInline: { fontSize: 11 },
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
  resultsSkeleton: { flex: 1, paddingHorizontal: Space[4], paddingTop: Space[4], gap: Space[4] },
  skeletonGroup: { gap: Space[2] },
  skeletonDate: { width: 72, height: 14, borderRadius: Radius.sm },
  skeletonCard: { borderRadius: Radius.lg, overflow: 'hidden' },
  skeletonRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[3],
    padding: Space[3],
  },
  skeletonIcon: { width: 34, height: 34, borderRadius: Radius.full },
  skeletonTextStack: { flex: 1, gap: Space[2] },
  skeletonTitle: { width: '48%', height: 14, borderRadius: Radius.sm },
  skeletonSubtitle: { width: '30%', height: 11, borderRadius: Radius.sm },
  skeletonAmount: { width: 52, height: 14, borderRadius: Radius.sm },
});
