/**
 * 首页（Tab 1）：本月概览卡 + 月度总结条 + 按日分组流水列表。
 * 内容主体用 @expo/ui/swift-ui 原生渲染；外层脚手架（标题栏 / FAB / 状态页）用 RN。
 */
import { Host, List, Section, Spacer, VStack } from '@expo/ui/swift-ui';
import {
  frame,
  listRowBackground,
  listRowInsets,
  listRowSeparator,
  listSectionSpacing,
  listStyle,
} from '@expo/ui/swift-ui/modifiers';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Link, useRouter, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  DEFAULT_ACCOUNTING_PREFS,
  useAccountingPrefs,
  useBudget,
  useCategories,
  useCreateFamily,
  useFamilyMembers,
  useMyFamily,
  useMyProfile,
  useSaveAccountingPrefs,
  useSoftDeleteTransaction,
  useTransactions,
  type Transaction,
} from '@/api';
import { ThemedText } from '@/components/themed-text';
import { Toast } from '@/components/toast';
import { avatarTintFor, Radius, Space, useAvatarTints, useCategoryColors, usePalette } from '@/constants/design';
import { BudgetSheet } from '@/features/budget/budget-sheet';
import {
  DayGroup,
  EndOfListHint,
  InsightBanner,
  PulseCard,
  type AvatarInfo,
  type RowData,
} from '@/features/home/components';
import { HomeSkeleton } from '@/features/home/home-skeleton';
import { TransactionDetailSheet } from '@/features/home/transaction-detail-sheet';
import { useAvatarFiles } from '@/features/home/use-avatar-files';
import { FirstRecordCelebration } from '@/features/record/first-record-celebration';
import { RecordSheet } from '@/features/record/record-sheet';
import { HeaderSearchButton } from '@/features/search/search-provider';
import { useManualCollapsibleHeader } from '@/features/shared/use-collapsible-header';
import { useSession } from '@/lib/auth';
import { daysToMonthEnd, expenseUsedInPeriod } from '@/lib/budget';
import { categoryColorKey, categorySymbol } from '@/lib/category-style';
import { clockTime, currentPeriod, dayKey, greetingForHour, humanDay, previousPeriod, signForType } from '@/lib/format';

type Group = { key: string; label: string; totalCents: number; rows: RowData[] };

/** 月末「家里一起记下了 N 笔」提示条的关闭记忆（存被关闭的周期 YYYY-MM，本月内不再出现）。 */
const COUNT_BANNER_DISMISSED_KEY = 'home.countBannerDismissedPeriod';
/** 月初「上月总结来啦」提示条的关闭记忆（存上月周期 YYYY-MM，本周期不再出现）。 */
const LAST_MONTH_REMINDER_DISMISSED_KEY = 'home.lastMonthReminderDismissedPeriod';

export default function HomeScreen() {
  const palette = usePalette();
  const catColors = useCategoryColors();
  const avatarTints = useAvatarTints();
  const insets = useSafeAreaInsets();
  const { scrollGeometry, headerHeight, headerStyle, onHeaderLayout } = useManualCollapsibleHeader(
    insets.top + 84,
    insets.top,
  );

  const { session } = useSession();
  const profileQ = useMyProfile();
  const familyQ = useMyFamily();
  const membersQ = useFamilyMembers();
  const categoriesQ = useCategories();
  const transactionsQ = useTransactions();
  const budgetQ = useBudget(currentPeriod());
  const createFamilyM = useCreateFamily();

  // 记账设置偏好（accounting_preferences，个人级）：金额隐私 + 首页月度总结横幅开关等。
  const accountingPrefs = useAccountingPrefs().data ?? DEFAULT_ACCOUNTING_PREFS;
  const saveAccountingPrefs = useSaveAccountingPrefs();

  // 本月脉搏卡数据（流程 8）：预算总额 + 已用（排除储蓄类）+ 是否户主。
  const budget = budgetQ.data?.budget ?? null;
  const hasBudget = !!budget && budget.total_amount > 0;
  const usedTotal = useMemo(
    () => expenseUsedInPeriod(transactionsQ.data ?? [], currentPeriod()).total,
    [transactionsQ.data],
  );
  const isOwner = familyQ.data?.owner_user_id === profileQ.data?.id;

  // 月初「上月总结来啦」轻提醒（前 7 天，且上月有记账）。
  const prevPeriodStr = previousPeriod(currentPeriod());
  const prevMonthHasData = useMemo(
    () => (transactionsQ.data ?? []).some((t) => currentPeriod(new Date(t.occurred_at)) === prevPeriodStr),
    [transactionsQ.data, prevPeriodStr],
  );
  const [lastMonthReminderDismissed, setLastMonthReminderDismissed] = useState(false);
  // 月度总结横幅入口可在「记账设置」关闭（show_monthly_summary_entry，默认开）。
  const showLastMonthReminder =
    accountingPrefs.show_monthly_summary_entry &&
    new Date().getDate() <= 7 &&
    prevMonthHasData &&
    !lastMonthReminderDismissed;

  // 月度总结为独立 push 页（/summary）；card 点击落本月至今、月初提醒落上月，靠 period 参数区分。
  const router = useRouter();
  const openSummary = (period: string) => router.push({ pathname: '/summary', params: { period } });
  // 预算设置（降级态户主 CTA）。
  const [budgetOpen, setBudgetOpen] = useState(false);

  // 记账面板状态：editing=null 为新建，否则编辑该流水。
  const [sheet, setSheet] = useState<{ open: boolean; editing: Transaction | null; familyId: string }>({
    open: false,
    editing: null,
    familyId: '',
  });
  // 保存成功的顶部轻提示。
  const [savedToast, setSavedToast] = useState(false);
  // 首次记账庆祝：保存时标记 pending，待记账面板关闭动画结束（onDismiss）后再弹，避免叠在面板上。
  const [celebrate, setCelebrate] = useState(false);
  const pendingCelebrateRef = useRef(false);

  // 流水详情弹窗（点击列表项 → 只读详情；编辑/删除走左滑）。
  const [detail, setDetail] = useState<{ open: boolean; txn: Transaction | null }>({ open: false, txn: null });
  const softDeleteM = useSoftDeleteTransaction();

  // 金额显隐（眼睛）：统一到「记账设置 → 金额隐私模式」的服务端偏好（accountingPrefs 见上），
  // 跨设备一致；点眼睛即 toggle 该偏好（乐观更新）。
  const amountsHidden = accountingPrefs.amount_privacy;
  const toggleAmounts = useCallback(() => {
    saveAccountingPrefs.mutate({ ...accountingPrefs, amount_privacy: !accountingPrefs.amount_privacy });
  }, [saveAccountingPrefs, accountingPrefs]);

  // 月末计数提示条的「已关闭」记忆：关掉后本月内不再出现。
  const [countBannerDismissed, setCountBannerDismissed] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(COUNT_BANNER_DISMISSED_KEY).then((v) => {
      if (v === currentPeriod()) setCountBannerDismissed(true);
    });
  }, []);
  const dismissCountBanner = useCallback(() => {
    AsyncStorage.setItem(COUNT_BANNER_DISMISSED_KEY, currentPeriod());
    setCountBannerDismissed(true);
  }, []);
  useEffect(() => {
    AsyncStorage.getItem(LAST_MONTH_REMINDER_DISMISSED_KEY).then((v) => {
      setLastMonthReminderDismissed(v === prevPeriodStr);
    });
  }, [prevPeriodStr]);
  const dismissLastMonthReminder = useCallback(() => {
    AsyncStorage.setItem(LAST_MONTH_REMINDER_DISMISSED_KEY, prevPeriodStr);
    setLastMonthReminderDismissed(true);
  }, [prevPeriodStr]);

  // 成员头像 → 本地缓存路径（供原生流水行的真实头像同步读取）。
  const avatarFiles = useAvatarFiles(membersQ.data ?? []);

  const { groups, balance, expense, income, monthCount } = useMemo(() => {
    const txns = transactionsQ.data ?? [];
    const cats = categoriesQ.data ?? [];
    const members = membersQ.data ?? [];
    const catById = new Map(cats.map((c) => [c.id, c]));
    const memberById = new Map(members.map((m) => [m.id, m]));
    const myId = profileQ.data?.id;
    const myNick = profileQ.data?.nickname;
    const period = currentPeriod();

    let inc = 0;
    let exp = 0;
    let cnt = 0;

    // 用户 → 头像信息（真实照片本地路径，缺图回退首字母色块）。
    const avatarOf = (userId: string): AvatarInfo => {
      const nick = (userId === myId ? myNick : memberById.get(userId)?.nickname) ?? '成员';
      const initial = [...nick.trim()][0]?.toUpperCase() ?? '?';
      return { uri: avatarFiles.get(userId) ?? null, initial, tint: avatarTintFor(userId, avatarTints) };
    };

    const map = new Map<string, Group>();
    for (const t of txns) {
      const tp = currentPeriod(new Date(t.occurred_at));
      if (tp === period) {
        cnt += 1;
        if (t.type === 'income') inc += t.amount;
        else exp += t.amount;
      }

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
      group.totalCents += t.type === 'income' ? t.amount : -t.amount;

      // 被「他人」修改过：显示修改者头像，时间切到最新修改时间；否则用记账时间。
      const editedByOther = !!t.last_editor_user_id && t.last_editor_user_id !== t.recorder_user_id;
      group.rows.push({
        id: t.id,
        title: cat?.name ?? '未分类',
        symbol: categorySymbol(cat?.icon ?? null, ttype),
        iconColor: catColors[categoryColorKey(cat?.name ?? '', ttype)],
        amountCents: t.amount,
        sign: signForType(ttype),
        amountColor: ttype === 'income' ? palette.income : palette.expense,
        note: t.note,
        timeLabel: clockTime(editedByOther ? t.updated_at : t.occurred_at),
        recorder: avatarOf(t.recorder_user_id),
        editor: editedByOther ? avatarOf(t.last_editor_user_id as string) : null,
      });
    }

    return {
      groups: Array.from(map.values()),
      balance: inc - exp,
      expense: exp,
      income: inc,
      monthCount: cnt,
    };
  }, [
    transactionsQ.data,
    categoriesQ.data,
    membersQ.data,
    profileQ.data,
    avatarFiles,
    catColors,
    palette,
    avatarTints,
  ]);

  // 记一笔：若当前用户还没有家庭，先自动建「单人家庭」（M1：登录 + 单人家庭自动创建）。
  const openCreate = async () => {
    // 记账人必须是有效用户 id；profile 拉取失败时不进面板，避免把空 id 发给后端。
    if (!profileQ.data?.id) {
      Alert.alert('暂时无法记账', '账号信息还没加载好，请稍后重试或重新进入「我的」。');
      return;
    }
    let fid = familyQ.data?.id ?? profileQ.data?.current_family_id ?? null;
    if (!fid) {
      try {
        const fam = (await createFamilyM.mutateAsync({ name: '我的家' })) as { id: string };
        fid = fam.id;
      } catch (e) {
        Alert.alert('创建家庭失败', (e as Error).message ?? String(e));
        return;
      }
    }
    setSheet({ open: true, editing: null, familyId: fid });
  };

  const openEdit = (id: string) => {
    const txn = (transactionsQ.data ?? []).find((t) => t.id === id);
    if (txn) setSheet({ open: true, editing: txn, familyId: txn.family_id });
  };

  // 点击列表项 → 只读详情弹窗。
  const openDetail = (id: string) => {
    const txn = (transactionsQ.data ?? []).find((t) => t.id === id);
    if (txn) setDetail({ open: true, txn });
  };

  // 左滑「删除」→ 二次确认（危险按钮红色），确认后软删除。
  const confirmDelete = (id: string) => {
    Alert.alert('删除这笔记录？', '删除后将从账单中移除，无法在 App 内恢复。', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => softDeleteM.mutate(id) },
    ]);
  };

  const month = new Date().getMonth() + 1;
  // 月末（25 日~月底）才展示「家里记下 N 笔」计数条，且本月未被关闭；月初提醒优先。
  const showCountBanner =
    !showLastMonthReminder && new Date().getDate() >= 25 && monthCount > 0 && !countBannerDismissed;
  const loading = profileQ.isLoading || transactionsQ.isLoading || categoriesQ.isLoading;

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <View style={styles.flex}>
        {loading ? (
          <HomeSkeleton topPadding={headerHeight - insets.top + Space[2]} />
        ) : !session ? (
          <View style={styles.center}>
            <ThemedText style={{ color: palette.textSecondary }}>请先登录</ThemedText>
            <Link href={'/mine' as Href}>
              <ThemedText style={{ color: palette.info }}>去「我的」登录</ThemedText>
            </Link>
          </View>
        ) : groups.length === 0 ? (
          <View style={styles.center}>
            <SymbolView name="tray" tintColor={palette.textTertiary} size={48} />
            <ThemedText style={{ color: palette.textSecondary }}>还没有记账，点 + 记一笔</ThemedText>
          </View>
        ) : (
          <Host style={styles.flex}>
            {/* insetGrouped List：按日分组 = 白卡 Section，行内左滑「编辑/删除」（原生 swipeActions 仅在 List 内生效）。 */}
            <List
              modifiers={[
                listStyle('insetGrouped'),
                listSectionSpacing(Space[3]),
                ...(scrollGeometry ? [scrollGeometry] : []),
              ]}
            >
              {/* 顶部 Hero/横幅走 insetGrouped 原生单行 Section，由系统 row 背景负责圆角。 */}
              <Section
                header={
                  <VStack
                    modifiers={[
                      // 顶部留白让脉搏卡落在悬浮头之下；放在 header，避免白卡背景向上延伸。
                      frame({ height: Math.max(0, headerHeight - insets.top - Space[5]) }),
                    ]}
                  >
                    <Spacer />
                  </VStack>
                }
                modifiers={[listRowBackground(palette.card), listRowSeparator('hidden')]}
              >
                <PulseCard
                  hasBudget={hasBudget}
                  totalCents={budget?.total_amount ?? 0}
                  usedCents={usedTotal}
                  balanceCents={balance}
                  expenseCents={expense}
                  incomeCents={income}
                  daysLeft={daysToMonthEnd()}
                  isOwner={isOwner}
                  hidden={amountsHidden}
                  onToggleHidden={toggleAmounts}
                  onPress={() => openSummary(currentPeriod())}
                  onSetBudget={() => setBudgetOpen(true)}
                />
              </Section>
              {showLastMonthReminder ? (
                <Section modifiers={[listRowBackground(palette.bannerTint), listRowSeparator('hidden')]}>
                  <InsightBanner
                    title="上月总结来啦 🎉"
                    subtitle="看看上个月家里的开销与变化"
                    onPress={() => openSummary(prevPeriodStr)}
                    onDismiss={dismissLastMonthReminder}
                  />
                </Section>
              ) : showCountBanner ? (
                <Section modifiers={[listRowBackground(palette.bannerTint), listRowSeparator('hidden')]}>
                  <InsightBanner
                    title={`${month} 月家里一起记下了 ${monthCount} 笔`}
                    subtitle="每一笔都是一家人生活的痕迹"
                    onDismiss={dismissCountBanner}
                  />
                </Section>
              ) : null}
              {groups.map((g) => (
                <DayGroup
                  key={g.key}
                  label={g.label}
                  totalCents={g.totalCents}
                  rows={g.rows}
                  onRowPress={openDetail}
                  onEdit={openEdit}
                  onDelete={confirmDelete}
                />
              ))}
              {/* 末尾「没有更多了」提示 + 底部留白 */}
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

        {/* 顶栏：绝对覆盖层，随滚动上移淡出，越接近顶部越显现（IA §2） */}
        <View style={[styles.headerClip, { height: headerHeight }]} pointerEvents="box-none">
          <Animated.View
            style={[styles.header, { backgroundColor: palette.base, paddingTop: insets.top + Space[2] }, headerStyle]}
            onLayout={onHeaderLayout}
          >
            <View style={styles.headerText}>
              <ThemedText style={[styles.title, { color: palette.textPrimary }]}>首页</ThemedText>
              <ThemedText style={[styles.subtitle, { color: palette.textSecondary }]}>
                {profileQ.data?.nickname
                  ? `${greetingForHour()}，${profileQ.data.nickname}，掌握每一笔，生活更从容`
                  : `${greetingForHour()}，掌握每一笔，生活更从容`}
              </ThemedText>
            </View>
            <HeaderSearchButton style={styles.searchBtn} />
          </Animated.View>
        </View>
      </View>

      {/* 记一笔 悬浮钮（IA §2：Tab Bar 右上方常驻） */}
      {/* 系统蓝强调底 + 白加号：accent 系统蓝（DESIGN §9.2 v0.6.0） */}
      <Pressable onPress={openCreate} style={[styles.fab, { backgroundColor: palette.accent, shadowColor: '#000' }]}>
        <SymbolView name="plus" tintColor={palette.onAccent} size={28} weight="semibold" />
      </Pressable>

      {/* 记账面板（流程 2 + 编辑/删除 流程 10） */}
      <RecordSheet
        visible={sheet.open}
        editing={sheet.editing}
        familyId={sheet.familyId}
        recorderId={profileQ.data?.id ?? ''}
        onSaved={({ firstRecord }) => {
          // 第一笔：标记待庆祝（面板关闭后再弹）；否则走常规「已记一笔」toast。
          if (firstRecord) pendingCelebrateRef.current = true;
          else setSavedToast(true);
        }}
        onDismiss={() => {
          if (pendingCelebrateRef.current) {
            pendingCelebrateRef.current = false;
            setCelebrate(true);
          }
        }}
        onClose={() => setSheet({ open: false, editing: null, familyId: '' })}
      />

      {/* 保存成功顶部轻提示 */}
      <Toast visible={savedToast} text="已记一笔" onHide={() => setSavedToast(false)} />

      {/* 首次记账庆祝（PRD §4.3 S1）：面板关闭后弹出 */}
      <FirstRecordCelebration visible={celebrate} onClose={() => setCelebrate(false)} />

      {/* 月度总结为独立 push 页（/summary），入口在脉搏卡与月初提醒，见 openSummary。 */}

      {/* 预算设置（降级态户主 CTA → 流程 8） */}
      <BudgetSheet visible={budgetOpen} onClose={() => setBudgetOpen(false)} />

      {/* 流水详情弹窗（点击列表项 → 只读详情；点遮罩/X 关闭） */}
      <TransactionDetailSheet
        visible={detail.open}
        transaction={detail.txn}
        onClose={() => setDetail((d) => ({ ...d, open: false }))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space[3] },
  headerClip: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden', zIndex: 10 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: Space[4],
    paddingTop: Space[2],
    paddingBottom: Space[3],
  },
  headerText: { flex: 1, gap: Space[2] },
  title: { fontSize: 34, lineHeight: 41, fontWeight: '700' },
  subtitle: { fontSize: 14, lineHeight: 18 },
  searchBtn: { paddingTop: Space[2] },
  fab: {
    position: 'absolute',
    right: Space[4],
    bottom: 96,
    width: 56,
    height: 56,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
