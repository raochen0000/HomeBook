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
  useCreateFamily,
  useDissolveFamily,
  useLeaveFamily,
  useMemberships,
  useMyFamily,
  useMyProfile,
  useSavingsGoals,
  useTransactions,
  useUnreadNotifications,
  type SavingsGoal,
} from '@/api';
import { ThemedText } from '@/components/themed-text';
import { toast } from '@/components/toast';
import { Radius, Space, TabBarInset, useAvatarTints, usePalette } from '@/constants/design';
import { BudgetSheet } from '@/features/budget/budget-sheet';
import { CategoryManageSheet } from '@/features/category/manage-sheet';
import { DangerConfirmSheet } from '@/features/family/danger-confirm-sheet';
import { InviteSheet } from '@/features/family/invite-sheet';
import { MemberManageSheet } from '@/features/family/member-manage-sheet';
import { ScanSheet } from '@/features/family/scan-sheet';
import { FamilySettingsSheet } from '@/features/family/settings-sheet';
import { NotificationCenterSheet } from '@/features/notifications/center-sheet';
import { SavingsSheet } from '@/features/savings/savings-sheet';
import { HeaderSearchButton } from '@/features/search/search-provider';
import { useCollapsibleHeader } from '@/features/shared/use-collapsible-header';
import { budgetLevel, daysToMonthEnd, expenseUsedInPeriod } from '@/lib/budget';
import { currentPeriod, formatAmount } from '@/lib/format';

/** 家庭成员人数上限（暂为常量，后端未提供该配置）。 */
const MAX_MEMBERS = 8;

/** 本地「年-月-日」key（用于连续记账判断，须与游标同构造）。 */
function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 瓦片角标用的紧凑金额：分 → 「¥1,280」（取整到元，带千分位）。 */
function formatCny(cents: number): string {
  return `¥${Math.round(cents / 100).toLocaleString('en-US')}`;
}

export default function FamilyScreen() {
  const palette = usePalette();
  const avatarTints = useAvatarTints();
  const insets = useSafeAreaInsets();
  const { scrollRef, headerHeight, headerStyle, onHeaderLayout } = useCollapsibleHeader(insets.top + 69);
  const period = currentPeriod();
  const profileQ = useMyProfile();
  const familyQ = useMyFamily();
  const membershipsQ = useMemberships();
  const transactionsQ = useTransactions();
  const budgetQ = useBudget(period);
  const savingsQ = useSavingsGoals();
  const unreadQ = useUnreadNotifications();
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
  const [dissolveOpen, setDissolveOpen] = useState(false);
  // 成员管理页请求打开邀请页的待办标记（先关成员管理，其 dismiss 后再开邀请页）。
  const pendingInviteRef = useRef(false);

  const myId = profileQ.data?.id;
  const family = familyQ.data;
  const members = membershipsQ.data ?? [];
  const isOwner = !!family && family.owner_user_id === myId;

  // 家庭头像（avatar_url）与封面（cover_url）的更换入口在「家庭设置」，本页只读展示。

  // ── 家庭活跃度：本月总笔数、连续记账天数、各成员今日笔数（聚合/对比类留给报表）──
  const stats = useMemo(() => {
    const txns = transactionsQ.data ?? [];
    const todayKey = localDayKey(new Date());

    let monthCount = 0;
    const byMemberToday = new Map<string, number>();
    const recordedDays = new Set<string>();

    for (const t of txns) {
      const occurred = new Date(t.occurred_at);
      recordedDays.add(localDayKey(occurred));
      if (currentPeriod(occurred) === period) monthCount += 1;
      if (localDayKey(occurred) === todayKey) {
        byMemberToday.set(t.recorder_user_id, (byMemberToday.get(t.recorder_user_id) ?? 0) + 1);
      }
    }

    // 连续记账：从今天起向前数有账的天数；今天未记则从昨天起算（当日尚未断签）。
    let streak = 0;
    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    if (!recordedDays.has(localDayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (recordedDays.has(localDayKey(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    return { monthCount, streak, byMemberToday };
  }, [transactionsQ.data, period]);

  // ── 预算执行（口径同预算页：仅日常支出，排除储蓄流水）──
  const budgetTotal = budgetQ.data?.budget?.total_amount ?? null;
  const budgetUsed = useMemo(
    () => expenseUsedInPeriod(transactionsQ.data ?? [], period).total,
    [transactionsQ.data, period],
  );
  const budgetRemaining = budgetTotal == null ? 0 : budgetTotal - budgetUsed;
  const budgetPct = budgetTotal && budgetTotal > 0 ? Math.round((budgetUsed / budgetTotal) * 100) : 0;
  const budgetSub =
    budgetTotal == null ? '未设置' : budgetRemaining >= 0 ? `剩 ${formatCny(budgetRemaining)}` : '已超支';

  // ── 储蓄目标：数量角标 + 「家庭当下」精选目标（截止日最近的进行中目标）──
  const goals = useMemo(() => savingsQ.data ?? [], [savingsQ.data]);
  const goalCount = goals.length;
  const savingsSub = goalCount > 0 ? `${goalCount} 个目标` : '共同攒钱';
  const featuredGoal = useMemo<SavingsGoal | null>(() => {
    // 只在未达成目标里选：优先有截止日且最近的；其余按原顺序（最新创建在前）兜底。已达成的不展示。
    const active = goals.filter((g) => g.saved_amount < g.target_amount);
    if (active.length === 0) return null;
    const withDeadline = active.filter((g) => g.deadline).sort((a, b) => a.deadline!.localeCompare(b.deadline!));
    return withDeadline[0] ?? active[0];
  }, [goals]);
  const activeGoalCount = useMemo(() => goals.filter((g) => g.saved_amount < g.target_amount).length, [goals]);

  const unreadCount = unreadQ.data?.length ?? 0;
  // 单人家庭：隐藏成员列表与「家庭当下」，聚焦邀请转化（PRD F1 关键态）。
  const singlePerson = (family?.member_count ?? members.length) <= 1;

  const onCreate = () => {
    Alert.prompt(
      '创建家庭',
      '给你的家庭起个名字',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '创建',
          onPress: async (name?: string) => {
            try {
              await createFamilyM.mutateAsync({ name: name?.trim() || '我的家' });
            } catch (e) {
              Alert.alert('创建失败', (e as Error).message ?? String(e));
            }
          },
        },
      ],
      'plain-text',
      '我的家',
    );
  };

  const onLeave = () => {
    Alert.alert('退出家庭', '退出后你将看不到这个家的账本。确定退出吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出',
        style: 'destructive',
        onPress: async () => {
          try {
            await leaveM.mutateAsync();
          } catch (e) {
            Alert.alert('退出失败', (e as Error).message ?? String(e));
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
      toast.warning('仅户主可邀请家人');
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
            <ThemedText style={{ color: palette.textSecondary }}>你还没有加入家庭</ThemedText>
            <View style={styles.emptyActions}>
              <Pressable
                disabled={busy}
                onPress={onCreate}
                style={[styles.primary, { backgroundColor: palette.ink, opacity: busy ? 0.5 : 1 }]}
              >
                <ThemedText style={[styles.primaryText, { color: palette.onInk }]}>创建家庭</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => setScanOpen(true)}
                style={[styles.secondary, { borderColor: palette.separator }]}
              >
                <ThemedText style={{ color: palette.textPrimary, fontSize: 16 }}>扫码加入家庭</ThemedText>
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
              <SymbolView
                name="house.fill"
                tintColor="rgba(255,255,255,0.14)"
                size={96}
                style={styles.heroHouse}
                pointerEvents="none"
              />

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
                      <ThemedText style={styles.heroBadgeText}>家</ThemedText>
                    </View>
                  )}
                  <View style={styles.flex}>
                    <ThemedText style={styles.heroName}>{family.name}</ThemedText>
                    <View style={styles.heroMetaRow}>
                      <SymbolView name="person.2.fill" tintColor="rgba(255,255,255,0.85)" size={13} />
                      <ThemedText style={styles.heroMeta}>{family.member_count} 位成员</ThemedText>
                      {isOwner ? (
                        <View style={styles.heroRoleBadge}>
                          <ThemedText style={styles.heroRoleBadgeText}>户主</ThemedText>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </View>
                <ThemedText style={styles.heroTagline}>一起记录生活，温暖每一天</ThemedText>
              </View>

              <BlurView intensity={24} tint="dark" style={styles.heroStats}>
                <HeroStat icon="book.closed.fill" value={`${stats.monthCount}`} unit="笔" label="本月已记账" />
                <View style={styles.heroStatDivider} />
                <HeroStat icon="flame.fill" value={`${stats.streak}`} unit="天" label="已连续记账" />
                <View style={styles.heroStatDivider} />
                <HeroStat icon="calendar" value={createdLabel} label="创建家庭" />
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

                {/* 家庭成员 */}
                <View style={styles.section}>
                  <ThemedText style={[styles.sectionTitle, { color: palette.textPrimary }]}>
                    家庭成员{' '}
                    <ThemedText style={{ color: palette.textTertiary, fontSize: 15 }}>
                      （{members.length}/{MAX_MEMBERS}）
                    </ThemedText>
                  </ThemedText>
                  <View style={[styles.card, { backgroundColor: palette.card }]}>
                    {members.map((m, i) => {
                      const todayN = stats.byMemberToday.get(m.userId) ?? 0;
                      const tint = avatarTints[i % avatarTints.length];
                      return (
                        <View key={m.id}>
                          {i > 0 ? <View style={[styles.divider, { backgroundColor: palette.separator }]} /> : null}
                          <View style={styles.memberRow}>
                            {m.avatarUrl ? (
                              <Image
                                source={m.avatarUrl}
                                style={styles.memberAvatar}
                                contentFit="cover"
                                transition={120}
                              />
                            ) : (
                              <View
                                style={[styles.memberAvatar, styles.memberAvatarFallback, { backgroundColor: tint }]}
                              >
                                <SymbolView name="person.fill" tintColor="#FFFFFF" size={20} />
                              </View>
                            )}
                            <View style={styles.flex}>
                              <View style={styles.memberNameRow}>
                                <ThemedText style={[styles.memberName, { color: palette.textPrimary }]}>
                                  {m.nickname}
                                  {m.userId === myId ? '（我）' : ''}
                                </ThemedText>
                                <View style={[styles.roleBadge, { backgroundColor: palette.bannerTint }]}>
                                  <ThemedText
                                    style={[
                                      styles.roleBadgeText,
                                      { color: m.role === 'owner' ? palette.textPrimary : palette.textSecondary },
                                    ]}
                                  >
                                    {m.role === 'owner' ? '户主' : '成员'}
                                  </ThemedText>
                                </View>
                              </View>
                              <View style={styles.memberActivity}>
                                <SymbolView
                                  name={todayN > 0 ? 'checkmark.circle.fill' : 'circle'}
                                  tintColor={todayN > 0 ? palette.accent : palette.textTertiary}
                                  size={12}
                                />
                                <ThemedText style={[styles.memberSub, { color: palette.textSecondary }]}>
                                  {todayN > 0 ? `今日已记 ${todayN} 笔` : '今日未记账'}
                                </ThemedText>
                              </View>
                            </View>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </View>
              </>
            )}

            {/* 快捷功能 */}
            <View style={styles.section}>
              <ThemedText style={[styles.sectionTitle, { color: palette.textPrimary }]}>快捷功能</ThemedText>
              <View style={styles.quickRow}>
                <QuickTile icon="chart.pie.fill" title="预算管理" sub={budgetSub} onPress={() => setBudgetOpen(true)} />
                <QuickTile icon="target" title="储蓄目标" sub={savingsSub} onPress={openSavingsList} />
                <QuickTile icon="person.crop.circle.badge.plus" title="邀请家人" sub="加入家庭" onPress={onInvite} />
                <QuickTile
                  icon="bell.fill"
                  title="家庭通知"
                  sub={unreadCount > 0 ? `${unreadCount} 条未读` : '重要提醒'}
                  badge={unreadCount}
                  onPress={() => setNotifyOpen(true)}
                />
                <QuickTile
                  icon="square.grid.2x2.fill"
                  title="分类管理"
                  sub="增改分类"
                  onPress={() => setCategoryOpen(true)}
                />
              </View>
            </View>

            {/* 家庭管理 */}
            <View style={styles.section}>
              <ThemedText style={[styles.sectionTitle, { color: palette.textPrimary }]}>家庭管理</ThemedText>
              <View style={[styles.card, { backgroundColor: palette.card }]}>
                {isOwner ? (
                  <>
                    <ManageRow
                      icon="person.2"
                      title="成员管理"
                      sub="查看成员、转让户主、移除成员"
                      onPress={() => setMemberManageOpen(true)}
                    />
                    <View style={[styles.divider, { backgroundColor: palette.separator }]} />
                    <ManageRow
                      icon="gearshape"
                      title="家庭设置"
                      sub="家庭名称、封面"
                      onPress={() => setSettingsOpen(true)}
                    />
                    <View style={[styles.divider, { backgroundColor: palette.separator }]} />
                    <ManageRow
                      icon="trash"
                      title="解散家庭"
                      sub="解散后所有数据将永久删除，无法恢复"
                      onPress={onDissolve}
                      danger
                    />
                  </>
                ) : (
                  <ManageRow
                    icon="rectangle.portrait.and.arrow.right"
                    title="退出家庭"
                    sub="退出后将无法访问本家庭账本"
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
            <ThemedText style={[styles.title, { color: palette.textPrimary }]}>家庭</ThemedText>
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
        title="解散家庭"
        message="解散后全部成员将被移出，所有记账数据将被永久删除，不可恢复。"
        matchLabel={family ? `输入家庭名「${family.name}」以确认` : '输入家庭名以确认'}
        matchValue={family?.name ?? ''}
        slideLabel="滑动以确认解散"
        onConfirm={async () => {
          await dissolveM.mutateAsync();
        }}
        onClose={() => setDissolveOpen(false)}
      />
      <BudgetSheet visible={budgetOpen} onClose={() => setBudgetOpen(false)} />
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
  const budgetColor = level === 'danger' ? palette.danger : level === 'warning' ? palette.warning : palette.accent;
  const goalPct =
    goal && goal.target_amount > 0 ? Math.min(100, Math.round((goal.saved_amount / goal.target_amount) * 100)) : 0;
  const goalRemain = goal ? Math.max(0, goal.target_amount - goal.saved_amount) : 0;

  return (
    <View style={styles.section}>
      <ThemedText style={[styles.sectionTitle, { color: palette.textPrimary }]}>家庭当下</ThemedText>
      <View style={[styles.card, { backgroundColor: palette.card }]}>
        {/* 预算行 */}
        <Pressable style={styles.nowBlock} onPress={onBudget}>
          <View style={styles.nowHead}>
            <View style={styles.nowHeadL}>
              <SymbolView name="chart.pie.fill" tintColor={palette.accent} size={14} />
              <ThemedText style={[styles.nowLabel, { color: palette.textPrimary }]}>本月预算</ThemedText>
            </View>
            <View style={styles.nowHeadR}>
              {budgetSet ? (
                <ThemedText style={[styles.nowMeta, { color: palette.textTertiary }]}>距月底 {daysLeft} 天</ThemedText>
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
                  ? `剩 ${formatAmount(budgetRemaining)} 可用`
                  : `已超支 ${formatAmount(-budgetRemaining)}`}
              </ThemedText>
            </>
          ) : (
            <ThemedText style={[styles.nowFoot, { color: palette.textSecondary }]}>
              {isOwner ? '点此设置本月预算，全家一起看执行' : '尚未设置预算，可请户主设置'}
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
              <View style={styles.nowHeadR}>
                <ThemedText style={[styles.nowPct, { color: palette.accent }]}>{goalPct}%</ThemedText>
                <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={13} />
              </View>
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
            </View>
            <View style={[styles.nowTrack, { backgroundColor: palette.separator }]}>
              <View style={[styles.nowFill, { backgroundColor: palette.accent, width: `${goalPct}%` }]} />
            </View>
            <ThemedText style={[styles.nowFoot, { color: palette.textSecondary }]}>
              {goalRemain > 0 ? `距达成还差 ${formatAmount(goalRemain)}` : '已达成目标'}
              {activeGoalCount > 1 ? ` · 另有 ${activeGoalCount - 1} 个目标` : ''}
            </ThemedText>
          </Pressable>
        ) : (
          <Pressable style={styles.nowBlock} onPress={onSavingsList}>
            <View style={styles.nowHead}>
              <View style={styles.nowHeadL}>
                <SymbolView name="target" tintColor={palette.accent} size={14} />
                <ThemedText style={[styles.nowLabel, { color: palette.textPrimary }]}>储蓄目标</ThemedText>
              </View>
              <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={13} />
            </View>
            <ThemedText style={[styles.nowFoot, { color: palette.textSecondary }]}>和家人一起定个攒钱目标</ThemedText>
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
  return (
    <View style={[styles.card, styles.invite, { backgroundColor: palette.bannerTint }]}>
      <View style={[styles.inviteIcon, { backgroundColor: palette.card }]}>
        <SymbolView name="person.2.fill" tintColor={palette.accent} size={26} />
      </View>
      <ThemedText style={[styles.inviteTitle, { color: palette.textPrimary }]}>还只有你一个人</ThemedText>
      <ThemedText style={[styles.inviteBody, { color: palette.textSecondary }]}>
        邀请家人加入，一起记录每天的收支，账本自动共享给全家。
      </ThemedText>
      <Pressable style={[styles.invitePrimary, { backgroundColor: palette.ink }]} onPress={onGenerate}>
        <SymbolView name="person.crop.circle.badge.plus" tintColor={palette.onInk} size={18} />
        <ThemedText style={[styles.invitePrimaryText, { color: palette.onInk }]}>生成邀请码</ThemedText>
      </Pressable>
      <Pressable onPress={onScan}>
        <ThemedText style={[styles.inviteGhost, { color: palette.accent }]}>或 · 扫码加入他人家庭</ThemedText>
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
      <ThemedText style={[styles.quickTitle, { color: palette.textPrimary }]}>{title}</ThemedText>
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

  // 成员
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[3],
    paddingVertical: Space[3],
    paddingHorizontal: Space[4],
  },
  memberAvatar: { width: 44, height: 44, borderRadius: Radius.full },
  memberAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: Space[2] },
  memberName: { fontSize: 16, fontWeight: '600' },
  roleBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: Radius.sm },
  roleBadgeText: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  memberActivity: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  memberSub: { fontSize: 13, lineHeight: 16 },

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
  quickTitle: { fontSize: 13, lineHeight: 17, fontWeight: '600', marginTop: 2 },
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
