/**
 * 搜索（顶栏 🔍，MVP 基础版）：在当前家庭已加载的流水里按
 * 关键词（备注 / 分类 / 成员）+ 分类 + 成员 + 日期范围 过滤，结果按日分组展示。
 * 客户端过滤（流水已全量加载）；高级筛选 / 联想 / 跨家庭后置（DESIGN §16）。
 */
import { Host, ScrollView as UIScrollView, VStack } from '@expo/ui/swift-ui';
import { padding } from '@expo/ui/swift-ui/modifiers';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCategories, useFamilyMembers, useMyFamily, useMyProfile, useTransactions, type Transaction } from '@/api';
import { Radius, Space, useCategoryColors, usePalette } from '@/constants/design';
import { DayGroup, type RowData } from '@/features/home/components';
import { categoryColorKey, categorySymbol } from '@/lib/category-style';
import { currentPeriod, dayKey, humanDay, signForType } from '@/lib/format';

type DatePreset = 'all' | 'thisMonth' | 'lastMonth' | 'thisYear';
const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'all', label: '全部时间' },
  { key: 'thisMonth', label: '本月' },
  { key: 'lastMonth', label: '上月' },
  { key: 'thisYear', label: '今年' },
];

type Group = { key: string; label: string; totalCents: number; rows: RowData[] };

export function SearchSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
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

  const [keyword, setKeyword] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [recorderId, setRecorderId] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState<DatePreset>('all');

  const multiMember = (familyQ.data?.member_count ?? 1) > 1;

  const { groups, count } = useMemo(() => {
    const txns = txnsQ.data ?? [];
    const cats = catsQ.data ?? [];
    const members = membersQ.data ?? [];
    const catById = new Map(cats.map((c) => [c.id, c]));
    const nameById = new Map(members.map((m) => [m.id, m.nickname]));
    const myId = profileQ.data?.id;
    const kw = keyword.trim().toLowerCase();

    const now = new Date();
    const lastMonthPeriod = currentPeriod(new Date(now.getFullYear(), now.getMonth() - 1, 1));

    const inDateRange = (iso: string): boolean => {
      if (datePreset === 'all') return true;
      const d = new Date(iso);
      if (datePreset === 'thisMonth') return currentPeriod(d) === currentPeriod();
      if (datePreset === 'lastMonth') return currentPeriod(d) === lastMonthPeriod;
      return d.getFullYear() === now.getFullYear(); // thisYear
    };

    const matches = (t: Transaction): boolean => {
      if (categoryId && t.category_id !== categoryId) return false;
      if (recorderId && t.recorder_user_id !== recorderId) return false;
      if (!inDateRange(t.occurred_at)) return false;
      if (kw) {
        const cat = catById.get(t.category_id);
        const recName = t.recorder_user_id === myId ? '我' : (nameById.get(t.recorder_user_id) ?? '');
        const hay = `${t.note ?? ''} ${cat?.name ?? ''} ${recName}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    };

    const subtitle = (t: Transaction): string | null => {
      const who = t.recorder_user_id === myId ? '我' : (nameById.get(t.recorder_user_id) ?? '成员');
      if (multiMember) return t.note ? `${t.note} · ${who}` : who;
      return t.note ?? null;
    };

    const map = new Map<string, Group>();
    let n = 0;
    for (const t of txns) {
      if (!matches(t)) continue;
      n += 1;
      const cat = catById.get(t.category_id);
      const ttype = (t.type === 'income' ? 'income' : 'expense') as 'income' | 'expense';
      const key = dayKey(t.occurred_at);
      const group =
        map.get(key) ??
        (() => {
          const g: Group = { key, label: humanDay(t.occurred_at), totalCents: 0, rows: [] };
          map.set(key, g);
          return g;
        })();
      group.totalCents += ttype === 'income' ? t.amount : -t.amount;
      group.rows.push({
        id: t.id,
        title: cat?.name ?? '未分类',
        subtitle: subtitle(t),
        symbol: categorySymbol(cat?.icon ?? null, ttype),
        iconColor: catColors[categoryColorKey(cat?.name ?? '', ttype)],
        amountCents: t.amount,
        sign: signForType(ttype),
        amountColor: ttype === 'income' ? palette.income : palette.expense,
      });
    }
    return { groups: Array.from(map.values()), count: n };
  }, [
    txnsQ.data,
    catsQ.data,
    membersQ.data,
    profileQ.data,
    keyword,
    categoryId,
    recorderId,
    datePreset,
    multiMember,
    catColors,
    palette,
  ]);

  const categories = catsQ.data ?? [];
  const members = membersQ.data ?? [];
  const hasQuery = keyword.trim() !== '' || !!categoryId || !!recorderId || datePreset !== 'all';

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        {/* 顶栏：搜索框 + 取消 */}
        <View style={styles.topBar}>
          <View style={[styles.searchBox, { backgroundColor: palette.card }]}>
            <SymbolView name="magnifyingglass" tintColor={palette.textTertiary} size={17} />
            <TextInput
              style={[styles.searchInput, { color: palette.textPrimary }]}
              placeholder="搜流水（备注 / 分类 / 成员）"
              placeholderTextColor={palette.textTertiary}
              value={keyword}
              onChangeText={setKeyword}
              autoFocus
              autoCorrect={false}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
          </View>
          <Pressable hitSlop={8} onPress={onClose}>
            <Text style={[styles.cancel, { color: palette.info }]}>取消</Text>
          </Pressable>
        </View>

        {/* 过滤器：日期 / 分类 / 成员 */}
        <View style={styles.filters}>
          <FilterRow>
            {DATE_PRESETS.map((p) => (
              <Chip key={p.key} label={p.label} active={datePreset === p.key} onPress={() => setDatePreset(p.key)} />
            ))}
          </FilterRow>
          <FilterRow>
            <Chip label="全部分类" active={!categoryId} onPress={() => setCategoryId(null)} />
            {categories.map((c) => (
              <Chip
                key={c.id}
                label={c.name}
                active={categoryId === c.id}
                onPress={() => setCategoryId((v) => (v === c.id ? null : c.id))}
              />
            ))}
          </FilterRow>
          {multiMember ? (
            <FilterRow>
              <Chip label="全部成员" active={!recorderId} onPress={() => setRecorderId(null)} />
              {members.map((m) => (
                <Chip
                  key={m.id}
                  label={m.id === profileQ.data?.id ? '我' : m.nickname}
                  active={recorderId === m.id}
                  onPress={() => setRecorderId((v) => (v === m.id ? null : m.id))}
                />
              ))}
            </FilterRow>
          ) : null}
        </View>

        <Text style={[styles.count, { color: palette.textSecondary }]}>找到 {count} 笔</Text>

        {/* 结果 */}
        {groups.length === 0 ? (
          <View style={styles.center}>
            <SymbolView
              name={hasQuery ? 'magnifyingglass' : 'text.magnifyingglass'}
              tintColor={palette.textTertiary}
              size={44}
            />
            <Text style={{ color: palette.textSecondary }}>
              {hasQuery ? '没有匹配的流水' : '输入关键词或选择筛选条件'}
            </Text>
          </View>
        ) : (
          <Host style={styles.flex}>
            <UIScrollView>
              <VStack
                spacing={Space[5]}
                modifiers={[padding({ horizontal: Space[4], top: Space[2], bottom: Space[10] })]}
              >
                {groups.map((g) => (
                  <DayGroup key={g.key} label={g.label} totalCents={g.totalCents} rows={g.rows} />
                ))}
              </VStack>
            </UIScrollView>
          </Host>
        )}
      </SafeAreaView>
    </View>
  );
}

// ── 横向滚动过滤行 ────────────────────────────────────────────────────────────
function FilterRow({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.filterRow}
    >
      {children}
    </ScrollView>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable onPress={onPress} style={[styles.chip, { backgroundColor: active ? palette.accent : palette.card }]}>
      <Text style={{ color: active ? palette.onAccent : palette.textPrimary, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[3],
    paddingHorizontal: Space[4],
    paddingTop: Space[2],
    paddingBottom: Space[2],
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[2],
    height: 38,
    borderRadius: Radius.md,
    paddingHorizontal: Space[3],
  },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 0 },
  cancel: { fontSize: 16 },
  filters: { gap: Space[2], paddingBottom: Space[2] },
  filterRow: { gap: Space[2], paddingHorizontal: Space[4] },
  chip: { paddingHorizontal: Space[3], paddingVertical: Space[2], borderRadius: Radius.full },
  count: { fontSize: 13, paddingHorizontal: Space[4], paddingVertical: Space[2] },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space[3] },
});
