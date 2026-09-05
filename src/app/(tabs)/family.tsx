/**
 * 家庭（Tab 3）：有家庭·户主 → 身份仪表盘（hero + 成员 + 快捷功能带实时角标 + 家庭管理）；
 * 无家庭 → 创建/加入兜底；非户主成员 → 仪表盘 + 退出家庭。
 * 定位：家庭身份 / 成员概览 / 能力入口 + 当下状态（预算剩余·储蓄目标数·通知未读红点）；
 * 聚合·对比类（收支环比、成员贡献排名）归报表 Tab，本页不再重复（IA §110）。
 * 全程 RN 渲染（交互态多，沿用 mine.tsx 卡片风格）；二维码/扫码/各面板在独立 Sheet 内。
 */
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  useBudget,
  useBudgetProgress,
  useCategories,
  useCreateFamily,
  useDissolveFamily,
  useFamilyActivity,
  useLeaveFamily,
  useMemberships,
  useMyFamily,
  useMyProfile,
  useSavingsGoals,
  useTransaction,
  useUnreadNotifications,
  type FamilyMembership,
  type SavingsGoal,
  type Transaction,
} from '@/api';
import { ThemedText } from '@/components/themed-text';
import { toast } from '@/components/toast';
import { UserAvatar } from '@/components/user-avatar';
import { Radius, Space, TabBarInset, usePalette } from '@/constants/design';
import { MAX_FAMILY_MEMBERS } from '@/constants/family';
import { BudgetSheet } from '@/features/budget/budget-sheet';
import { CategoryManageSheet } from '@/features/category/manage-sheet';
import { DangerConfirmSheet } from '@/features/family/danger-confirm-sheet';
import { InviteSheet } from '@/features/family/invite-sheet';
import { MemberManageSheet } from '@/features/family/member-manage-sheet';
import { ScanSheet } from '@/features/family/scan-sheet';
import { FamilySettingsSheet } from '@/features/family/settings-sheet';
import { TransactionDetailSheet } from '@/features/home/transaction-detail-sheet';
import { NotificationCenterSheet } from '@/features/notifications/center-sheet';
import { RecordSheet } from '@/features/record/record-sheet';
import { SavingsSheet } from '@/features/savings/savings-sheet';
import { HeaderSearchButton } from '@/features/search/search-provider';
import { useCollapsibleHeader } from '@/features/shared/use-collapsible-header';
import { alertOk, displayCategoryName, t, useLocalePreference } from '@/i18n';
import { budgetLevel, daysToMonthEnd } from '@/lib/budget';
import { currentPeriodInTimeZone, formatAmount } from '@/lib/format';

/** 瓦片角标用的紧凑金额：分 → 「¥1,280」（取整到元，带千分位）。 */
function formatCny(cents: number): string {
  return `¥${Math.round(cents / 100).toLocaleString('en-US')}`;
}

export default function FamilyScreen() {
  const palette = usePalette();
  useLocalePreference();
  const insets = useSafeAreaInsets();
  const { scrollRef, headerHeight, headerStyle, onHeaderLayout } = useCollapsibleHeader(insets.top + 69);
  const profileQ = useMyProfile();
  const familyQ = useMyFamily();
  const period = currentPeriodInTimeZone(familyQ.data?.timezone);
  const membershipsQ = useMemberships();
  const activityQ = useFamilyActivity();
  const categoriesQ = useCategories();
  const budgetQ = useBudget(period);
  const budgetProgressQ = useBudgetProgress(period);
  const savingsQ = useSavingsGoals();
  const unreadQ = useUnreadNotifications();
  const latestTransactionQ = useTransaction(activityQ.data?.latest_transaction_id);
  const createFamilyM = useCreateFamily();
  const leaveM = useLeaveFamily();
  const dissolveM = useDissolveFamily();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [memberManageOpen, setMemberManageOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [savingsOpen, setSavingsOpen] = useState(false);
  // 「家庭当下」点某目标 → 深链到该目标详情（F9）；从瓦片进则为 null（落列表）。
  const [savingsGoalId, setSavingsGoalId] = useState<string | null>(null);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [detailTransaction, setDetailTransaction] = useState<Transaction | null>(null);
  const [dissolveOpen, setDissolveOpen] = useState(false);
  // 成员管理页请求打开邀请页的待办标记（先关成员管理，其 dismiss 后再开邀请页）。
  const pendingInviteRef = useRef(false);

  const myId = profileQ.data?.id;
  const family = familyQ.data;
  const members = useMemo(() => membershipsQ.data ?? [], [membershipsQ.data]);
  const isOwner = !!family && family.owner_user_id === myId;

  // 家庭头像（avatar_url）与封面（cover_url）的更换入口在「家庭设置」，本页只读展示。

  // 家庭活跃度由服务端对完整历史流水聚合，日期边界以家庭时区为准。
  const activity = activityQ.data;
  const stats = {
    monthCount: activity?.month_count ?? 0,
    streak: activity?.family_streak ?? 0,
    myMonthCount: activity?.my_month_count ?? 0,
    myStreak: activity?.my_streak ?? 0,
    monthParticipantCount: activity?.month_member_count ?? 0,
    todayCount: activity?.today_count ?? 0,
    latestMonthTransaction: latestTransactionQ.data ?? null,
  };

  // ── 预算执行（口径同预算页：仅日常支出，排除储蓄流水）──
  const budgetTotal = budgetQ.data?.budget?.total_amount ?? null;
  const budgetUsed = budgetProgressQ.data?.usedAmount ?? 0;
  const budgetRemaining = budgetTotal == null ? 0 : budgetTotal - budgetUsed;
  const budgetPct = budgetTotal && budgetTotal > 0 ? Math.round((budgetUsed / budgetTotal) * 100) : 0;
  const budgetSub =
    budgetTotal == null
      ? t('settings.notSet')
      : budgetRemaining >= 0
        ? t('common.leftover', { amount: formatCny(budgetRemaining) })
        : t('common.overBudget');

  // ── 储蓄目标：数量角标 + 「家庭当下」精选目标（截止日最近的进行中目标）──
  const goals = useMemo(() => savingsQ.data ?? [], [savingsQ.data]);
  const goalCount = goals.length;
  const savingsSub = goalCount > 0 ? t('common.goalCount', { count: goalCount }) : t('family.poolMoney');
  const featuredGoal = useMemo<SavingsGoal | null>(() => {
    // 只在未达成目标里选：优先有截止日且最近的；其余按原顺序（最新创建在前）兜底。已达成的不展示。
    const active = goals.filter((g) => g.saved_amount < g.target_amount);
    if (active.length === 0) return null;
    const withDeadline = active.filter((g) => g.deadline).sort((a, b) => a.deadline!.localeCompare(b.deadline!));
    return withDeadline[0] ?? active[0];
  }, [goals]);
  const activeGoalCount = useMemo(() => goals.filter((g) => g.saved_amount < g.target_amount).length, [goals]);

  const unreadCount = unreadQ.data?.length ?? 0;
  const latestTxn = stats.latestMonthTransaction;
  const latestCat = latestTxn
    ? (categoriesQ.data ?? []).find((category) => category.id === latestTxn.category_id)
    : undefined;
  const latestMonthCategory = latestTxn
    ? latestCat
      ? displayCategoryName(latestCat.name, latestCat.is_system)
      : t('common.uncategorized')
    : null;
  const latestMonthRecorder = latestTxn
    ? (members.find((member) => member.userId === latestTxn.recorder_user_id)?.nickname ?? t('common.familyMember'))
    : null;
  // 单人家庭：隐藏成员列表与「家庭当下」，聚焦邀请转化（PRD F1 关键态）。
  const singlePerson = (family?.member_count ?? members.length) <= 1;

  const onCreate = () => {
    Alert.prompt(
      t('family.create'),
      t('family.createPrompt'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.create'),
          onPress: async (name?: string) => {
            try {
              await createFamilyM.mutateAsync({ name: name?.trim() || t('home.myHome') });
            } catch (e) {
              Alert.alert(t('family.createFailed'), (e as Error).message ?? String(e), alertOk());
            }
          },
        },
      ],
      'plain-text',
      t('home.myHome'),
    );
  };

  const onLeave = () => {
    Alert.alert(t('family.leave'), t('family.leaveConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('family.leave'),
        style: 'destructive',
        onPress: async () => {
          try {
            await leaveM.mutateAsync();
          } catch (e) {
            Alert.alert(t('family.leaveFailed'), (e as Error).message ?? String(e), alertOk());
          }
        },
      },
    ]);
  };

  // 解散走「输入家庭名 + 滑动确认」对话框（流程 5），见底部 DangerConfirmSheet。
  // 成员移除 / 户主转让已收口到「成员管理」页（MemberManageSheet）。
  const onDissolve = () => setDissolveOpen(true);

  const onInvite = () => {
    if (!isOwner) {
      toast.warning(t('family.ownerOnlyInvite'));
      return;
    }
    setInviteOpen(true);
  };

  const openSavingsList = () => {
    setSavingsGoalId(null);
    setSavingsOpen(true);
  };
  const openGoalDetail = (id: string) => {
    setSavingsGoalId(id);
    setSavingsOpen(true);
  };

  const loading = profileQ.isLoading || familyQ.isLoading;
  const busy = createFamilyM.isPending || leaveM.isPending || dissolveM.isPending;

  const createdLabel = family?.created_at
    ? (() => {
        const d = new Date(family.created_at);
        return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
      })()
    : '—';

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <View style={styles.flex}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : !family ? (
          // ── 无家庭：创建 / 加入 ──
          <View style={styles.center}>
            <SymbolView name="person.2" tintColor={palette.textTertiary} size={48} />
            <ThemedText style={{ color: palette.textSecondary }}>{t('family.notJoined')}</ThemedText>
            <View style={styles.emptyActions}>
              <Pressable
                disabled={busy}
                onPress={onCreate}
                style={[styles.primary, { backgroundColor: palette.ink, opacity: busy ? 0.5 : 1 }]}
              >
                <ThemedText style={[styles.primaryText, { color: palette.onInk }]}>{t('family.create')}</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => setScanOpen(true)}
                style={[styles.secondary, { borderColor: palette.separator }]}
              >
                <ThemedText style={{ color: palette.textPrimary, fontSize: 16 }}>{t('family.scanJoin')}</ThemedText>
              </Pressable>
            </View>
          </View>
        ) : (
          // ── 有家庭：富仪表盘 ──
          <Animated.ScrollView
            ref={scrollRef}
            scrollEventThrottle={16}
            contentContainerStyle={[styles.content, { paddingTop: headerHeight + Space[2] }]}
            scrollIndicatorInsets={{ top: headerHeight, bottom: TabBarInset }}
          >
            {/* Hero：家庭名片（封面图 / 品牌蓝渐变 + 家庭头像）+ 三项统计（毛玻璃）。身份区，全 App 唯一放胆用色处。 */}
            <View style={styles.hero}>
              {/* 背景层：有封面（cover_url）显封面大图，无则品牌蓝渐变 */}
              {family.cover_url ? (
                <Image source={family.cover_url} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
              ) : (
                <View style={[StyleSheet.absoluteFill, styles.heroGradient]} />
              )}
              {/* 暗色蒙版：保证白字在任意背景（亮蓝 / 浅色封面）下可读 */}
              <View style={[StyleSheet.absoluteFill, styles.heroScrim]} pointerEvents="none" />
              {!family.cover_url ? (
                <SymbolView
                  name="house.fill"
                  tintColor="rgba(255,255,255,0.14)"
                  size={96}
                  style={styles.heroHouse}
                  pointerEvents="none"
                />
              ) : null}

              <View style={styles.heroHead}>
                <View style={styles.heroTop}>
                  {/* 家庭头像（avatar_url）：只读展示；更换入口在「家庭设置」 */}
                  {family.avatar_url ? (
                    <Image
                      source={family.avatar_url}
                      style={styles.heroBadgeGlass}
                      contentFit="cover"
                      transition={150}
                    />
                  ) : (
                    <View style={styles.heroBadgeGlass}>
                      <ThemedText style={styles.heroBadgeText}>{t('family.badge')}</ThemedText>
                    </View>
                  )}
                  <View style={styles.flex}>
                    <ThemedText style={styles.heroName}>{family.name}</ThemedText>
                    <View style={styles.heroMetaRow}>
                      <SymbolView name="person.2.fill" tintColor="rgba(255,255,255,0.85)" size={13} />
                      <ThemedText style={styles.heroMeta}>
                        {t('family.memberCount', { count: family.member_count })}
                      </ThemedText>
                      {isOwner ? (
                        <View style={styles.heroRoleBadge}>
                          <ThemedText style={styles.heroRoleBadgeText}>{t('common.owner')}</ThemedText>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </View>
                <ThemedText style={styles.heroTagline}>{family.slogan}</ThemedText>
              </View>

              <BlurView intensity={24} tint="dark" style={styles.heroStats}>
                <HeroStat
                  icon="book.closed.fill"
                  value={`${stats.monthCount}`}
                  unit={t('common.countUnit')}
                  label={t('family.monthRecorded')}
                />
                <View style={styles.heroStatDivider} />
                <HeroStat
                  icon="flame.fill"
                  value={`${stats.streak}`}
                  unit={t('common.dayUnit')}
                  label={t('family.streak')}
                />
                <View style={styles.heroStatDivider} />
                <HeroStat icon="calendar" value={createdLabel} label={t('family.createdAt')} />
              </BlurView>
            </View>

            {singlePerson ? (
              <InviteGuideCard palette={palette} onGenerate={onInvite} onScan={() => setScanOpen(true)} />
            ) : (
              <>
                <FamilyNowCard
                  palette={palette}
                  budgetSet={budgetTotal != null}
                  budgetUsed={budgetUsed}
                  budgetTotal={budgetTotal ?? 0}
                  budgetPct={budgetPct}
                  budgetRemaining={budgetRemaining}
                  daysLeft={daysToMonthEnd()}
                  goal={featuredGoal}
                  activeGoalCount={activeGoalCount}
                  isOwner={isOwner}
                  onBudget={() => setBudgetOpen(true)}
                  onSavingsList={openSavingsList}
                  onGoalDetail={openGoalDetail}
                />

                <FamilyCollaborationCard
                  members={members}
                  todayCount={stats.todayCount}
                  monthParticipantCount={stats.monthParticipantCount}
                  myMonthCount={stats.myMonthCount}
                  myStreak={stats.myStreak}
                  latestTransaction={stats.latestMonthTransaction}
                  latestCategoryName={latestMonthCategory}
                  latestRecorderName={latestMonthRecorder}
                  canInvite={isOwner && members.length < MAX_FAMILY_MEMBERS}
                  onManage={() => setMemberManageOpen(true)}
                  onRecord={() => setRecordOpen(true)}
                  onInvite={onInvite}
                  onViewLatest={() => setDetailTransaction(stats.latestMonthTransaction)}
                />
              </>
            )}

            {/* 快捷功能 */}
            <View style={styles.section}>
              <ThemedText style={[styles.sectionTitle, { color: palette.textPrimary }]}>
                {t('family.shortcuts')}
              </ThemedText>
              <View style={styles.quickRow}>
                <QuickTile
                  icon="chart.pie.fill"
                  title={t('family.budget')}
                  sub={budgetSub}
                  onPress={() => setBudgetOpen(true)}
                />
                <QuickTile
                  icon="target"
                  title={t('family.savingsGoalsShort')}
                  sub={savingsSub}
                  onPress={openSavingsList}
                />
                <QuickTile
                  icon="person.crop.circle.badge.plus"
                  title={t('family.inviteShort')}
                  sub={t('family.inviteSub')}
                  onPress={onInvite}
                />
                <QuickTile
                  icon="bell.fill"
                  title={t('family.notificationsShort')}
                  sub={unreadCount > 0 ? t('common.unreadCount', { count: unreadCount }) : t('family.important')}
                  badge={unreadCount}
                  onPress={() => setNotifyOpen(true)}
                />
                <QuickTile
                  icon="square.grid.2x2.fill"
                  title={t('family.categories')}
                  sub={t('family.categoriesSub')}
                  onPress={() => setCategoryOpen(true)}
                />
              </View>
            </View>

            {/* 家庭管理 */}
            <View style={styles.section}>
              <ThemedText style={[styles.sectionTitle, { color: palette.textPrimary }]}>
                {t('family.management')}
              </ThemedText>
              <View style={[styles.card, { backgroundColor: palette.card }]}>
                {isOwner ? (
                  <>
                    <ManageRow
                      icon="gearshape"
                      title={t('family.settings')}
                      sub={t('family.settingsSub')}
                      onPress={() => setSettingsOpen(true)}
                    />
                    <View style={[styles.divider, { backgroundColor: palette.separator }]} />
                    <ManageRow
                      icon="trash"
                      title={t('family.dissolve')}
                      sub={t('family.dissolveSub')}
                      onPress={onDissolve}
                      danger
                    />
                  </>
                ) : (
                  <ManageRow
                    icon="rectangle.portrait.and.arrow.right"
                    title={t('family.leave')}
                    sub={t('family.leaveSub')}
                    onPress={onLeave}
                    danger
                  />
                )}
              </View>
            </View>
          </Animated.ScrollView>
        )}

        {/* 标题：绝对覆盖层，随滚动上移淡出 */}
        <View style={[styles.headerClip, { height: headerHeight }]} pointerEvents="box-none">
          <Animated.View
            style={[styles.header, { backgroundColor: palette.base, paddingTop: insets.top + Space[4] }, headerStyle]}
            onLayout={onHeaderLayout}
          >
            <ThemedText style={[styles.title, { color: palette.textPrimary }]}>{t('family.title')}</ThemedText>
            <HeaderSearchButton />
          </Animated.View>
        </View>
      </View>
      <InviteSheet visible={inviteOpen} onClose={() => setInviteOpen(false)} />
      <ScanSheet visible={scanOpen} onClose={() => setScanOpen(false)} />
      {/* 成员管理里的「邀请家人」先关本页、待其 dismiss 动画结束再开邀请页，避免 pageSheet 叠加。 */}
      <MemberManageSheet
        visible={memberManageOpen}
        onClose={() => setMemberManageOpen(false)}
        onRequestInvite={() => {
          pendingInviteRef.current = true;
          setMemberManageOpen(false);
        }}
        onDismiss={() => {
          if (pendingInviteRef.current) {
            pendingInviteRef.current = false;
            setInviteOpen(true);
          }
        }}
      />
      <DangerConfirmSheet
        visible={dissolveOpen}
        title={t('family.dissolve')}
        message={t('family.dissolveMessage')}
        matchLabel={family ? t('family.dissolveMatch', { name: family.name }) : t('family.dissolveMatchEmpty')}
        matchValue={family?.name ?? ''}
        slideLabel={t('family.dissolveSlide')}
        onConfirm={async () => {
          await dissolveM.mutateAsync();
        }}
        onClose={() => setDissolveOpen(false)}
      />
      <BudgetSheet visible={budgetOpen} onClose={() => setBudgetOpen(false)} />
      <RecordSheet
        visible={recordOpen}
        editing={null}
        familyId={family?.id ?? ''}
        recorderId={myId ?? ''}
        onClose={() => setRecordOpen(false)}
      />
      <TransactionDetailSheet
        visible={detailTransaction != null}
        transaction={detailTransaction}
        onClose={() => setDetailTransaction(null)}
      />
      <SavingsSheet
        visible={savingsOpen}
        initialGoalId={savingsGoalId}
        onClose={() => {
          setSavingsOpen(false);
          setSavingsGoalId(null);
        }}
      />
      <CategoryManageSheet visible={categoryOpen} onClose={() => setCategoryOpen(false)} />
      <FamilySettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <NotificationCenterSheet visible={notifyOpen} onClose={() => setNotifyOpen(false)} />
    </View>
  );
}

// ── Hero 单项统计：图标 + 数值 + 标签（常驻彩色/封面之上，用白字）──
function HeroStat({
  icon,
  value,
  unit,
  label,
}: {
  icon: SymbolViewProps['name'];
  value: string;
  unit?: string;
  label: string;
}) {
  return (
    <View style={styles.heroStat}>
      <View style={styles.heroStatIcon}>
        <SymbolView name={icon} tintColor="rgba(255,255,255,0.9)" size={15} />
      </View>
      <View style={styles.heroStatBody}>
        <View style={styles.heroStatValueRow}>
          <ThemedText style={styles.heroStatValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {value}
          </ThemedText>
          {unit ? <ThemedText style={styles.heroStatUnit}>{unit}</ThemedText> : null}
        </View>
        <ThemedText style={styles.heroStatLabel} numberOfLines={1}>
          {label}
        </ThemedText>
      </View>
    </View>
  );
}

// ── 多人家庭：首页协作概览（名册与权限操作下沉至成员管理 Sheet）──
function FamilyCollaborationCard({
  members,
  todayCount,
  monthParticipantCount,
  myMonthCount,
  myStreak,
  latestTransaction,
  latestCategoryName,
  latestRecorderName,
  canInvite,
  onManage,
  onRecord,
  onInvite,
  onViewLatest,
}: {
  members: FamilyMembership[];
  todayCount: number;
  monthParticipantCount: number;
  myMonthCount: number;
  myStreak: number;
  latestTransaction: Transaction | null;
  latestCategoryName: string | null;
  latestRecorderName: string | null;
  canInvite: boolean;
  onManage: () => void;
  onRecord: () => void;
  onInvite: () => void;
  onViewLatest: () => void;
}) {
  const palette = usePalette();
  useLocalePreference();
  const hasTodayActivity = todayCount > 0 && latestTransaction != null;
  const hasMonthActivity = latestTransaction != null;
  const latestText = latestTransaction
    ? t('family.latestLine', {
        who: latestRecorderName ?? t('common.familyMember'),
        what: latestCategoryName ?? t('family.txnFallback'),
      })
    : t('family.latestFallback');

  return (
    <View style={styles.section}>
      <View style={[styles.card, styles.collaborationCard, { backgroundColor: palette.card }]}>
        {/* 标题区是唯一的成员管理入口，避免与卡内主 CTA 发生嵌套点击冲突。 */}
        <Pressable
          onPress={onManage}
          style={styles.collaborationHeader}
          accessibilityRole="button"
          accessibilityLabel={t('family.openMembers')}
          accessibilityHint={t('family.openMembersHint')}
        >
          <View style={styles.collaborationTitleRow}>
            <ThemedText style={[styles.collaborationTitle, { color: palette.textPrimary }]}>
              {t('family.collaboration')}
            </ThemedText>
            <ThemedText style={[styles.collaborationCount, { color: palette.textTertiary }]}>
              {members.length}/{MAX_FAMILY_MEMBERS}
            </ThemedText>
          </View>
          <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={16} />
        </Pressable>

        <View
          style={styles.collaborationAvatars}
          accessibilityLabel={t('family.membersA11y', { count: members.length })}
          accessible
        >
          {members.map((member) => (
            <UserAvatar key={member.id} avatarUrl={member.avatarUrl} nickname={member.nickname} size={44} />
          ))}
        </View>

        {!hasTodayActivity ? (
          <View style={styles.collaborationEmpty}>
            <View style={styles.collaborationEmptyHeadline}>
              <Image
                source={require('@/assets/images/family-records-empty.svg')}
                style={styles.collaborationEmptyIcon}
                contentFit="contain"
                accessible={false}
              />
              <ThemedText style={[styles.collaborationEmptyTitle, { color: palette.textPrimary }]}>
                {t('family.emptyToday')}
              </ThemedText>
            </View>
          </View>
        ) : null}

        {hasMonthActivity ? (
          <>
            <View style={[styles.collaborationStats, { backgroundColor: palette.elevated }]}>
              <CollaborationStat
                label={t('family.monthJoin')}
                value={`${monthParticipantCount} ${t('common.peopleUnit')}`}
                color={palette.success}
              />
              <View style={[styles.collaborationStatDivider, { backgroundColor: palette.separator }]} />
              <CollaborationStat
                label={t('family.streakShort')}
                value={`${myStreak} ${t('common.dayUnit')}`}
                color={palette.warning}
              />
              <View style={[styles.collaborationStatDivider, { backgroundColor: palette.separator }]} />
              <CollaborationStat
                label={t('family.monthCount')}
                value={`${myMonthCount} ${t('common.countUnit')}`}
                color={palette.accent}
              />
            </View>
            <View style={styles.collaborationRecentRow}>
              <View style={[styles.collaborationRecentDot, { backgroundColor: palette.accent }]} />
              <View style={styles.collaborationRecentText}>
                <ThemedText
                  style={[styles.collaborationRecentTitle, { color: palette.textSecondary }]}
                  numberOfLines={1}
                >
                  {latestText}
                </ThemedText>
                <ThemedText
                  style={[styles.collaborationRecentAmount, { color: palette.textPrimary }]}
                  numberOfLines={1}
                >
                  {formatAmount(latestTransaction.amount)}
                </ThemedText>
              </View>
              <Pressable
                onPress={onViewLatest}
                style={styles.collaborationViewAction}
                accessibilityRole="button"
                accessibilityLabel={t('family.viewLatest')}
                accessibilityHint={t('family.viewLatestHint')}
              >
                <ThemedText style={[styles.collaborationViewActionText, { color: palette.accent }]}>
                  {t('family.viewActivity')}
                </ThemedText>
              </Pressable>
            </View>
          </>
        ) : null}

        {!hasMonthActivity ? (
          <ThemedText style={[styles.collaborationEmptyDetail, { color: palette.textSecondary }]}>
            {t('family.emptyMonth')}
          </ThemedText>
        ) : null}

        {/* 记账是可连续完成的主任务；成功后更新内容，不撤走入口。邀请只由户主权限与人数上限决定。 */}
        <View style={styles.collaborationActions}>
          <Pressable
            onPress={onRecord}
            style={[styles.collaborationAction, { backgroundColor: palette.ink }]}
            accessibilityRole="button"
            accessibilityLabel={t('home.recordCta')}
            accessibilityHint={t('home.recordA11yHint')}
          >
            <SymbolView name="square.and.pencil" tintColor={palette.onInk} size={17} />
            <ThemedText style={[styles.collaborationActionText, { color: palette.onInk }]}>
              {t('home.recordCta')}
            </ThemedText>
          </Pressable>
          {canInvite ? (
            <Pressable
              onPress={onInvite}
              style={[styles.collaborationInviteAction, { borderColor: palette.separator }]}
              accessibilityRole="button"
              accessibilityLabel={t('family.invite')}
              accessibilityHint={t('family.inviteHint')}
            >
              <SymbolView name="person.crop.circle.badge.plus" tintColor={palette.textPrimary} size={17} />
              <ThemedText style={[styles.collaborationInviteActionText, { color: palette.textPrimary }]}>
                {t('family.invite')}
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function CollaborationStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.collaborationStat}>
      <ThemedText style={[styles.collaborationStatText, { color }]}>{`${label} ${value}`}</ThemedText>
    </View>
  );
}

// ── 家庭当下：预算执行 + 精选储蓄目标，两行均可点进各自面板（当下状态 + 行动）──
function FamilyNowCard({
  palette,
  budgetSet,
  budgetUsed,
  budgetTotal,
  budgetPct,
  budgetRemaining,
  daysLeft,
  goal,
  activeGoalCount,
  isOwner,
  onBudget,
  onSavingsList,
  onGoalDetail,
}: {
  palette: ReturnType<typeof usePalette>;
  budgetSet: boolean;
  budgetUsed: number;
  budgetTotal: number;
  budgetPct: number;
  budgetRemaining: number;
  daysLeft: number;
  goal: SavingsGoal | null;
  activeGoalCount: number;
  isOwner: boolean;
  onBudget: () => void;
  onSavingsList: () => void;
  onGoalDetail: (id: string) => void;
}) {
  const level = budgetLevel(budgetPct);
  useLocalePreference();
  const budgetColor = level === 'danger' ? palette.danger : level === 'warning' ? palette.warning : palette.accent;
  const goalPct =
    goal && goal.target_amount > 0 ? Math.min(100, Math.round((goal.saved_amount / goal.target_amount) * 100)) : 0;
  const goalRemain = goal ? Math.max(0, goal.target_amount - goal.saved_amount) : 0;

  return (
    <View style={styles.section}>
      <ThemedText style={[styles.sectionTitle, { color: palette.textPrimary }]}>{t('family.now')}</ThemedText>
      <View style={[styles.card, { backgroundColor: palette.card }]}>
        {/* 预算行 */}
        <Pressable style={styles.nowBlock} onPress={onBudget}>
          <View style={styles.nowHead}>
            <View style={styles.nowHeadL}>
              <SymbolView name="chart.pie.fill" tintColor={palette.accent} size={14} />
              <ThemedText style={[styles.nowLabel, { color: palette.textPrimary }]}>
                {t('family.monthBudget')}
              </ThemedText>
            </View>
            <View style={styles.nowHeadR}>
              {budgetSet ? (
                <ThemedText style={[styles.nowMeta, { color: palette.textTertiary }]}>
                  {t('family.daysToEnd', { days: daysLeft })}
                </ThemedText>
              ) : null}
              <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={13} />
            </View>
          </View>
          {budgetSet ? (
            <>
              <View style={styles.nowAmountRow}>
                <View style={styles.nowAmountLeft}>
                  <ThemedText style={[styles.nowAmountBig, { color: palette.textPrimary }]}>
                    {formatAmount(budgetUsed)}
                  </ThemedText>
                  <ThemedText style={[styles.nowAmountSub, { color: palette.textSecondary }]}>
                    {' / '}
                    {formatAmount(budgetTotal)}
                  </ThemedText>
                </View>
                <ThemedText style={[styles.nowPct, { color: budgetColor }]}>{budgetPct}%</ThemedText>
              </View>
              <View style={[styles.nowTrack, { backgroundColor: palette.separator }]}>
                <View
                  style={[styles.nowFill, { backgroundColor: budgetColor, width: `${Math.min(100, budgetPct)}%` }]}
                />
              </View>
              <ThemedText style={[styles.nowFoot, { color: palette.textSecondary }]}>
                {budgetRemaining >= 0
                  ? t('common.leftoverOf', { amount: formatAmount(budgetRemaining) })
                  : t('common.overBy', { amount: formatAmount(-budgetRemaining) })}
              </ThemedText>
            </>
          ) : (
            <ThemedText style={[styles.nowFoot, { color: palette.textSecondary }]}>
              {isOwner ? t('family.setBudget') : t('family.askOwnerBudget')}
            </ThemedText>
          )}
        </Pressable>

        <View style={[styles.divider, { backgroundColor: palette.separator }]} />

        {/* 储蓄行：有目标 → 精选目标进度（点进详情）；无 → 引导建目标 */}
        {goal ? (
          <Pressable style={styles.nowBlock} onPress={() => onGoalDetail(goal.id)}>
            <View style={styles.nowHead}>
              <View style={styles.nowHeadL}>
                <SymbolView name="target" tintColor={palette.accent} size={14} />
                <ThemedText style={[styles.nowLabel, { color: palette.textPrimary }]} numberOfLines={1}>
                  {goal.name}
                </ThemedText>
              </View>
              <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={13} />
            </View>
            <View style={styles.nowAmountRow}>
              <View style={styles.nowAmountLeft}>
                <ThemedText style={[styles.nowAmountBig, { color: palette.textPrimary, fontSize: 18 }]}>
                  {formatAmount(goal.saved_amount)}
                </ThemedText>
                <ThemedText style={[styles.nowAmountSub, { color: palette.textSecondary }]}>
                  {' / '}
                  {formatAmount(goal.target_amount)}
                </ThemedText>
              </View>
              <ThemedText style={[styles.nowPct, { color: palette.accent }]}>{goalPct}%</ThemedText>
            </View>
            <View style={[styles.nowTrack, { backgroundColor: palette.separator }]}>
              <View style={[styles.nowFill, { backgroundColor: palette.accent, width: `${goalPct}%` }]} />
            </View>
            <ThemedText style={[styles.nowFoot, { color: palette.textSecondary }]}>
              {goalRemain > 0 ? t('family.goalRemain', { amount: formatAmount(goalRemain) }) : t('family.goalDone')}
              {activeGoalCount > 1 ? t('family.moreGoals', { count: activeGoalCount - 1 }) : ''}
            </ThemedText>
          </Pressable>
        ) : (
          <Pressable style={styles.nowBlock} onPress={onSavingsList}>
            <View style={styles.nowHead}>
              <View style={styles.nowHeadL}>
                <SymbolView name="target" tintColor={palette.accent} size={14} />
                <ThemedText style={[styles.nowLabel, { color: palette.textPrimary }]}>
                  {t('family.savingsGoals')}
                </ThemedText>
              </View>
              <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={13} />
            </View>
            <ThemedText style={[styles.nowFoot, { color: palette.textSecondary }]}>{t('family.startGoal')}</ThemedText>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// ── 单人家庭：邀请引导卡（主 CTA 用墨色 ink，见 DESIGN §2.5 例外③）──
function InviteGuideCard({
  palette,
  onGenerate,
  onScan,
}: {
  palette: ReturnType<typeof usePalette>;
  onGenerate: () => void;
  onScan: () => void;
}) {
  useLocalePreference();
  return (
    <View style={[styles.card, styles.invite, { backgroundColor: palette.bannerTint }]}>
      <View style={[styles.inviteIcon, { backgroundColor: palette.card }]}>
        <SymbolView name="person.2.fill" tintColor={palette.accent} size={26} />
      </View>
      <ThemedText style={[styles.inviteTitle, { color: palette.textPrimary }]}>{t('family.soloTitle')}</ThemedText>
      <ThemedText style={[styles.inviteBody, { color: palette.textSecondary }]}>{t('family.soloBody')}</ThemedText>
      <Pressable style={[styles.invitePrimary, { backgroundColor: palette.ink }]} onPress={onGenerate}>
        <SymbolView name="person.crop.circle.badge.plus" tintColor={palette.onInk} size={18} />
        <ThemedText style={[styles.invitePrimaryText, { color: palette.onInk }]}>{t('family.generateCode')}</ThemedText>
      </Pressable>
      <Pressable onPress={onScan}>
        <ThemedText style={[styles.inviteGhost, { color: palette.accent }]}>{t('family.orScan')}</ThemedText>
      </Pressable>
    </View>
  );
}

// ── 快捷功能瓦片（可选右上角红点角标，用于家庭通知未读数）──
function QuickTile({
  icon,
  title,
  sub,
  badge,
  onPress,
}: {
  icon: SymbolViewProps['name'];
  title: string;
  sub: string;
  badge?: number;
  onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable onPress={onPress} style={[styles.quickTile, { backgroundColor: palette.card }]}>
      {/* 单色近黑图标：与黑按钮同语言，全页彩色只留给金额/进度/选中（DESIGN §2 黑白灰骨架）。 */}
      <SymbolView name={icon} tintColor={palette.textPrimary} size={26} />
      <ThemedText style={[styles.quickTitle, { color: palette.textPrimary }]} numberOfLines={2}>
        {title}
      </ThemedText>
      <ThemedText style={[styles.quickSub, { color: palette.textTertiary }]} numberOfLines={1}>
        {sub}
      </ThemedText>
      {badge && badge > 0 ? (
        <View style={[styles.quickBadge, { backgroundColor: palette.danger, borderColor: palette.card }]}>
          <ThemedText style={styles.quickBadgeText}>{badge > 99 ? '99+' : badge}</ThemedText>
        </View>
      ) : null}
    </Pressable>
  );
}

// ── 家庭管理行：图标 + 标题/副标题 + 箭头 ──
function ManageRow({
  icon,
  title,
  sub,
  onPress,
  danger,
  disabled,
}: {
  icon: SymbolViewProps['name'];
  title: string;
  sub: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  const palette = usePalette();
  // 非危险项图标用近黑，与快捷功能瓦片同语言；危险项（解散/退出）保持红。
  const tint = danger ? palette.danger : palette.textPrimary;
  const titleColor = danger ? palette.danger : palette.textPrimary;
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.manageRow, { opacity: disabled ? 0.4 : 1 }]}>
      <SymbolView name={icon} tintColor={tint} size={20} />
      <View style={styles.flex}>
        <ThemedText style={[styles.manageTitle, { color: titleColor }]}>{title}</ThemedText>
        <ThemedText style={[styles.manageSub, { color: palette.textSecondary }]}>{sub}</ThemedText>
      </View>
      {!danger ? <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={14} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  headerClip: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden', zIndex: 10 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space[4],
    paddingTop: Space[4],
    paddingBottom: Space[3],
  },
  title: { fontSize: 34, lineHeight: 41, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space[3], paddingHorizontal: Space[6] },
  emptyActions: { width: '100%', gap: Space[3], marginTop: Space[4] },
  primary: { height: 50, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 17, fontWeight: '600' },
  secondary: {
    height: 50,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  content: { paddingHorizontal: Space[4], paddingBottom: TabBarInset, gap: Space[5] },

  // Hero（品牌蓝渐变 / 封面图之上，白字 + 毛玻璃统计条）
  hero: { borderRadius: Radius.lg, padding: Space[4], gap: Space[4], overflow: 'hidden' },
  heroGradient: { experimental_backgroundImage: 'linear-gradient(145deg, #3C9FFE, #0169D4)' },
  // 顶部略暗（白字标题可读）→ 中段透 → 底部加深（毛玻璃统计条上白字可读）
  heroScrim: {
    experimental_backgroundImage:
      'linear-gradient(180deg, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.06) 42%, rgba(0,0,0,0.40) 100%)',
  },
  heroHead: { gap: Space[2] },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Space[3] },
  heroBadgeGlass: {
    width: 50,
    height: 50,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  heroBadgeText: { fontSize: 24, lineHeight: 30, fontWeight: '700', color: '#FFFFFF' },
  heroName: { fontSize: 22, lineHeight: 28, fontWeight: '700', color: '#FFFFFF' },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', gap: Space[1], marginTop: 2 },
  heroMeta: { fontSize: 13, lineHeight: 18, color: 'rgba(255,255,255,0.85)' },
  heroTagline: { fontSize: 13, lineHeight: 18, color: 'rgba(255,255,255,0.78)' },
  heroHouse: { position: 'absolute', top: -8, right: -10 },
  heroRoleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  heroRoleBadgeText: { fontSize: 12, lineHeight: 16, fontWeight: '600', color: '#FFFFFF' },

  heroStats: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.md,
    paddingVertical: Space[3],
    paddingHorizontal: Space[1],
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  heroStat: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Space[2], paddingHorizontal: Space[1] },
  heroStatIcon: {
    width: 28,
    height: 28,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  heroStatBody: { flex: 1, gap: 1 },
  heroStatValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  heroStatValue: { flexShrink: 1, fontSize: 15, lineHeight: 19, fontWeight: '700', color: '#FFFFFF' },
  heroStatUnit: { fontSize: 11, lineHeight: 14, color: 'rgba(255,255,255,0.78)' },
  heroStatLabel: { fontSize: 11, lineHeight: 14, color: 'rgba(255,255,255,0.78)' },
  heroStatDivider: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: 'rgba(255,255,255,0.22)' },

  // 通用卡片 / 区块
  card: { borderRadius: Radius.lg, overflow: 'hidden' },
  section: { gap: Space[2] },
  sectionTitle: { fontSize: 17, fontWeight: '600', paddingHorizontal: Space[1] },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: Space[4] },

  // 家庭协作：首页用「状态 + 行动」代替逐行成员名册，完整名册下沉至成员管理。
  collaborationCard: { paddingHorizontal: Space[4], paddingVertical: Space[3], gap: Space[3] },
  collaborationHeader: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  collaborationTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: Space[2] },
  collaborationTitle: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  collaborationCount: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  collaborationAvatars: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space[3] },
  collaborationStats: {
    minHeight: 28,
    borderRadius: Radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: Space[2],
  },
  collaborationStat: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  collaborationStatText: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  collaborationStatDivider: { width: StyleSheet.hairlineWidth, height: 22 },
  collaborationRecentRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Space[2] },
  collaborationRecentDot: { width: 8, height: 8, borderRadius: Radius.full, flexShrink: 0 },
  collaborationRecentText: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline', gap: Space[2] },
  collaborationRecentTitle: { flexShrink: 1, fontSize: 14, lineHeight: 19, fontWeight: '500' },
  collaborationRecentAmount: { flexShrink: 0, fontSize: 14, lineHeight: 19, fontWeight: '600' },
  collaborationViewAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Space[1] },
  collaborationViewActionText: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  collaborationEmpty: { alignItems: 'center', gap: Space[1], paddingTop: Space[1] },
  collaborationEmptyHeadline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space[2] },
  collaborationEmptyIcon: {
    width: 34,
    height: 34,
  },
  collaborationEmptyTitle: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  collaborationEmptyDetail: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
  collaborationActions: { flexDirection: 'row', alignSelf: 'stretch', gap: Space[2], marginBottom: Space[2] },
  collaborationAction: {
    height: 44,
    borderRadius: Radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    flex: 1,
  },
  collaborationActionText: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  collaborationInviteAction: {
    height: 44,
    borderRadius: Radius.md,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  collaborationInviteActionText: { fontSize: 15, lineHeight: 21, fontWeight: '600' },

  // 家庭当下（预算 / 储蓄）
  nowBlock: { paddingVertical: Space[3], paddingHorizontal: Space[4], gap: 7 },
  nowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nowHeadL: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  nowHeadR: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  nowLabel: { fontSize: 14.5, fontWeight: '600', flexShrink: 1 },
  nowMeta: { fontSize: 12 },
  nowAmountRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  nowAmountLeft: { flexDirection: 'row', alignItems: 'baseline', flexShrink: 1 },
  nowAmountBig: { fontSize: 20, fontWeight: '700' },
  nowAmountSub: { fontSize: 13 },
  nowPct: { fontSize: 13, fontWeight: '600' },
  nowTrack: { width: '100%', height: 7, borderRadius: Radius.full, overflow: 'hidden' },
  nowFill: { height: 7, borderRadius: Radius.full },
  nowFoot: { fontSize: 12, lineHeight: 16 },

  // 单人家庭邀请引导
  invite: { alignItems: 'center', gap: Space[2], padding: Space[5] },
  inviteIcon: { width: 50, height: 50, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  inviteTitle: { fontSize: 16, fontWeight: '600', marginTop: Space[1] },
  inviteBody: { fontSize: 13, lineHeight: 19, textAlign: 'center', paddingHorizontal: Space[2] },
  invitePrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    alignSelf: 'stretch',
    height: 46,
    borderRadius: Radius.md,
    marginTop: Space[2],
  },
  invitePrimaryText: { fontSize: 16, fontWeight: '600' },
  inviteGhost: { fontSize: 13.5, fontWeight: '500', marginTop: Space[1] },

  // 快捷功能（正方形瓦片，4 列网格；超过 4 个自动换行，末行左对齐）
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: Space[2] },
  quickTile: {
    width: '23.5%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space[1],
    padding: Space[2],
    borderRadius: Radius.lg,
    overflow: 'visible',
  },
  quickTitle: { fontSize: 13, lineHeight: 16, fontWeight: '600', marginTop: 2, textAlign: 'center' },
  quickSub: { fontSize: 11, lineHeight: 14 },
  quickBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: Radius.full,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickBadgeText: { color: '#FFFFFF', fontSize: 10, lineHeight: 13, fontWeight: '700' },

  // 家庭管理
  manageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[3],
    paddingVertical: Space[3],
    paddingHorizontal: Space[4],
  },
  manageTitle: { fontSize: 16, fontWeight: '500' },
  manageSub: { fontSize: 12, lineHeight: 15, marginTop: 1 },
});
