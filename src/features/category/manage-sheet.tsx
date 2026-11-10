/**
 * 分类管理（流程 11）：查看系统/自定义分类，新增、编辑、停用自定义分类，按家庭隐藏系统分类。
 * - 所有成员可新增/编辑；仅户主可停用自定义分类、隐藏/显示系统分类（UI 校验，RLS 允许家庭成员写）。
 * - 系统预设分类全局只读，但家庭可隐藏不用的系统分类（family_hidden_categories 覆盖表，MVP §2.4）。
 *   「其他支出 / 其他收入」作兜底不可隐藏；「储蓄·*」走专门入口、从列表过滤。
 * 单 Modal 内以 view 状态在「列表 / 编辑器」间切换，避免嵌套 Modal。
 */
import { Host, Picker, Text as UIText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Fragment, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  fetchCategoryMoveImpact,
  useArchiveCategory,
  useBudget,
  useBudgetProgress,
  useCategories,
  useCategoryLayout,
  useCreateCategory,
  useEnableCategoryGroup,
  useHiddenCategoryIds,
  useHideSystemCategory,
  useMyFamily,
  useMyProfile,
  useMoveCategory,
  useRecurringRules,
  useUnhideSystemCategory,
  useUpdateCategory,
  type Category,
  type CategoryType,
} from '@/api';
import { PageSheet } from '@/components/page-sheet';
import { SHEET_CONTENT_TOP_PADDING, SHEET_HEADER_HEIGHT, SheetHeader } from '@/components/sheet-header';
import { Radius, Space, useCategoryColors, usePalette, useSheetPalette } from '@/constants/design';
import { isLikelyNetworkError } from '@/features/record/save-attempt';
import { alertOk, displayCategoryName, t, useLocalePreference } from '@/i18n';
import { automaticCategoryColorKey, categoryColorKey, customCategoryColorKey } from '@/lib/category-style';
import { currentPeriodInTimeZone, formatAmount } from '@/lib/format';

type SymbolName = Extract<SymbolViewProps['name'], string>;
type IconGroup = { title: string; icons: readonly SymbolName[] };

/** 分类图标库（SF Symbols），收入/支出共用同一套分组交互。 */
const CATEGORY_ICON_GROUPS: readonly IconGroup[] = [
  {
    title: 'category.gFun',
    icons: [
      'gamecontroller.fill',
      'film.fill',
      'music.note',
      'tv.fill',
      'theatermasks.fill',
      'party.popper.fill',
      'ticket.fill',
      'dice.fill',
      'mic.fill',
      'headphones',
      'camera.fill',
      'photo.on.rectangle',
    ],
  },
  {
    title: 'category.gFood',
    icons: [
      'fork.knife',
      'cup.and.saucer.fill',
      'mug.fill',
      'wineglass.fill',
      'takeoutbag.and.cup.and.straw.fill',
      'birthday.cake.fill',
      'popcorn.fill',
      'frying.pan.fill',
      'carrot.fill',
      'fish.fill',
      'leaf.fill',
      'waterbottle.fill',
    ],
  },
  {
    title: 'category.gHealth',
    icons: [
      'cross.case.fill',
      'pills.fill',
      'stethoscope',
      'mouth.fill',
      'cross.vial.fill',
      'bandage.fill',
      'syringe.fill',
      'heart.text.square.fill',
      'facemask.fill',
      'medical.thermometer.fill',
      'waveform.path.ecg',
      'heart.fill',
    ],
  },
  {
    title: 'category.gLearn',
    icons: [
      'book.fill',
      'books.vertical.fill',
      'graduationcap.fill',
      'pencil.and.ruler.fill',
      'pencil',
      'highlighter',
      'backpack.fill',
      'text.book.closed.fill',
      'character.book.closed.fill',
      'brain.head.profile',
      'laptopcomputer',
      'bookmark.fill',
    ],
  },
  {
    title: 'category.gTransit',
    icons: [
      'car.fill',
      'bus.fill',
      'tram.fill',
      'fuelpump.fill',
      'airplane',
      'suitcase.fill',
      'bicycle',
      'bolt.car.fill',
      'figure.walk',
      'ferry.fill',
      'parkingsign.circle.fill',
      'map.fill',
    ],
  },
  {
    title: 'category.gShop',
    icons: [
      'cart.fill',
      'bag.fill',
      'handbag.fill',
      'basket.fill',
      'gift.fill',
      'giftcard.fill',
      'tag.fill',
      'creditcard.fill',
      'shippingbox.fill',
      'storefront.fill',
      'barcode.viewfinder',
      'wallet.pass.fill',
    ],
  },
  {
    title: 'category.gLife',
    icons: [
      'phone.fill',
      'simcard.fill',
      'wifi',
      'bolt.fill',
      'flame.fill',
      'drop.fill',
      'key.fill',
      'umbrella.fill',
      'calendar',
      'clock.fill',
      'doc.text.fill',
      'bell.fill',
    ],
  },
  {
    title: 'category.gPersonal',
    icons: [
      'person.fill',
      'crown.fill',
      'star.fill',
      'tshirt.fill',
      'comb.fill',
      'teddybear.fill',
      'stroller.fill',
      'scissors',
      'eyeglasses',
      'shoeprints.fill',
      'sparkles',
      'hands.sparkles.fill',
    ],
  },
  {
    title: 'category.gHome',
    icons: [
      'house.fill',
      'bed.double.fill',
      'sofa.fill',
      'lightbulb.fill',
      'wrench.and.screwdriver.fill',
      'shower.fill',
      'washer.fill',
      'refrigerator.fill',
      'dishwasher.fill',
      'oven.fill',
      'microwave.fill',
      'bathtub.fill',
    ],
  },
  {
    title: 'category.gPet',
    icons: [
      'pawprint.fill',
      'pawprint.circle.fill',
      'cat.fill',
      'dog.fill',
      'fish.fill',
      'bird.fill',
      'tortoise.fill',
      'hare.fill',
      'ant.fill',
      'ladybug.fill',
      'cross.case.fill',
      'scissors',
    ],
  },
  {
    title: 'category.gFit',
    icons: [
      'figure.run',
      'dumbbell.fill',
      'figure.walk',
      'figure.strengthtraining.traditional',
      'figure.yoga',
      'figure.pool.swim',
      'figure.outdoor.cycle',
      'sportscourt.fill',
      'tennis.racket',
      'soccerball',
      'basketball.fill',
      'figure.hiking',
    ],
  },
  {
    title: 'category.gWork',
    icons: [
      'briefcase.fill',
      'folder.fill',
      'doc.text.fill',
      'paperclip',
      'printer.fill',
      'scanner.fill',
      'desktopcomputer',
      'keyboard.fill',
      'calendar.badge.clock',
      'chart.bar.fill',
      'laptopcomputer',
      'envelope.fill',
    ],
  },
  {
    title: 'category.gMoney',
    icons: [
      'dollarsign.circle.fill',
      'banknote.fill',
      'creditcard.fill',
      'chart.line.uptrend.xyaxis',
      'chart.pie.fill',
      'percent',
      'building.columns.fill',
      'wallet.pass.fill',
      'yensign.circle.fill',
      'bitcoinsign.circle.fill',
      'arrow.up.right.circle.fill',
      'arrow.down.right.circle.fill',
    ],
  },
  {
    title: 'category.gOther',
    icons: [
      'ellipsis.circle.fill',
      'questionmark.circle.fill',
      'circle.grid.3x3.fill',
      'square.grid.2x2.fill',
      'archivebox.fill',
      'exclamationmark.circle.fill',
      'wand.and.stars',
      'plus.circle.fill',
      'minus.circle.fill',
      'circle.fill',
      'globe',
      'building.2.fill',
    ],
  },
];

const DEFAULT_EXPENSE_ICON = 'gamecontroller.fill';
const DEFAULT_INCOME_ICON = 'dollarsign.circle.fill';

type ViewState =
  | { mode: 'list' }
  | { mode: 'new'; type: CategoryType; parentId?: string; isGroup?: boolean }
  | { mode: 'edit'; category: Category }
  | { mode: 'move'; category: Category };

/** 兜底分类不可隐藏，保证记账时每种类型至少有一个可选分类。 */
const PROTECTED_SYSTEM_NAMES = new Set(['其他支出', '其他收入']);

export function CategoryManageSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <PageSheet visible={visible} onClose={onClose}>
      <Body />
    </PageSheet>
  );
}

function Body() {
  const palette = useSheetPalette();
  useLocalePreference();
  const [view, setView] = useState<ViewState>({ mode: 'list' });

  // 单壳内切换「列表 / 编辑器」，不再嵌套第二层 pageSheet（DESIGN §9.9：pageSheet 不叠加）。
  if (view.mode === 'move') return <MoveCategory category={view.category} onBack={() => setView({ mode: 'list' })} />;
  if (view.mode !== 'list') {
    return <Editor view={view} onBack={() => setView({ mode: 'list' })} />;
  }
  return <List palette={palette} setView={setView} />;
}

// ── 列表 ─────────────────────────────────────────────────────────────────────
function List({ palette, setView }: { palette: ReturnType<typeof usePalette>; setView: (v: ViewState) => void }) {
  const catColors = useCategoryColors();
  useLocalePreference();
  const profileQ = useMyProfile();
  const familyQ = useMyFamily();
  const period = currentPeriodInTimeZone(familyQ.data?.timezone);
  const budgetQ = useBudget(period);
  const progressQ = useBudgetProgress(period);
  const recurringQ = useRecurringRules();
  const catsQ = useCategories();
  const layoutQ = useCategoryLayout();
  const hiddenQ = useHiddenCategoryIds();
  const archiveM = useArchiveCategory();
  const hideM = useHideSystemCategory();
  const unhideM = useUnhideSystemCategory();
  const enableGroupM = useEnableCategoryGroup();

  const isOwner = !!familyQ.data && familyQ.data.owner_user_id === profileQ.data?.id;
  const familyId = familyQ.data?.id;
  const hidden = hiddenQ.data ?? new Set<string>();
  const [type, setType] = useState<CategoryType>('expense');
  const layoutById = useMemo(
    () => new Map((layoutQ.data ?? []).map((item) => [item.category_id, item])),
    [layoutQ.data],
  );

  const { system, custom } = useMemo(() => {
    const list = (catsQ.data ?? []).filter(
      (c) => c.type === type && !c.name.startsWith('储蓄·') && !layoutById.get(c.id)?.parent_category_id,
    );
    return {
      system: list.filter((c) => c.is_system),
      custom: list.filter((c) => !c.is_system),
    };
  }, [catsQ.data, type, layoutById]);

  const canShowImpact = () => {
    if (budgetQ.isSuccess && recurringQ.isSuccess && layoutQ.isSuccess) return true;
    Alert.alert(t('account.saveFailed'), t('category.loadBeforeChange'), [
      {
        text: t('common.retry'),
        onPress: () => {
          void layoutQ.refetch();
          void budgetQ.refetch();
          void recurringQ.refetch();
        },
      },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
    return false;
  };

  const impactMessage = (category: Category, action: 'archive' | 'hide') => {
    const children = (layoutQ.data ?? []).filter((item) => item.parent_category_id === category.id);
    const visibleChildren = children.filter((item) =>
      (catsQ.data ?? []).some((child) => child.id === item.category_id && !hidden.has(child.id)),
    );
    const affectedIds = new Set([category.id, ...children.map((item) => item.category_id)]);
    const rules = (recurringQ.data ?? []).filter((rule) => rule.enabled && affectedIds.has(rule.category_id));
    const budget = budgetQ.data?.categories.find((item) => item.category_id === category.id);
    const messages: string[] = [];
    if (layoutById.get(category.id)?.is_group)
      messages.push(t('category.impactChildren', { count: visibleChildren.length }));
    if (budget)
      messages.push(
        t(action === 'archive' ? 'category.impactBudgetArchived' : 'category.impactBudgetHidden', {
          amount: formatAmount(budget.amount, ''),
        }),
      );
    if (rules.length > 0) messages.push(t('category.impactRecurring', { count: rules.length }));
    return messages.length ? `\n${messages.join('\n')}` : '';
  };

  const addChild = (c: Category) => {
    if (!familyId) return;
    const openEditor = () => setView({ mode: 'new', type, parentId: c.id });
    if (layoutById.get(c.id)?.is_group) {
      openEditor();
      return;
    }
    if (!layoutQ.isSuccess || !budgetQ.isSuccess || !progressQ.isSuccess) {
      Alert.alert(t('account.saveFailed'), t('category.loadBeforeChange'), [
        {
          text: t('common.retry'),
          onPress: () => {
            void layoutQ.refetch();
            void budgetQ.refetch();
            void progressQ.refetch();
          },
        },
        { text: t('common.cancel'), style: 'cancel' },
      ]);
      return;
    }
    const budget = budgetQ.data?.categories.find((item) => item.category_id === c.id);
    if (budget && !isOwner) {
      Alert.alert(t('category.ownerOnlyDisable'), t('category.moveOwnerBudget'), alertOk());
      return;
    }
    const budgetInfo = budget
      ? `\n${t('category.groupBudgetInfo', { budget: formatAmount(budget.amount, ''), used: formatAmount(progressQ.data?.byCategory.get(c.id) ?? 0, '') })}`
      : '';
    Alert.alert(
      t('category.makeGroupTitle', { name: displayCategoryName(c.name, c.is_system) }),
      `${t('category.makeGroupBody')}${budgetInfo}`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('category.makeGroup'),
          onPress: async () => {
            try {
              await enableGroupM.mutateAsync({ familyId, categoryId: c.id });
              openEditor();
            } catch (error) {
              Alert.alert(t('account.saveFailed'), error instanceof Error ? error.message : String(error), alertOk());
            }
          },
        },
      ],
    );
  };

  const onArchive = (c: Category) => {
    if (!isOwner) {
      Alert.alert(t('category.ownerOnlyDisable'), t('category.ownerOnlyDisableBody'), alertOk());
      return;
    }
    if (!canShowImpact()) return;
    Alert.alert(
      t('category.disableTitle'),
      `${t('category.disableBody', { name: displayCategoryName(c.name, c.is_system) })}${impactMessage(c, 'archive')}`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('category.disable'),
          style: 'destructive',
          onPress: async () => {
            try {
              await archiveM.mutateAsync(c.id);
            } catch (e) {
              Alert.alert(t('category.disableFailed'), (e as Error).message ?? String(e), alertOk());
            }
          },
        },
      ],
    );
  };

  const onToggleHide = (c: Category) => {
    if (!isOwner) {
      Alert.alert(t('category.ownerOnlyHide'), t('category.ownerOnlyHideBody'), alertOk());
      return;
    }
    if (!familyId) return;
    const isHidden = hidden.has(c.id);
    const run = async () => {
      try {
        if (isHidden) await unhideM.mutateAsync({ familyId, categoryId: c.id });
        else await hideM.mutateAsync({ familyId, categoryId: c.id });
      } catch (e) {
        Alert.alert(
          isHidden ? t('category.showFailed') : t('category.hideFailed'),
          (e as Error).message ?? String(e),
          alertOk(),
        );
      }
    };
    if (isHidden) {
      void run(); // 恢复显示无需确认
      return;
    }
    if (!canShowImpact()) return;
    Alert.alert(
      t('category.hideTitle'),
      `${t('category.hideBody', { name: displayCategoryName(c.name, c.is_system) })}${impactMessage(c, 'hide')}`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.hide'), style: 'destructive', onPress: () => void run() },
      ],
    );
  };

  const renderRow = (c: Category, editable: boolean, child = false, emptyGroup = false) => {
    const color = catColors[categoryColorKey(c.name, type, c.color_key)];
    const isHidden = c.is_system && hidden.has(c.id);
    const isProtected = c.is_system && PROTECTED_SYSTEM_NAMES.has(c.name);
    return (
      <View key={c.id} style={styles.row}>
        <Pressable
          style={styles.categoryMain}
          disabled={!editable}
          onPress={editable ? () => setView({ mode: 'edit', category: c }) : undefined}
        >
          <View style={[styles.iconDot, { backgroundColor: color, opacity: isHidden ? 0.4 : 1 }]}>
            <SymbolView name={(c.icon ?? 'circle.fill') as SymbolViewProps['name']} tintColor="#FFFFFF" size={17} />
          </View>
          <Text style={[styles.rowName, { color: palette.textPrimary, opacity: isHidden ? 0.4 : 1, flexShrink: 1 }]}>
            {displayCategoryName(c.name, c.is_system)}
          </Text>
          {emptyGroup ? (
            <Text style={{ color: palette.textSecondary, fontSize: 13, flexShrink: 1 }}>
              {t('category.groupEmpty')}
            </Text>
          ) : null}
        </Pressable>
        {!child && !isHidden ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('category.addChild')}
            hitSlop={10}
            onPress={() => addChild(c)}
            style={styles.archiveBtn}
          >
            <SymbolView name="plus" tintColor={palette.accent} size={18} />
          </Pressable>
        ) : null}
        {!layoutById.get(c.id)?.is_group && !isHidden && !isProtected ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('category.move')}
            hitSlop={10}
            onPress={() => setView({ mode: 'move', category: c })}
            style={styles.archiveBtn}
          >
            <SymbolView name="arrow.right.arrow.left" tintColor={palette.textSecondary} size={16} />
          </Pressable>
        ) : null}
        {c.is_system ? (
          isProtected ? (
            <Text style={[styles.sysTag, { color: palette.textTertiary }]}>{t('category.system')}</Text>
          ) : (
            <>
              {isHidden ? (
                <Text style={[styles.sysTag, { color: palette.textTertiary }]}>{t('category.hidden')}</Text>
              ) : null}
              <Pressable hitSlop={10} onPress={() => onToggleHide(c)} style={styles.archiveBtn}>
                <SymbolView name={isHidden ? 'eye.slash' : 'eye'} tintColor={palette.textSecondary} size={20} />
              </Pressable>
            </>
          )
        ) : (
          <Pressable hitSlop={10} onPress={() => onArchive(c)} style={styles.archiveBtn}>
            <SymbolView name="minus.circle" tintColor={palette.danger} size={20} />
          </Pressable>
        )}
      </View>
    );
  };

  const renderTree = (category: Category) => {
    const children = (catsQ.data ?? []).filter((item) => layoutById.get(item.id)?.parent_category_id === category.id);
    return (
      <Fragment key={category.id}>
        {renderRow(
          category,
          !category.is_system,
          false,
          !!layoutById.get(category.id)?.is_group && children.length === 0,
        )}
        {children.map((child) => (
          <View key={child.id} style={{ paddingLeft: Space[5] }}>
            {renderRow(child, !child.is_system, true)}
          </View>
        ))}
      </Fragment>
    );
  };

  if (catsQ.isLoading || layoutQ.isLoading || hiddenQ.isLoading) return <ActivityIndicator />;
  if (catsQ.isError || layoutQ.isError || hiddenQ.isError)
    return (
      <View style={styles.root}>
        <SheetHeader title={t('category.title')} />
        <Pressable
          style={styles.content}
          onPress={() => {
            void catsQ.refetch();
            void layoutQ.refetch();
            void hiddenQ.refetch();
          }}
        >
          <Text style={{ color: palette.accent }}>{t('common.retry')}</Text>
        </Pressable>
      </View>
    );

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.flex}>
        {/* 悬浮磨砂标题区（自动保存型：纯标题，DESIGN §9.9）；关闭靠下滑手势 */}
        <SheetHeader title={t('category.title')} />

        {/* 支出 / 收入：iOS 原生分段控件（SwiftUI Picker.segmented） */}
        <Host style={styles.segmentHost}>
          <Picker
            modifiers={[pickerStyle('segmented')]}
            selection={type}
            onSelectionChange={(txn) => setType(txn as CategoryType)}
          >
            <UIText modifiers={[tag('expense')]}>{t('record.expense')}</UIText>
            <UIText modifiers={[tag('income')]}>{t('record.income')}</UIText>
          </Picker>
        </Host>

        <ScrollView contentContainerStyle={styles.content}>
          {/* 新增 */}
          <Pressable
            onPress={() => setView({ mode: 'new', type, isGroup: true })}
            style={[styles.addRow, { backgroundColor: palette.card }]}
          >
            <View style={[styles.iconDot, { backgroundColor: palette.accent }]}>
              <SymbolView name="plus" tintColor={palette.onAccent} size={17} weight="semibold" />
            </View>
            <Text style={[styles.rowName, { color: palette.accent }]}>{t('category.addGroup')}</Text>
          </Pressable>

          {custom.length > 0 ? (
            <View style={styles.group}>
              <Text style={[styles.groupTitle, { color: palette.textSecondary }]}>{t('category.custom')}</Text>
              <View style={[styles.card, { backgroundColor: palette.card }]}>{custom.map(renderTree)}</View>
            </View>
          ) : null}

          <View style={styles.group}>
            <Text style={[styles.groupTitle, { color: palette.textSecondary }]}>{t('category.systemPreset')}</Text>
            <View style={[styles.card, { backgroundColor: palette.card }]}>{system.map(renderTree)}</View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function MoveCategory({ category, onBack }: { category: Category; onBack: () => void }) {
  const palette = useSheetPalette();
  const familyQ = useMyFamily();
  const profileQ = useMyProfile();
  const catsQ = useCategories();
  const layoutQ = useCategoryLayout();
  const hiddenQ = useHiddenCategoryIds();
  const moveM = useMoveCategory();
  const [checking, setChecking] = useState(false);
  const currentParent =
    (layoutQ.data ?? []).find((item) => item.category_id === category.id)?.parent_category_id ?? null;
  const groups = (catsQ.data ?? []).filter(
    (item) =>
      item.type === category.type &&
      !hiddenQ.data?.has(item.id) &&
      (layoutQ.data ?? []).some((row) => row.category_id === item.id && row.is_group),
  );
  const choose = async (parentId: string | null) => {
    const familyId = familyQ.data?.id;
    if (!familyId || parentId === currentParent || checking) return;
    setChecking(true);
    let message = t('category.moveConfirmBody');
    try {
      const impact = await fetchCategoryMoveImpact(
        familyId,
        category.id,
        parentId,
        currentPeriodInTimeZone(familyQ.data?.timezone),
      );
      if (impact.hasOwnBudget) {
        Alert.alert(t('category.moveConfirmTitle'), t('category.moveOwnBudget'), alertOk());
        return;
      }
      if (impact.hasAffectedBudget && familyQ.data?.owner_user_id !== profileQ.data?.id) {
        Alert.alert(t('category.ownerOnlyDisable'), t('category.moveOwnerBudget'), alertOk());
        return;
      }
      if (impact.sourceBudget !== null)
        message += `\n${t('category.moveBudgetChange', { name: currentParent ? displayCategoryName(catsQ.data?.find((c) => c.id === currentParent)?.name ?? '', catsQ.data?.find((c) => c.id === currentParent)?.is_system ?? false) : displayCategoryName(category.name, category.is_system), before: formatAmount(impact.sourceUsed, ''), after: formatAmount(Math.max(0, impact.sourceUsed - impact.categoryUsed), '') })}`;
      if (impact.targetBudget !== null)
        message += `\n${t('category.moveBudgetChange', { name: displayCategoryName(catsQ.data?.find((c) => c.id === parentId)?.name ?? '', catsQ.data?.find((c) => c.id === parentId)?.is_system ?? false), before: formatAmount(impact.targetUsed, ''), after: formatAmount(impact.targetUsed + impact.categoryUsed, '') })}`;
    } catch (error) {
      Alert.alert(t('account.saveFailed'), error instanceof Error ? error.message : String(error), alertOk());
      return;
    } finally {
      setChecking(false);
    }
    Alert.alert(t('category.moveConfirmTitle'), message, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('category.move'),
        onPress: async () => {
          try {
            await moveM.mutateAsync({ familyId, categoryId: category.id, parentId });
            onBack();
          } catch (error) {
            Alert.alert(t('account.saveFailed'), error instanceof Error ? error.message : String(error), alertOk());
          }
        },
      },
    ]);
  };
  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.flex}>
        <SheetHeader title={t('category.moveTitle')} onBack={onBack} />
        <ScrollView contentContainerStyle={[styles.content, styles.moveContent]}>
          {currentParent ? (
            <Pressable style={styles.row} onPress={() => void choose(null)}>
              <Text style={{ color: palette.textPrimary }}>{t('category.moveStandalone')}</Text>
            </Pressable>
          ) : null}
          {groups.map((group) => (
            <Pressable
              key={group.id}
              disabled={group.id === currentParent || moveM.isPending || checking}
              style={styles.row}
              onPress={() => void choose(group.id)}
            >
              <Text style={{ color: palette.textPrimary }}>{displayCategoryName(group.name, group.is_system)}</Text>
              {group.id === currentParent ? <SymbolView name="checkmark" tintColor={palette.accent} size={17} /> : null}
            </Pressable>
          ))}
          {groups.length === 0 ? <Text style={{ color: palette.textSecondary }}>{t('category.noGroups')}</Text> : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ── 新增 / 编辑 ───────────────────────────────────────────────────────────────
function Editor({ view, onBack }: { view: Extract<ViewState, { mode: 'new' | 'edit' }>; onBack: () => void }) {
  const palette = useSheetPalette();
  useLocalePreference();
  const catColors = useCategoryColors();
  const familyQ = useMyFamily();
  const catsQ = useCategories();
  const layoutQ = useCategoryLayout();
  const createM = useCreateCategory();
  const updateM = useUpdateCategory();

  const isEdit = view.mode === 'edit';
  const type: CategoryType = isEdit ? (view.category.type as CategoryType) : view.type;

  const [name, setName] = useState(isEdit ? view.category.name : '');
  const defaultIcon = type === 'expense' ? DEFAULT_EXPENSE_ICON : DEFAULT_INCOME_ICON;
  const [icon, setIcon] = useState(isEdit ? (view.category.icon ?? defaultIcon) : defaultIcon);
  const [iconGroup, setIconGroup] = useState(
    () => CATEGORY_ICON_GROUPS.find((group) => group.icons.some((item) => item === icon))?.title,
  );
  const colorKey = isEdit ? customCategoryColorKey(view.category.color_key) : automaticCategoryColorKey(name);

  const saving = createM.isPending || updateM.isPending;
  const trimmed = name.trim();
  const color = catColors[colorKey];

  const handleSave = async () => {
    if (!trimmed) return;
    const parentId = isEdit
      ? ((layoutQ.data ?? []).find((item) => item.category_id === view.category.id)?.parent_category_id ?? null)
      : (view.parentId ?? null);
    // Only siblings must have distinct names; different parents may use the same name.
    const dup =
      (!isEdit || trimmed !== view.category.name) &&
      (catsQ.data ?? []).some(
        (c) =>
          c.type === type &&
          c.name === trimmed &&
          c.status === 'active' &&
          (!isEdit || c.id !== view.category.id) &&
          ((layoutQ.data ?? []).find((item) => item.category_id === c.id)?.parent_category_id ?? null) === parentId,
      );
    if (dup) {
      Alert.alert(t('category.existsTitle'), t('category.exists', { name: trimmed }), alertOk());
      return;
    }
    const persist = async () => {
      try {
        if (isEdit) {
          await updateM.mutateAsync({ id: view.category.id, name: trimmed, icon });
        } else {
          const fid = familyQ.data?.id;
          if (!fid) {
            Alert.alert(t('category.cannotCreate'), t('category.noFamily'), alertOk());
            return;
          }
          await createM.mutateAsync({
            family_id: fid,
            name: trimmed,
            icon,
            type,
            color_key: colorKey,
            parent_category_id: view.parentId,
            is_group: view.isGroup,
          });
        }
        onBack();
      } catch (e) {
        const code = typeof e === 'object' && e !== null && 'code' in e ? e.code : undefined;
        if (code === '23505') {
          Alert.alert(t('category.existsTitle'), t('category.exists', { name: trimmed }), alertOk());
        } else {
          Alert.alert(
            t('account.saveFailed'),
            isLikelyNetworkError(e) ? t('category.saveNetworkError') : t('category.saveError'),
            alertOk(),
          );
        }
      }
    };
    const sameNameElsewhere =
      parentId &&
      (catsQ.data ?? []).some(
        (c) => c.type === type && c.name === trimmed && c.id !== (isEdit ? view.category.id : null),
      );
    if (sameNameElsewhere) {
      Alert.alert(t('category.existsTitle'), t('category.duplicateHint'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.save'), onPress: () => void persist() },
      ]);
    } else await persist();
  };

  const renderIconChoice = (ic: SymbolName, groupTitle: string) => {
    const active = ic === icon && groupTitle === iconGroup;
    return (
      <Pressable
        key={ic}
        accessibilityRole="radio"
        accessibilityState={{ selected: active }}
        onPress={() => {
          setIcon(ic);
          setIconGroup(groupTitle);
        }}
        style={[
          styles.iconCell,
          { backgroundColor: palette.base },
          active && { borderColor: palette.accent, borderWidth: 2 },
        ]}
      >
        <SymbolView
          name={ic}
          tintColor={active ? palette.accent : palette.textSecondary}
          size={28}
          resizeMode="scaleAspectFit"
          style={styles.iconSymbol}
        />
      </Pressable>
    );
  };

  const renderIconGrid = (icons: readonly SymbolName[], groupTitle: string) => {
    const rows: SymbolName[][] = [];
    for (let i = 0; i < icons.length; i += 6) {
      rows.push(icons.slice(i, i + 6));
    }

    return (
      <View style={[styles.iconGrid, { backgroundColor: palette.card }]}>
        {rows.map((row, index) => (
          <View key={`${row.join('-')}-${index}`} style={styles.iconRow}>
            {Array.from({ length: 6 }, (_, slotIndex) => {
              const ic = row[slotIndex];
              return (
                <View key={ic ?? `empty-${index}-${slotIndex}`} style={styles.iconSlot}>
                  {ic ? renderIconChoice(ic, groupTitle) : null}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.flex}>
        {/* 显式保存型：返回 + ✓（DESIGN §9.9） */}
        <SheetHeader
          title={
            isEdit
              ? t('category.edit')
              : view.isGroup
                ? t('category.addGroup')
                : view.parentId
                  ? t('category.addChild')
                  : t('category.add')
          }
          onBack={onBack}
          onConfirm={handleSave}
          confirmDisabled={!trimmed || saving || !layoutQ.isSuccess}
        />

        <View style={styles.editorContent}>
          {/* 预览 + 名称 */}
          <View style={styles.preview}>
            <View style={[styles.previewDot, { backgroundColor: color }]}>
              <SymbolView
                name={icon as SymbolViewProps['name']}
                tintColor="#FFFFFF"
                size={34}
                resizeMode="scaleAspectFit"
                style={styles.previewSymbol}
              />
            </View>
            <Text style={[styles.previewType, { color: palette.textSecondary }]}>
              {type === 'expense' ? t('category.expenseType') : t('category.incomeType')}
            </Text>
          </View>

          <TextInput
            style={[styles.nameInput, { backgroundColor: palette.card, color: palette.textPrimary }]}
            placeholder={t('category.namePlaceholder')}
            placeholderTextColor={palette.textTertiary}
            value={name}
            onChangeText={setName}
            autoFocus={!isEdit}
            returnKeyType="done"
          />

          <ScrollView
            style={styles.iconScroll}
            contentContainerStyle={styles.iconScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.iconGroupList}>
              {CATEGORY_ICON_GROUPS.map((group) => (
                <View key={group.title} style={styles.iconPickerGroup}>
                  <Text style={[styles.iconGroupTitle, { color: palette.textSecondary }]}>{t(group.title)}</Text>
                  {renderIconGrid(group.icons, group.title)}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space[6],
    paddingTop: Space[5],
    paddingBottom: Space[4],
  },
  title: { flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  action: { fontSize: 16 },
  segmentHost: { height: 34, marginTop: SHEET_HEADER_HEIGHT, marginHorizontal: Space[4] },
  content: { paddingHorizontal: Space[6], paddingTop: Space[4], paddingBottom: Space[12], gap: Space[5] },
  moveContent: { paddingTop: SHEET_CONTENT_TOP_PADDING },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[3],
    padding: Space[3],
    borderRadius: Radius.lg,
  },
  group: { gap: Space[2] },
  groupTitle: { fontSize: 13 },
  card: { borderRadius: Radius.lg, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[3],
    paddingHorizontal: Space[3],
    paddingVertical: Space[3],
  },
  iconDot: { width: 32, height: 32, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  categoryMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Space[3] },
  rowName: { fontSize: 16, fontWeight: '500' },
  sysTag: { fontSize: 13 },
  archiveBtn: { padding: Space[1] },
  editorContent: { flex: 1, paddingTop: SHEET_CONTENT_TOP_PADDING, paddingHorizontal: Space[6], gap: Space[4] },
  preview: { alignItems: 'center', gap: Space[2], paddingVertical: Space[4] },
  previewDot: { width: 64, height: 64, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  previewType: { fontSize: 13 },
  nameInput: { height: 50, borderRadius: Radius.md, paddingHorizontal: Space[4], fontSize: 17 },
  iconScroll: { flex: 1 },
  iconScrollContent: {},
  iconGroupList: { gap: Space[4] },
  iconPickerGroup: { gap: Space[2] },
  iconGroupTitle: { fontSize: 13, paddingHorizontal: Space[1] },
  iconGrid: {
    gap: Space[2],
    padding: Space[3],
    borderRadius: Radius.lg,
  },
  iconRow: { flexDirection: 'row', alignItems: 'center' },
  iconSlot: { flex: 1, alignItems: 'center' },
  iconCell: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  iconSymbol: { width: 28, height: 28 },
  previewSymbol: { width: 34, height: 34 },
});
