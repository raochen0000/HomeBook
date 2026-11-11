import { Button as NativeButton, Host } from '@expo/ui/swift-ui';
import {
  buttonStyle,
  disabled as swiftUIDisabled,
  foregroundColor,
  frame,
  glassEffect,
} from '@expo/ui/swift-ui/modifiers';
import MaskedView from '@react-native-masked-view/masked-view';
import { BlurView } from 'expo-blur';
import { SymbolView } from 'expo-symbols';
import { Image } from 'expo-image';
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import type { Category } from '@/api';
import { PageSheet } from '@/components/page-sheet';
import { SHEET_CONTENT_TOP_PADDING, SheetHeader } from '@/components/sheet-header';
import { UserAvatar } from '@/components/user-avatar';
import { Radius, Space, useCategoryColors, useSheetPalette } from '@/constants/design';
import { displayCategoryName, t } from '@/i18n';
import { categoryDescendantIds, type CategoryHierarchy } from '@/lib/category-hierarchy';
import { selectedCategoryCount } from './filter-logic';
import { categoryColorKey, categorySymbol } from '@/lib/category-style';
import { summarizeSelectedLabels } from '@/lib/search-labels';

export type ReportFilters = { memberIds: string[]; categoryIds: string[] };
type Member = { id: string; nickname: string; avatarUrl: string | null; accessibilityLabel?: string };
type Action = 'confirm' | 'reset';

function FilterAvatar({ member, size }: { member: Member; size: number }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!member.avatarUrl || member.avatarUrl === failedUrl) {
    return <UserAvatar avatarUrl={null} nickname={member.nickname} size={size} />;
  }
  const url = member.avatarUrl;
  return (
    <Image
      source={url}
      onError={() => setFailedUrl(url)}
      contentFit="cover"
      style={{ width: size, height: size, borderRadius: size / 2 }}
    />
  );
}

export function ReportFilterSheet({
  visible,
  filters,
  members,
  categories,
  hierarchy,
  pending,
  error,
  onChange,
  onSubmit,
  onClose,
  search,
}: {
  visible: boolean;
  filters: ReportFilters;
  members: Member[];
  categories: Category[];
  hierarchy: CategoryHierarchy;
  pending: Action | null;
  error: boolean;
  onChange: (value: ReportFilters) => void;
  onSubmit: (action: Action) => void;
  onClose: () => void;
  search?: {
    before: ReactNode;
    after: ReactNode;
    showExpense: boolean;
    showIncome: boolean;
    confirmLabel: string;
    loading: boolean;
    invalid: boolean;
  };
}) {
  const palette = useSheetPalette();
  const colors = useCategoryColors();
  const { width, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [footerWidth, setFooterWidth] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);
  const nativeGlass = Platform.OS === 'ios' && Number(Platform.Version) >= 26;
  const buttonWidth = Math.max(0, (footerWidth - Space[4] * 2 - Space[3]) / 2);
  const columns = Math.max(2, Math.min(5, Math.floor((width - 64) / (48 * Math.max(1, fontScale / 1.2)))));
  const [open, setOpen] = useState({ members: true, expense: false, income: false });
  const [groups, setGroups] = useState<string[]>([]);
  const [memberPage, setMemberPage] = useState(0);
  const memberSpace = Math.max(48, width - 64);
  const capacity = Math.max(1, Math.min(5, Math.floor((memberSpace + 6) / 54)));
  const maxMembers =
    members.length > capacity ? Math.max(1, Math.min(5, Math.floor((memberSpace - 44) / 54))) : capacity;
  const roots = (type: 'expense' | 'income') =>
    categories.filter((c) => c.type === type && !hierarchy.layoutById.get(c.id)?.parent_category_id);
  const toggle = (ids: string[], id: string) => (ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]);
  const selectCategory = (id: string) => onChange({ ...filters, categoryIds: toggle(filters.categoryIds, id) });
  const selectGroup = (ids: string[]) => {
    const selected = new Set(filters.categoryIds);
    const remove = ids.every((id) => selected.has(id));
    ids.forEach((id) => (remove ? selected.delete(id) : selected.add(id)));
    onChange({ ...filters, categoryIds: [...selected] });
  };
  const selectedMembers = members.filter((member) => filters.memberIds.includes(member.id));
  const page = memberPage % Math.max(1, Math.ceil(members.length / maxMembers));
  const shownMembers = members.slice(page * maxMembers, (page + 1) * maxMembers);
  const remaining = Math.max(0, members.length - shownMembers.length);
  const section = (title: string, expanded: boolean, onToggle: () => void, summary: ReactNode, children: ReactNode) => (
    <View style={[styles.card, { backgroundColor: palette.card }]}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded }} style={styles.heading}>
        <Text style={[styles.title, { color: palette.textPrimary }]}>{title}</Text>
        <View style={styles.headingRight}>
          {!expanded && summary}
          <SymbolView name={expanded ? 'chevron.down' : 'chevron.right'} size={14} tintColor={palette.textSecondary} />
        </View>
      </Pressable>
      {expanded ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
  const renderCategories = (type: 'expense' | 'income') => {
    const tile = (
      category: Category,
      id: string,
      label: string,
      selected: boolean,
      partial: boolean,
      onPress: () => void,
      accessibilityName = label,
    ) => {
      const color = colors[categoryColorKey(category.name, type, category.color_key)];
      return (
        <Pressable
          onPress={onPress}
          disabled={!!pending}
          accessibilityRole="checkbox"
          accessibilityLabel={accessibilityName}
          accessibilityState={{ checked: partial ? 'mixed' : selected, disabled: !!pending }}
          style={styles.categoryTile}
          key={id}
        >
          <View style={[styles.categoryRing, (selected || partial) && { borderColor: palette.accent, borderWidth: 2 }]}>
            <View style={[styles.categoryCircle, { backgroundColor: color, opacity: selected || partial ? 1 : 0.78 }]}>
              <Image source={`sf:${categorySymbol(category.icon, type)}`} style={styles.categorySymbol} />
            </View>
            {selected || partial ? (
              <View style={[styles.categoryCheck, { backgroundColor: palette.accent, borderColor: palette.card }]}>
                <SymbolView name={partial ? 'minus' : 'checkmark'} size={10} tintColor="#FFFFFF" />
              </View>
            ) : null}
          </View>
          <Text
            numberOfLines={2}
            style={[
              styles.categoryLabel,
              {
                color: selected || partial ? palette.accent : palette.textSecondary,
                fontWeight: selected || partial ? '600' : '400',
              },
            ]}
          >
            {label}
          </Text>
        </Pressable>
      );
    };
    return roots(type).map((category) => {
      const ids = categoryDescendantIds(category.id, hierarchy);
      const count = ids.filter((id) => filters.categoryIds.includes(id)).length;
      const expanded = groups.includes(category.id);
      const name = displayCategoryName(category.name, category.is_system);
      const color = colors[categoryColorKey(category.name, type, category.color_key)];
      return (
        <View key={category.id}>
          <View style={styles.categoryRow}>
            {ids.length > 1 ? (
              <Pressable
                onPress={() => setGroups(toggle(groups, category.id))}
                accessibilityRole="button"
                accessibilityLabel={`${name} ${t('report.filterCategoryDetails')}`}
                accessibilityState={{ expanded }}
                style={styles.categoryRowLabel}
              >
                <View style={[styles.categoryRootIcon, { backgroundColor: color }]}>
                  <Image source={`sf:${categorySymbol(category.icon, type)}`} style={styles.rootSymbol} />
                </View>
                <Text style={[styles.categoryRootName, { color: palette.textPrimary }]}>{name}</Text>
              </Pressable>
            ) : (
              <View style={styles.categoryRowLabel}>
                <View style={[styles.categoryRootIcon, { backgroundColor: color }]}>
                  <Image source={`sf:${categorySymbol(category.icon, type)}`} style={styles.rootSymbol} />
                </View>
                <Text style={[styles.categoryRootName, { color: palette.textPrimary }]}>{name}</Text>
              </View>
            )}
            <Pressable
              onPress={() => (ids.length > 1 ? selectGroup(ids) : selectCategory(category.id))}
              disabled={!!pending}
              accessibilityRole="checkbox"
              accessibilityLabel={name}
              accessibilityState={{
                checked: count === ids.length ? true : count > 0 ? 'mixed' : false,
                disabled: !!pending,
              }}
              style={styles.categoryCheckbox}
            >
              <SymbolView
                name={count === ids.length ? 'checkmark.circle.fill' : count > 0 ? 'minus.circle.fill' : 'circle'}
                size={21}
                tintColor={count > 0 ? palette.accent : palette.textTertiary}
              />
            </Pressable>
            {ids.length > 1 ? (
              <Pressable
                onPress={() => setGroups(toggle(groups, category.id))}
                accessible={false}
                style={styles.groupExpand}
              >
                <SymbolView
                  name={expanded ? 'chevron.down' : 'chevron.right'}
                  size={14}
                  tintColor={palette.textSecondary}
                />
              </Pressable>
            ) : (
              <View style={styles.groupExpand} />
            )}
          </View>
          {ids.length > 1 && expanded ? (
            <View style={[styles.childGroup, { backgroundColor: palette.base }]}>
              <View style={styles.categoryGrid}>
                {ids.map((id) => {
                  const child = hierarchy.byId.get(id);
                  if (!child) return null;
                  const label =
                    id === category.id ? t('category.unspecified') : displayCategoryName(child.name, child.is_system);
                  return (
                    <View key={id} style={{ width: `${100 / columns}%`, alignItems: 'center' }}>
                      {tile(
                        child,
                        id,
                        label,
                        filters.categoryIds.includes(id),
                        false,
                        () => selectCategory(id),
                        `${name} / ${label}`,
                      )}
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}
        </View>
      );
    });
  };
  const categorySummary = (type: 'expense' | 'income') => {
    const count = selectedCategoryCount(roots(type), hierarchy, filters.categoryIds);
    if (search && count) {
      const labels = roots(type).flatMap((root) => {
        const ids = categoryDescendantIds(root.id, hierarchy);
        if (ids.every((id) => filters.categoryIds.includes(id))) {
          return [displayCategoryName(root.name, root.is_system)];
        }
        return ids.flatMap((id) => {
          if (!filters.categoryIds.includes(id)) return [];
          const category = hierarchy.byId.get(id);
          if (!category) return [];
          return [id === root.id ? t('category.unspecified') : displayCategoryName(category.name, category.is_system)];
        });
      });
      return (
        <Text numberOfLines={1} style={{ color: palette.textSecondary, flexShrink: 1 }}>
          {summarizeSelectedLabels(labels)}
        </Text>
      );
    }
    return (
      <Text style={{ color: palette.textSecondary }}>
        {count ? t('report.filterSelectedItems', { count }) : t('report.filterAllItems')}
      </Text>
    );
  };
  return (
    <PageSheet visible={visible} onClose={onClose} allowSwipeDismissal>
      <KeyboardAvoidingView
        enabled={!!search}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.root, { backgroundColor: palette.base }]}
      >
        <SafeAreaView edges={['top', 'left', 'right']} style={styles.root}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.content, { paddingBottom: Math.max(footerHeight, 90) + Space[3] }]}
          >
            {search ? (
              search.before
            ) : (
              <Text style={[styles.hint, { color: palette.textSecondary }]}>{t('report.filterUnifyHint')}</Text>
            )}
            {section(
              t('report.filterMembers'),
              open.members,
              () => setOpen({ ...open, members: !open.members }),
              selectedMembers.length ? (
                <View style={styles.stack}>
                  {selectedMembers.slice(0, 5).map((m, i) => (
                    <View key={m.id} style={[styles.stacked, { marginLeft: i ? -10 : 0, borderColor: palette.card }]}>
                      <FilterAvatar member={m} size={28} />
                    </View>
                  ))}
                  {selectedMembers.length > 5 ? (
                    <Text style={{ color: palette.textSecondary }}>+{selectedMembers.length - 5}</Text>
                  ) : null}
                </View>
              ) : (
                <Text style={{ color: palette.textSecondary }}>{t('report.filterAllItems')}</Text>
              ),
              <View style={styles.members}>
                {shownMembers.map((m) => {
                  const selected = filters.memberIds.includes(m.id);
                  return (
                    <Pressable
                      key={m.id}
                      disabled={!!pending}
                      onPress={() => onChange({ ...filters, memberIds: toggle(filters.memberIds, m.id) })}
                      accessibilityRole="checkbox"
                      accessibilityLabel={m.accessibilityLabel ?? m.nickname}
                      accessibilityState={{ checked: selected, disabled: !!pending }}
                      style={[styles.avatar, { borderColor: selected ? palette.accent : 'transparent' }]}
                    >
                      <FilterAvatar member={m} size={40} />
                      {selected ? (
                        <View style={[styles.check, { backgroundColor: palette.accent }]}>
                          <SymbolView name="checkmark" size={10} tintColor={palette.onAccent} />
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
                {members.length > maxMembers ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      page === 0 ? t('report.filterMoreMembers', { count: remaining }) : t('report.filterMemberNext')
                    }
                    onPress={() => setMemberPage((page + 1) % Math.ceil(members.length / maxMembers))}
                    style={[styles.more, { backgroundColor: palette.cardPill }]}
                  >
                    <Text style={{ color: palette.textPrimary }}>
                      {page === 0 ? `+${remaining}` : t('report.filterMemberNext')}
                    </Text>
                  </Pressable>
                ) : null}
              </View>,
            )}
            {(!search || search.showExpense) &&
              section(
                t('report.filterExpenseCats'),
                open.expense,
                () => setOpen({ ...open, expense: !open.expense }),
                categorySummary('expense'),
                renderCategories('expense'),
              )}
            {(!search || search.showIncome) &&
              section(
                t('report.filterIncomeCats'),
                open.income,
                () => setOpen({ ...open, income: !open.income }),
                categorySummary('income'),
                renderCategories('income'),
              )}
            {search?.after}
            {error ? (
              <Text accessibilityRole="alert" style={{ color: palette.danger }}>
                {t('report.filterApplyFailed')}
              </Text>
            ) : null}
          </ScrollView>
          <View
            pointerEvents="box-none"
            onLayout={(event) => {
              setFooterWidth(event.nativeEvent.layout.width);
              setFooterHeight(event.nativeEvent.layout.height);
            }}
            style={[
              styles.footer,
              {
                paddingBottom:
                  (Platform.OS === 'ios'
                    ? Math.max(Space[2], Math.round(insets.bottom * 0.35))
                    : Math.max(insets.bottom, Space[2])) + (search ? Space[3] : 0),
              },
            ]}
          >
            <MaskedView
              pointerEvents="none"
              style={StyleSheet.absoluteFill}
              maskElement={
                <Svg width="100%" height="100%">
                  <Defs>
                    <LinearGradient id="filter-footer-fade" x1="0" y1="0" x2="0" y2="1">
                      <Stop offset="0" stopColor="#000" stopOpacity="0" />
                      <Stop offset="0.5" stopColor="#000" stopOpacity="0.85" />
                      <Stop offset="1" stopColor="#000" stopOpacity="1" />
                    </LinearGradient>
                  </Defs>
                  <Rect width="100%" height="100%" fill="url(#filter-footer-fade)" />
                </Svg>
              }
            >
              <BlurView tint="default" intensity={30} style={StyleSheet.absoluteFill} />
            </MaskedView>
            {(['reset', 'confirm'] as const).map((action) => {
              const label = search
                ? action === 'reset'
                  ? t('common.clear')
                  : search.confirmLabel
                : t(action === 'reset' ? 'common.reset' : 'common.confirm');
              const isLoading = pending === action || (!!search && action === 'confirm' && search.loading);
              const primary = action === 'confirm';
              const disabled = !!pending || (!!search && primary && search.invalid);
              return nativeGlass && buttonWidth > 0 ? (
                <View key={action} style={styles.buttonHost}>
                  <Host style={styles.nativeButtonHost} ignoreSafeArea="all">
                    <NativeButton
                      label={label}
                      onPress={() => onSubmit(action)}
                      modifiers={[
                        frame({ width: buttonWidth, height: 48 }),
                        buttonStyle('plain'),
                        foregroundColor(isLoading ? 'transparent' : primary ? palette.onAccent : palette.textPrimary),
                        glassEffect({
                          glass: {
                            variant: 'regular',
                            interactive: !disabled,
                            ...(primary ? { tint: palette.accent } : {}),
                          },
                          shape: 'capsule',
                        }),
                        ...(disabled ? [swiftUIDisabled(true)] : []),
                      ]}
                    />
                  </Host>
                  {isLoading ? (
                    <View pointerEvents="none" style={styles.loadingOverlay}>
                      <ActivityIndicator color={primary ? palette.onAccent : palette.textPrimary} />
                    </View>
                  ) : null}
                </View>
              ) : (
                <Pressable
                  key={action}
                  disabled={disabled}
                  onPress={() => onSubmit(action)}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  accessibilityState={{ disabled, busy: isLoading }}
                  style={[
                    styles.button,
                    primary
                      ? { backgroundColor: palette.accent }
                      : { backgroundColor: palette.card, borderColor: palette.separator, borderWidth: 1 },
                    pending && !isLoading && { opacity: 0.5 },
                  ]}
                >
                  {isLoading ? (
                    <ActivityIndicator color={primary ? palette.onAccent : palette.textPrimary} />
                  ) : (
                    <Text style={{ color: primary ? palette.onAccent : palette.textPrimary, fontWeight: '600' }}>
                      {label}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>
          <SheetHeader title={search ? t('search.filters') : t('report.globalFilter')} onClose={onClose} />
        </SafeAreaView>
      </KeyboardAvoidingView>
    </PageSheet>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: Space[4], paddingTop: SHEET_CONTENT_TOP_PADDING, gap: Space[3] },
  hint: { fontSize: 14, lineHeight: 21 },
  card: { borderRadius: Radius.lg, overflow: 'hidden' },
  heading: {
    minHeight: 56,
    paddingHorizontal: Space[4],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space[2],
  },
  title: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
  headingRight: { flexDirection: 'row', alignItems: 'center', gap: Space[2], flexShrink: 1 },
  body: { paddingHorizontal: Space[4], paddingBottom: Space[4] },
  members: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  avatar: { width: 48, height: 48, borderRadius: 24, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  check: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    borderRadius: 9,
    width: 17,
    height: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  more: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  stack: { flexDirection: 'row', alignItems: 'center' },
  stacked: { width: 32, height: 32, borderRadius: 16, borderWidth: 2 },
  categoryRow: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  categoryRowLabel: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: Space[2] },
  categoryCheckbox: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
  categoryRootIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rootSymbol: { width: 17, height: 17, tintColor: '#FFFFFF' },
  categoryRootName: { flex: 1, fontSize: 15 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: Space[2], paddingVertical: Space[2] },
  categoryTile: { alignItems: 'center', gap: Space[1], width: '100%', minHeight: 82 },
  categoryRing: { width: 48, height: 48, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  categoryCircle: { width: 42, height: 42, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  categorySymbol: { width: 24, height: 24, tintColor: '#FFFFFF' },
  categoryCheck: {
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
  categoryLabel: { width: '100%', textAlign: 'center', fontSize: 12, maxWidth: 72 },
  groupExpand: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  childGroup: { borderRadius: Radius.md, paddingTop: Space[2], marginBottom: Space[2] },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Space[4],
    paddingTop: Space[3],
    flexDirection: 'row',
    gap: Space[3],
  },
  buttonHost: { flex: 1, height: 48 },
  nativeButtonHost: { flex: 1 },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: { flex: 1, minHeight: 48, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
});
