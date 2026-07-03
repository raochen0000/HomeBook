/**
 * 家庭（Tab 3）：有家庭·户主 → 富仪表盘（hero + 本月概览 + 成员 + 快捷功能 + 家庭管理）；
 * 无家庭 → 创建/加入兜底；非户主成员 → 仪表盘 + 退出家庭。
 * 全程 RN 渲染（交互态多，沿用 mine.tsx 卡片风格）；二维码/扫码/各面板在独立 Sheet 内。
 * 配色遵循项目约定：收入=红、支出=绿（DESIGN §4.2.2 红涨绿跌）；趋势用中性灰+箭头（DESIGN §13）。
 */
import { Image } from 'expo-image';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  useCreateFamily,
  useDissolveFamily,
  useLeaveFamily,
  useMemberships,
  useMyFamily,
  useMyProfile,
  useTransactions,
  useUpdateFamilyCover,
} from '@/api';
import { ThemedText } from '@/components/themed-text';
import { Toast } from '@/components/toast';
import { Radius, Space, TabBarInset, usePalette } from '@/constants/design';
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
import { amountParts, currentPeriod, formatPercent, percentDelta, previousPeriod, signForNet } from '@/lib/format';

/** 家庭成员人数上限（暂为常量，后端未提供该配置）。 */
const MAX_MEMBERS = 8;

/** 成员头像兜底底色，按列表序号轮转。 */
const AVATAR_TINTS = ['#5AA7F0', '#46C98A', '#F5A623', '#9B6DD6'] as const;

/** 本地「年-月-日」key（用于连续记账判断，须与游标同构造）。 */
function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export default function FamilyScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { scrollRef, headerHeight, headerStyle, onHeaderLayout } = useCollapsibleHeader(insets.top + 69);
  const profileQ = useMyProfile();
  const familyQ = useMyFamily();
  const membershipsQ = useMemberships();
  const transactionsQ = useTransactions();
  const createFamilyM = useCreateFamily();
  const leaveM = useLeaveFamily();
  const dissolveM = useDissolveFamily();
  const updateCoverM = useUpdateFamilyCover();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [memberManageOpen, setMemberManageOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [savingsOpen, setSavingsOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [dissolveOpen, setDissolveOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const myId = profileQ.data?.id;
  const family = familyQ.data;
  const members = membershipsQ.data ?? [];
  const isOwner = !!family && family.owner_user_id === myId;

  // 户主点击家庭头像换图：选图 → 压缩 → 上传 → 写回 cover_url（取消则静默）。
  const onChangeCover = () => {
    if (!family || !isOwner || updateCoverM.isPending) return;
    updateCoverM.mutate(family.id, {
      onError: (e) => Alert.alert('家庭头像更新失败', (e as Error).message ?? String(e)),
    });
  };

  // ── 仪表盘统计：本月收支/环比、本月总笔数、连续记账天数、按成员的本月/今日笔数 ──
  const stats = useMemo(() => {
    const txns = transactionsQ.data ?? [];
    const period = currentPeriod();
    const prevP = previousPeriod(period);
    const todayKey = localDayKey(new Date());

    let income = 0;
    let expense = 0;
    let monthCount = 0;
    let prevIncome = 0;
    let prevExpense = 0;
    const byMemberMonth = new Map<string, number>();
    const byMemberToday = new Map<string, number>();
    const recordedDays = new Set<string>();

    for (const t of txns) {
      const occurred = new Date(t.occurred_at);
      recordedDays.add(localDayKey(occurred));
      const tp = currentPeriod(occurred);
      if (tp === period) {
        monthCount += 1;
        if (t.type === 'income') income += t.amount;
        else expense += t.amount;
        byMemberMonth.set(t.recorder_user_id, (byMemberMonth.get(t.recorder_user_id) ?? 0) + 1);
      } else if (tp === prevP) {
        if (t.type === 'income') prevIncome += t.amount;
        else prevExpense += t.amount;
      }
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

    const balance = income - expense;
    const prevBalance = prevIncome - prevExpense;
    const maxMemberMonth = Math.max(1, ...Array.from(byMemberMonth.values()));

    return {
      income,
      expense,
      balance,
      monthCount,
      streak,
      incomeTrend: percentDelta(income, prevIncome),
      expenseTrend: percentDelta(expense, prevExpense),
      balanceTrend: percentDelta(balance, prevBalance),
      byMemberMonth,
      byMemberToday,
      maxMemberMonth,
    };
  }, [transactionsQ.data]);

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
      setToast('仅户主可邀请家人');
      return;
    }
    setInviteOpen(true);
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
                style={[styles.primary, { backgroundColor: palette.accent, opacity: busy ? 0.5 : 1 }]}
              >
                <ThemedText style={[styles.primaryText, { color: palette.onAccent }]}>创建家庭</ThemedText>
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
            {/* Hero：家庭名片 + 三项统计 */}
            <View style={[styles.hero, { backgroundColor: palette.bannerTint }]}>
              <View style={styles.heroHead}>
                <View style={styles.heroTop}>
                  <Pressable onPress={onChangeCover} disabled={!isOwner || updateCoverM.isPending}>
                    <FamilyAvatar
                      url={family.cover_url}
                      uploading={updateCoverM.isPending}
                      canEdit={isOwner}
                      palette={palette}
                    />
                  </Pressable>
                  <View style={styles.flex}>
                    <ThemedText style={[styles.heroName, { color: palette.textPrimary }]}>{family.name}</ThemedText>
                    <View style={styles.heroMetaRow}>
                      <SymbolView name="person.2.fill" tintColor={palette.textSecondary} size={13} />
                      <ThemedText style={[styles.heroMeta, { color: palette.textSecondary }]}>
                        {family.member_count} 位成员
                      </ThemedText>
                      {isOwner ? (
                        <View style={[styles.roleBadge, { backgroundColor: palette.bannerTint }]}>
                          <ThemedText style={[styles.roleBadgeText, { color: palette.textPrimary }]}>户主</ThemedText>
                        </View>
                      ) : null}
                    </View>
                  </View>
                  <SymbolView name="house.fill" tintColor={palette.textTertiary} size={34} style={styles.heroHouse} />
                </View>
                <ThemedText style={[styles.heroTagline, { color: palette.textSecondary }]}>
                  一起记录生活，温暖每一天
                </ThemedText>
              </View>

              <View style={[styles.heroStats, { backgroundColor: palette.card }]}>
                <HeroStat icon="book.closed.fill" value={`${stats.monthCount}`} unit="笔" label="本月已记账" />
                <View style={[styles.heroStatDivider, { backgroundColor: palette.separator }]} />
                <HeroStat icon="flame.fill" value={`${stats.streak}`} unit="天" label="已连续记账" />
                <View style={[styles.heroStatDivider, { backgroundColor: palette.separator }]} />
                <HeroStat icon="calendar" value={createdLabel} label="创建家庭" />
              </View>
            </View>

            {/* 本月家庭概览 */}
            <View style={[styles.card, styles.overview, { backgroundColor: palette.card }]}>
              <View style={styles.overviewHead}>
                <ThemedText style={[styles.cardTitle, { color: palette.textPrimary }]}>本月家庭概览</ThemedText>
                <View style={[styles.periodPill, { backgroundColor: palette.base }]}>
                  <ThemedText style={[styles.periodText, { color: palette.textPrimary }]}>本月</ThemedText>
                  <SymbolView name="chevron.down" tintColor={palette.textSecondary} size={10} />
                </View>
              </View>
              <View style={styles.overviewRow}>
                <OverviewCol
                  label="支出"
                  cents={stats.expense}
                  color={palette.expense}
                  trend={stats.expenseTrend}
                  textSecondary={palette.textSecondary}
                />
                <View style={[styles.overviewDivider, { backgroundColor: palette.separator }]} />
                <OverviewCol
                  label="收入"
                  cents={stats.income}
                  color={palette.income}
                  trend={stats.incomeTrend}
                  textSecondary={palette.textSecondary}
                />
                <View style={[styles.overviewDivider, { backgroundColor: palette.separator }]} />
                <OverviewCol
                  label="结余"
                  cents={stats.balance}
                  sign={signForNet(stats.balance)}
                  color={palette.textPrimary}
                  trend={stats.balanceTrend}
                  textSecondary={palette.textSecondary}
                />
              </View>
            </View>

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
                  const monthN = stats.byMemberMonth.get(m.userId) ?? 0;
                  const todayN = stats.byMemberToday.get(m.userId) ?? 0;
                  const ratio = Math.min(1, monthN / stats.maxMemberMonth);
                  const tint = AVATAR_TINTS[i % AVATAR_TINTS.length];
                  return (
                    <View key={m.id}>
                      {i > 0 ? <View style={[styles.divider, { backgroundColor: palette.separator }]} /> : null}
                      <View style={styles.memberRow}>
                        {m.avatarUrl ? (
                          <Image source={m.avatarUrl} style={styles.memberAvatar} contentFit="cover" transition={120} />
                        ) : (
                          <View style={[styles.memberAvatar, styles.memberAvatarFallback, { backgroundColor: tint }]}>
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
                          <ThemedText style={[styles.memberSub, { color: palette.textSecondary }]}>
                            今天记账 {todayN} 笔
                          </ThemedText>
                        </View>
                        <View style={styles.memberRight}>
                          <ThemedText style={[styles.memberMonth, { color: palette.textSecondary }]}>
                            本月{' '}
                            <ThemedText style={{ color: palette.textPrimary, fontWeight: '600' }}>{monthN}</ThemedText>{' '}
                            笔
                          </ThemedText>
                          <View style={[styles.progressTrack, { backgroundColor: palette.separator }]}>
                            <View
                              style={[
                                styles.progressFill,
                                { backgroundColor: tint, width: `${Math.max(6, ratio * 100)}%` },
                              ]}
                            />
                          </View>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* 快捷功能 */}
            <View style={styles.section}>
              <ThemedText style={[styles.sectionTitle, { color: palette.textPrimary }]}>快捷功能</ThemedText>
              <View style={styles.quickRow}>
                <QuickTile
                  icon="chart.pie.fill"
                  title="预算管理"
                  sub="查看与设置"
                  onPress={() => setBudgetOpen(true)}
                />
                <QuickTile icon="target" title="储蓄目标" sub="共同攒钱" onPress={() => setSavingsOpen(true)} />
                <QuickTile icon="person.crop.circle.badge.plus" title="邀请家人" sub="加入家庭" onPress={onInvite} />
                <QuickTile icon="bell.fill" title="家庭通知" sub="重要提醒" onPress={() => setNotifyOpen(true)} />
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
      <MemberManageSheet visible={memberManageOpen} onClose={() => setMemberManageOpen(false)} />
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
      <SavingsSheet visible={savingsOpen} onClose={() => setSavingsOpen(false)} />
      <CategoryManageSheet visible={categoryOpen} onClose={() => setCategoryOpen(false)} />
      <FamilySettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <NotificationCenterSheet visible={notifyOpen} onClose={() => setNotifyOpen(false)} />
      <Toast visible={!!toast} text={toast ?? ''} onHide={() => setToast(null)} />
    </View>
  );
}

// ── 家庭头像：有封面显示封面图，无则「家」字底；户主可点更换（带相机角标）──
function FamilyAvatar({
  url,
  uploading,
  canEdit,
  palette,
}: {
  url: string | null;
  uploading: boolean;
  canEdit: boolean;
  palette: ReturnType<typeof usePalette>;
}) {
  return (
    <View style={styles.heroBadgeWrap}>
      {url ? (
        <Image source={url} style={styles.heroBadge} contentFit="cover" transition={120} />
      ) : (
        <View style={[styles.heroBadge, { backgroundColor: palette.accent }]}>
          <ThemedText style={[styles.heroBadgeText, { color: palette.onAccent }]}>家</ThemedText>
        </View>
      )}
      {uploading ? (
        <View style={[styles.heroBadge, styles.heroBadgeOverlay]}>
          <ActivityIndicator color="#fff" size="small" />
        </View>
      ) : null}
      {canEdit ? (
        <View style={[styles.heroBadgeCamera, { backgroundColor: palette.accent, borderColor: palette.bannerTint }]}>
          <SymbolView name="camera.fill" tintColor={palette.onAccent} size={10} />
        </View>
      ) : null}
    </View>
  );
}

// ── Hero 单项统计：图标 + 数值 + 标签 ──
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
  const palette = usePalette();
  return (
    <View style={styles.heroStat}>
      <View style={[styles.heroStatIcon, { backgroundColor: palette.bannerTint }]}>
        <SymbolView name={icon} tintColor={palette.textSecondary} size={15} />
      </View>
      <View style={styles.heroStatBody}>
        <View style={styles.heroStatValueRow}>
          <ThemedText
            style={[styles.heroStatValue, { color: palette.textPrimary }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {value}
          </ThemedText>
          {unit ? (
            <ThemedText style={[styles.heroStatUnit, { color: palette.textSecondary }]}>{unit}</ThemedText>
          ) : null}
        </View>
        <ThemedText style={[styles.heroStatLabel, { color: palette.textSecondary }]} numberOfLines={1}>
          {label}
        </ThemedText>
      </View>
    </View>
  );
}

// ── 概览单列：标签 + 两段式金额 + 较上月趋势（中性灰 + 箭头）──
function OverviewCol({
  label,
  cents,
  sign = '',
  color,
  trend,
  textSecondary,
}: {
  label: string;
  cents: number;
  sign?: '+' | '-' | '';
  color: string;
  trend: { pct: number; up: boolean } | null;
  textSecondary: string;
}) {
  const p = amountParts(cents, sign);
  return (
    <View style={styles.overviewCol}>
      <ThemedText style={[styles.overviewLabel, { color: textSecondary }]}>{label}</ThemedText>
      <View style={styles.overviewAmountRow}>
        <ThemedText style={[styles.overviewInt, { color }]}>
          {p.sign}
          {p.currency}
          {p.integer}
        </ThemedText>
        <ThemedText style={[styles.overviewDec, { color }]}>.{p.decimal}</ThemedText>
      </View>
      <View style={styles.overviewTrendRow}>
        {trend ? (
          <>
            <ThemedText style={[styles.overviewTrend, { color: textSecondary }]}>
              较上月 {formatPercent(trend.pct)}
            </ThemedText>
            <SymbolView name={trend.up ? 'arrow.up' : 'arrow.down'} tintColor={textSecondary} size={9} />
          </>
        ) : (
          <ThemedText style={[styles.overviewTrend, { color: textSecondary }]}>较上月 —</ThemedText>
        )}
      </View>
    </View>
  );
}

// ── 快捷功能瓦片 ──
function QuickTile({
  icon,
  title,
  sub,
  onPress,
}: {
  icon: SymbolViewProps['name'];
  title: string;
  sub: string;
  onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable onPress={onPress} style={[styles.quickTile, { backgroundColor: palette.card }]}>
      <SymbolView name={icon} tintColor={palette.accent} size={26} />
      <ThemedText style={[styles.quickTitle, { color: palette.textPrimary }]}>{title}</ThemedText>
      <ThemedText style={[styles.quickSub, { color: palette.textTertiary }]}>{sub}</ThemedText>
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
  const tint = danger ? palette.danger : palette.textSecondary;
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

  // Hero
  hero: { borderRadius: Radius.lg, padding: Space[4], gap: Space[4], overflow: 'hidden' },
  heroHead: { gap: Space[2] },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Space[3] },
  heroBadgeWrap: { width: 52, height: 52 },
  heroBadge: { width: 52, height: 52, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  heroBadgeText: { fontSize: 26, lineHeight: 32, fontWeight: '700' },
  heroBadgeOverlay: { position: 'absolute', top: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  heroBadgeCamera: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 20,
    height: 20,
    borderRadius: Radius.full,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroName: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', gap: Space[1], marginTop: 2 },
  heroMeta: { fontSize: 13, lineHeight: 18 },
  heroTagline: { fontSize: 13, lineHeight: 18 },
  heroHouse: { opacity: 0.5 },
  roleBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: Radius.sm },
  roleBadgeText: { fontSize: 12, lineHeight: 16, fontWeight: '600' },

  heroStats: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.md,
    paddingVertical: Space[3],
    paddingHorizontal: Space[1],
  },
  heroStat: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Space[2], paddingHorizontal: Space[1] },
  heroStatIcon: { width: 28, height: 28, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  heroStatBody: { flex: 1, gap: 1 },
  heroStatValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  heroStatValue: { flexShrink: 1, fontSize: 15, lineHeight: 19, fontWeight: '700' },
  heroStatUnit: { fontSize: 11, lineHeight: 14 },
  heroStatLabel: { fontSize: 11, lineHeight: 14 },
  heroStatDivider: { width: StyleSheet.hairlineWidth, height: 28 },

  // 通用卡片 / 区块
  card: { borderRadius: Radius.lg, overflow: 'hidden' },
  section: { gap: Space[2] },
  sectionTitle: { fontSize: 17, fontWeight: '600', paddingHorizontal: Space[1] },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: Space[4] },

  // 本月概览
  overview: { padding: Space[4], gap: Space[3] },
  overviewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  periodPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[1],
    paddingHorizontal: Space[3],
    paddingVertical: Space[1],
    borderRadius: Radius.full,
  },
  periodText: { fontSize: 13, lineHeight: 16 },
  overviewRow: { flexDirection: 'row', alignItems: 'flex-start' },
  overviewCol: { flex: 1, gap: 4 },
  overviewDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginHorizontal: Space[2] },
  overviewLabel: { fontSize: 13, lineHeight: 16 },
  overviewAmountRow: { flexDirection: 'row', alignItems: 'baseline' },
  overviewInt: { fontSize: 20, fontWeight: '700' },
  overviewDec: { fontSize: 13, fontWeight: '600' },
  overviewTrendRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  overviewTrend: { fontSize: 11, lineHeight: 14 },

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
  memberSub: { fontSize: 13, lineHeight: 16, marginTop: 2 },
  memberRight: { alignItems: 'flex-end', gap: 4, width: 96 },
  memberMonth: { fontSize: 13, lineHeight: 16 },
  progressTrack: { width: '100%', height: 4, borderRadius: Radius.full, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: Radius.full },

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
  },
  quickTitle: { fontSize: 13, lineHeight: 17, fontWeight: '600', marginTop: 2 },
  quickSub: { fontSize: 11, lineHeight: 14 },

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
