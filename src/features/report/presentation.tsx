import { BottomSheet, Group, Host, RNHostView } from '@expo/ui/swift-ui';
import { presentationBackground, presentationDetents, presentationDragIndicator } from '@expo/ui/swift-ui/modifiers';
import { SymbolView } from 'expo-symbols';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SHEET_CONTENT_TOP_PADDING, SheetHeader } from '@/components/sheet-header';
import { UserAvatar } from '@/components/user-avatar';
import { Radius, Space, usePalette, useSheetPalette } from '@/constants/design';
import { useAvatarFiles } from '@/features/home/use-avatar-files';
import { t } from '@/i18n';

/** Keep the native host and its content alive throughout the dismissal animation. */
export function ReportDetailsSheet({
  visible,
  title,
  children,
  onClose,
}: {
  visible: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const palette = useSheetPalette();
  const insets = useSafeAreaInsets();
  return (
    <Host style={styles.anchor}>
      <BottomSheet
        isPresented={visible}
        onIsPresentedChange={(shown) => {
          if (!shown) onClose();
        }}
      >
        <Group
          modifiers={[
            presentationDetents(['medium', 'large']),
            presentationDragIndicator('visible'),
            presentationBackground(palette.base),
          ]}
        >
          <RNHostView>
            <View style={[styles.sheet, { backgroundColor: palette.base }]}>
              <ScrollView contentContainerStyle={[styles.sheetContent, { paddingBottom: insets.bottom + Space[6] }]}>
                {children}
              </ScrollView>
              <SheetHeader title={title} onClose={onClose} />
            </View>
          </RNHostView>
        </Group>
      </BottomSheet>
    </Host>
  );
}

export function ReportDetailText({ children }: { children: ReactNode }) {
  const palette = useSheetPalette();
  return (
    <Text selectable style={[styles.detailText, { color: palette.textPrimary }]}>
      {children}
    </Text>
  );
}

export function ReportFilterButton({
  members,
  filterCount,
  description,
  disabled,
  onPress,
}: {
  members: readonly { id: string; nickname: string; avatarUrl: string | null }[];
  filterCount: number;
  description: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  const visibleMembers = members.slice(0, 3);
  const avatars = useAvatarFiles(visibleMembers.map((member) => ({ id: member.id, avatar_url: member.avatarUrl })));
  const overflow = members.length - visibleMembers.length;
  const showCount = filterCount > members.length;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={description}
      accessibilityHint={t('report.filterHint')}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.filterButton, { opacity: disabled || pressed ? 0.55 : 1 }]}
    >
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.avatarStack}
      >
        {visibleMembers.length > 0 ? (
          visibleMembers.map((member, index) => (
            <View
              key={member.id}
              style={[styles.filterAvatar, { marginLeft: index === 0 ? 0 : -14, borderColor: palette.base }]}
            >
              <UserAvatar avatarUrl={avatars.get(member.id) ?? null} nickname={member.nickname} size={30} />
            </View>
          ))
        ) : (
          <SymbolView
            name="line.3.horizontal.decrease"
            size={22}
            tintColor={filterCount > 0 ? palette.accent : palette.textPrimary}
          />
        )}
        {overflow > 0 ? (
          <View
            style={[
              styles.filterAvatar,
              styles.overflowAvatar,
              { borderColor: palette.base, backgroundColor: palette.cardPill },
            ]}
          >
            <Text style={[styles.overflowText, { color: palette.textPrimary }]} maxFontSizeMultiplier={1.15}>
              +{overflow}
            </Text>
          </View>
        ) : null}
      </View>
      {showCount ? (
        <View
          pointerEvents="none"
          style={[styles.filterCount, { backgroundColor: palette.ink, borderColor: palette.base }]}
        >
          <Text style={[styles.filterCountText, { color: palette.onInk }]} maxFontSizeMultiplier={1.15}>
            {filterCount > 99 ? '99+' : filterCount}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function ReportCardHeader({ title, details }: { title: string; details?: ReactNode }) {
  const palette = usePalette();
  const [open, setOpen] = useState(false);
  return (
    <>
      <View style={styles.header}>
        <View style={styles.titleGroup}>
          <Text accessibilityRole="header" style={[styles.title, { color: palette.textPrimary }]}>
            {title}
          </Text>
          {details ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('report.chartInfo', { title })}
              onPress={() => setOpen(true)}
              style={({ pressed }) => [styles.info, { opacity: pressed ? 0.6 : 1 }]}
            >
              <SymbolView name="info.circle" size={17} tintColor={palette.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      </View>
      {details ? (
        <ReportDetailsSheet visible={open} title={title} onClose={() => setOpen(false)}>
          {details}
        </ReportDetailsSheet>
      ) : null}
    </>
  );
}

export function ReportDisclosure({
  label,
  value,
  color,
  title,
  children,
}: {
  label: string;
  value?: string;
  color?: string;
  title: string;
  children: ReactNode;
}) {
  const palette = usePalette();
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityHint={t('report.viewDetails')}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.disclosure, { borderTopColor: palette.separator, opacity: pressed ? 0.65 : 1 }]}
      >
        <Text style={[styles.rowLabel, { color: palette.textSecondary }]}>{label}</Text>
        {value ? <Text style={[styles.value, { color: color ?? palette.textPrimary }]}>{value}</Text> : null}
        <SymbolView name="chevron.right" size={13} tintColor={palette.textSecondary} />
      </Pressable>
      <ReportDetailsSheet visible={open} title={title} onClose={() => setOpen(false)}>
        {children}
      </ReportDetailsSheet>
    </View>
  );
}

export function ReportEmptyGroup({
  title,
  onAdjust,
  children,
}: {
  title: string;
  onAdjust?: () => void;
  children?: ReactNode;
}) {
  const palette = usePalette();
  return (
    <View style={[styles.emptyCard, { backgroundColor: palette.card }]}>
      <View style={styles.emptyHeading}>
        <Text style={[styles.emptyTitle, { color: palette.textSecondary }]}>{title}</Text>
        {onAdjust ? (
          <Pressable
            accessibilityRole="button"
            onPress={onAdjust}
            style={({ pressed }) => [styles.adjust, { opacity: pressed ? 0.65 : 1 }]}
          >
            <Text style={{ color: palette.accent }}>{t('report.adjustFilters')}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', width: 1, height: 1 },
  sheet: { flex: 1 },
  sheetContent: { paddingTop: SHEET_CONTENT_TOP_PADDING, paddingHorizontal: Space[4], gap: Space[4] },
  detailText: { fontSize: 16, lineHeight: 24 },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: Space[2],
    marginBottom: Space[2],
  },
  titleGroup: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  title: { fontSize: 17, fontWeight: '600', flexShrink: 1 },
  info: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  filterButton: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 6,
    marginRight: -6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarStack: { flexDirection: 'row', alignItems: 'center' },
  filterAvatar: { borderRadius: Radius.full, borderWidth: 2, width: 34, height: 34, overflow: 'hidden' },
  overflowAvatar: { marginLeft: -14, alignItems: 'center', justifyContent: 'center' },
  overflowText: { fontSize: 11, fontWeight: '600' },
  filterCount: {
    position: 'absolute',
    top: -1,
    right: -2,
    minWidth: 20,
    height: 20,
    borderRadius: Radius.full,
    borderWidth: 2,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterCountText: { fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] },
  disclosure: {
    minHeight: 44,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Space[2],
    paddingVertical: Space[2],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { flexGrow: 1, flexShrink: 1, fontSize: 14 },
  value: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  emptyCard: { padding: Space[4], borderRadius: Radius.lg },
  emptyHeading: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space[2],
  },
  emptyTitle: { fontSize: 15, flexShrink: 1 },
  adjust: { minHeight: 44, justifyContent: 'center' },
});
