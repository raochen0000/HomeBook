/**
 * 分类管理（流程 11）：查看系统/自定义分类，新增、编辑、停用自定义分类，按家庭隐藏系统分类。
 * - 所有成员可新增/编辑；仅户主可停用自定义分类、隐藏/显示系统分类（UI 校验，RLS 允许家庭成员写）。
 * - 系统预设分类全局只读，但家庭可隐藏不用的系统分类（family_hidden_categories 覆盖表，MVP §2.4）。
 *   「其他支出 / 其他收入」作兜底不可隐藏；「储蓄·*」走专门入口、从列表过滤。
 * 单 Modal 内以 view 状态在「列表 / 编辑器」间切换，避免嵌套 Modal。
 */
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  useArchiveCategory,
  useCategories,
  useCreateCategory,
  useHiddenCategoryIds,
  useHideSystemCategory,
  useMyFamily,
  useMyProfile,
  useUnhideSystemCategory,
  useUpdateCategory,
  type Category,
  type CategoryType,
} from '@/api';
import { Radius, Space, useCategoryColors, usePalette } from '@/constants/design';
import { categoryColorKey } from '@/lib/category-style';

type SymbolName = Extract<SymbolViewProps['name'], string>;
type IconGroup = { title: string; icons: readonly SymbolName[] };

/** 分类图标库（SF Symbols），收入/支出共用同一套分组交互。 */
const CATEGORY_ICON_GROUPS: readonly IconGroup[] = [
  {
    title: '娱乐',
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
    ],
  },
  {
    title: '饮食',
    icons: [
      'fork.knife',
      'cup.and.saucer.fill',
      'mug.fill',
      'wineglass.fill',
      'takeoutbag.and.cup.and.straw.fill',
      'birthday.cake.fill',
      'carrot.fill',
      'fish.fill',
      'leaf.fill',
      'waterbottle.fill',
    ],
  },
  {
    title: '医疗',
    icons: [
      'cross.case.fill',
      'pills.fill',
      'stethoscope',
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
    title: '学习',
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
    ],
  },
  {
    title: '交通',
    icons: [
      'car.fill',
      'bus.fill',
      'tram.fill',
      'fuelpump.fill',
      'airplane',
      'bicycle',
      'figure.walk',
      'ferry.fill',
      'parkingsign.circle.fill',
      'map.fill',
    ],
  },
  {
    title: '购物',
    icons: [
      'cart.fill',
      'bag.fill',
      'basket.fill',
      'gift.fill',
      'tag.fill',
      'creditcard.fill',
      'shippingbox.fill',
      'storefront.fill',
      'barcode.viewfinder',
      'wallet.pass.fill',
    ],
  },
  {
    title: '生活',
    icons: [
      'phone.fill',
      'wifi',
      'bolt.fill',
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
    title: '个人',
    icons: [
      'person.fill',
      'person.crop.circle.fill',
      'heart.fill',
      'star.fill',
      'tshirt.fill',
      'scissors',
      'eyeglasses',
      'shoeprints.fill',
      'sparkles',
      'hands.sparkles.fill',
    ],
  },
  {
    title: '居家',
    icons: [
      'house.fill',
      'bed.double.fill',
      'sofa.fill',
      'lamp.table.fill',
      'lightbulb.fill',
      'wrench.and.screwdriver.fill',
      'paintbrush.fill',
      'hammer.fill',
      'shower.fill',
      'washer.fill',
    ],
  },
  {
    title: '宠物',
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
    ],
  },
  {
    title: '健身',
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
    ],
  },
  {
    title: '办公',
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
    ],
  },
  {
    title: '理财',
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
    title: '其它',
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
    ],
  },
];

const DEFAULT_EXPENSE_ICON = 'gamecontroller.fill';
const DEFAULT_INCOME_ICON = 'dollarsign.circle.fill';
const CATEGORY_NAME_MAX_LENGTH = 6;

type ViewState = { mode: 'list' } | { mode: 'new'; type: CategoryType } | { mode: 'edit'; category: Category };

/** 兜底分类不可隐藏，保证记账时每种类型至少有一个可选分类。 */
const PROTECTED_SYSTEM_NAMES = new Set(['其他支出', '其他收入']);

export function CategoryManageSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <Body onClose={onClose} /> : null}
    </Modal>
  );
}

function Body({ onClose }: { onClose: () => void }) {
  const palette = usePalette();
  const [view, setView] = useState<ViewState>({ mode: 'list' });
  const editorView = view.mode === 'list' ? null : view;

  return (
    <>
      <List palette={palette} onClose={onClose} setView={setView} />
      <Modal
        visible={!!editorView}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setView({ mode: 'list' })}
      >
        {editorView ? <Editor view={editorView} onBack={() => setView({ mode: 'list' })} /> : null}
      </Modal>
    </>
  );
}

// ── 列表 ─────────────────────────────────────────────────────────────────────
function List({
  palette,
  onClose,
  setView,
}: {
  palette: ReturnType<typeof usePalette>;
  onClose: () => void;
  setView: (v: ViewState) => void;
}) {
  const catColors = useCategoryColors();
  const profileQ = useMyProfile();
  const familyQ = useMyFamily();
  const catsQ = useCategories();
  const hiddenQ = useHiddenCategoryIds();
  const archiveM = useArchiveCategory();
  const hideM = useHideSystemCategory();
  const unhideM = useUnhideSystemCategory();

  const isOwner = !!familyQ.data && familyQ.data.owner_user_id === profileQ.data?.id;
  const familyId = familyQ.data?.id;
  const hidden = hiddenQ.data ?? new Set<string>();
  const [type, setType] = useState<CategoryType>('expense');

  const { system, custom } = useMemo(() => {
    const list = (catsQ.data ?? []).filter((c) => c.type === type && !c.name.startsWith('储蓄·'));
    return {
      system: list.filter((c) => c.is_system),
      custom: list.filter((c) => !c.is_system),
    };
  }, [catsQ.data, type]);

  const onArchive = (c: Category) => {
    if (!isOwner) {
      Alert.alert('仅户主可停用', '停用分类会影响全家，请联系户主操作。');
      return;
    }
    Alert.alert('停用分类', `停用「${c.name}」后，记账时将不再出现。已记录的流水仍保留该分类名。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '停用',
        style: 'destructive',
        onPress: async () => {
          try {
            await archiveM.mutateAsync(c.id);
          } catch (e) {
            Alert.alert('停用失败', (e as Error).message ?? String(e));
          }
        },
      },
    ]);
  };

  const onToggleHide = (c: Category) => {
    if (!isOwner) {
      Alert.alert('仅户主可操作', '隐藏/显示系统分类会影响全家，请联系户主操作。');
      return;
    }
    if (!familyId) return;
    const isHidden = hidden.has(c.id);
    const run = async () => {
      try {
        if (isHidden) await unhideM.mutateAsync({ familyId, categoryId: c.id });
        else await hideM.mutateAsync({ familyId, categoryId: c.id });
      } catch (e) {
        Alert.alert(isHidden ? '显示失败' : '隐藏失败', (e as Error).message ?? String(e));
      }
    };
    if (isHidden) {
      void run(); // 恢复显示无需确认
      return;
    }
    Alert.alert('隐藏分类', `隐藏「${c.name}」后，记账时将不再出现；可随时恢复。已记录的流水不受影响。`, [
      { text: '取消', style: 'cancel' },
      { text: '隐藏', style: 'destructive', onPress: () => void run() },
    ]);
  };

  const renderRow = (c: Category, editable: boolean) => {
    const color = catColors[categoryColorKey(c.name, type)];
    const isHidden = c.is_system && hidden.has(c.id);
    const isProtected = c.is_system && PROTECTED_SYSTEM_NAMES.has(c.name);
    return (
      <Pressable
        key={c.id}
        style={styles.row}
        disabled={!editable}
        onPress={editable ? () => setView({ mode: 'edit', category: c }) : undefined}
      >
        <View style={[styles.iconDot, { backgroundColor: color, opacity: isHidden ? 0.4 : 1 }]}>
          <SymbolView name={(c.icon ?? 'circle.fill') as SymbolViewProps['name']} tintColor="#FFFFFF" size={17} />
        </View>
        <Text style={[styles.rowName, { color: palette.textPrimary, opacity: isHidden ? 0.4 : 1 }]}>{c.name}</Text>
        <View style={styles.flex} />
        {c.is_system ? (
          isProtected ? (
            <Text style={[styles.sysTag, { color: palette.textTertiary }]}>系统</Text>
          ) : (
            <>
              {isHidden ? <Text style={[styles.sysTag, { color: palette.textTertiary }]}>已隐藏</Text> : null}
              <Pressable hitSlop={10} onPress={() => onToggleHide(c)} style={styles.archiveBtn}>
                <SymbolView name={isHidden ? 'eye.slash' : 'eye'} tintColor={palette.textSecondary} size={20} />
              </Pressable>
            </>
          )
        ) : (
          <>
            <Pressable hitSlop={10} onPress={() => onArchive(c)} style={styles.archiveBtn}>
              <SymbolView name="minus.circle" tintColor={palette.danger} size={20} />
            </Pressable>
            <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={13} />
          </>
        )}
      </Pressable>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView style={styles.flex}>
        <View style={styles.topBar}>
          <Text style={[styles.title, { color: palette.textPrimary }]}>分类管理</Text>
          <Pressable hitSlop={8} onPress={onClose}>
            <Text style={[styles.action, { color: palette.textSecondary }]}>完成</Text>
          </Pressable>
        </View>

        {/* 支出 / 收入 切换 */}
        <View style={[styles.segment, { backgroundColor: palette.card }]}>
          {(['expense', 'income'] as CategoryType[]).map((t) => {
            const active = type === t;
            return (
              <Pressable
                key={t}
                style={[styles.segmentItem, active && { backgroundColor: palette.base, borderRadius: Radius.sm }]}
                onPress={() => setType(t)}
              >
                <Text
                  style={{
                    color: active ? palette.textPrimary : palette.textSecondary,
                    fontWeight: active ? '600' : '400',
                  }}
                >
                  {t === 'expense' ? '支出' : '收入'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {/* 新增 */}
          <Pressable
            onPress={() => setView({ mode: 'new', type })}
            style={[styles.addRow, { backgroundColor: palette.card }]}
          >
            <View style={[styles.iconDot, { backgroundColor: palette.accent }]}>
              <SymbolView name="plus" tintColor={palette.onAccent} size={17} weight="semibold" />
            </View>
            <Text style={[styles.rowName, { color: palette.accent }]}>
              新增{type === 'expense' ? '支出' : '收入'}分类
            </Text>
          </Pressable>

          {custom.length > 0 ? (
            <View style={styles.group}>
              <Text style={[styles.groupTitle, { color: palette.textSecondary }]}>自定义</Text>
              <View style={[styles.card, { backgroundColor: palette.card }]}>
                {custom.map((c) => renderRow(c, true))}
              </View>
            </View>
          ) : null}

          <View style={styles.group}>
            <Text style={[styles.groupTitle, { color: palette.textSecondary }]}>系统预设</Text>
            <View style={[styles.card, { backgroundColor: palette.card }]}>
              {system.map((c) => renderRow(c, false))}
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ── 新增 / 编辑 ───────────────────────────────────────────────────────────────
function Editor({ view, onBack }: { view: Exclude<ViewState, { mode: 'list' }>; onBack: () => void }) {
  const palette = usePalette();
  const catColors = useCategoryColors();
  const familyQ = useMyFamily();
  const catsQ = useCategories();
  const createM = useCreateCategory();
  const updateM = useUpdateCategory();

  const isEdit = view.mode === 'edit';
  const type: CategoryType = isEdit ? (view.category.type as CategoryType) : view.type;

  const [name, setName] = useState(isEdit ? view.category.name : '');
  const defaultIcon = type === 'expense' ? DEFAULT_EXPENSE_ICON : DEFAULT_INCOME_ICON;
  const [icon, setIcon] = useState(isEdit ? (view.category.icon ?? defaultIcon) : defaultIcon);

  const saving = createM.isPending || updateM.isPending;
  const trimmed = name.trim();
  const nameTooLong = trimmed.length > CATEGORY_NAME_MAX_LENGTH;
  const color = catColors[categoryColorKey(trimmed, type)];

  const handleSave = async () => {
    if (!trimmed) return;
    if (nameTooLong) {
      Alert.alert('名称过长', `分类名称最多只能输入 ${CATEGORY_NAME_MAX_LENGTH} 个字符。`);
      return;
    }
    // 同类型同名查重（排除自身），与历史/系统分类不冲突。
    const dup = (catsQ.data ?? []).some(
      (c) => c.type === type && c.name === trimmed && c.status === 'active' && (!isEdit || c.id !== view.category.id),
    );
    if (dup) {
      Alert.alert('分类已存在', `已有同名「${trimmed}」分类，换个名字吧。`);
      return;
    }
    try {
      if (isEdit) {
        await updateM.mutateAsync({ id: view.category.id, name: trimmed, icon });
      } else {
        const fid = familyQ.data?.id;
        if (!fid) {
          Alert.alert('暂时无法创建', '请先创建或加入一个家庭。');
          return;
        }
        await createM.mutateAsync({ family_id: fid, name: trimmed, icon, type });
      }
      onBack();
    } catch (e) {
      Alert.alert('保存失败', (e as Error).message ?? String(e));
    }
  };

  const renderIconChoice = (ic: SymbolName) => {
    const active = ic === icon;
    return (
      <Pressable
        key={ic}
        onPress={() => setIcon(ic)}
        style={[
          styles.iconCell,
          { backgroundColor: active ? color : palette.base },
          active && { borderColor: palette.textPrimary, borderWidth: 2 },
        ]}
      >
        <SymbolView
          name={ic}
          tintColor={active ? '#FFFFFF' : palette.textSecondary}
          size={28}
          resizeMode="scaleAspectFit"
          style={styles.iconSymbol}
        />
      </Pressable>
    );
  };

  const renderIconGrid = (icons: readonly SymbolName[]) => {
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
                  {ic ? renderIconChoice(ic) : null}
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
        <View style={styles.topBar}>
          <Pressable hitSlop={8} onPress={onBack}>
            <Text style={[styles.action, { color: palette.textSecondary }]}>取消</Text>
          </Pressable>
          <Text style={[styles.title, { color: palette.textPrimary }]}>{isEdit ? '编辑分类' : '新增分类'}</Text>
          <Pressable hitSlop={8} onPress={handleSave} disabled={!trimmed || nameTooLong || saving}>
            <Text
              style={[
                styles.action,
                { color: trimmed && !nameTooLong && !saving ? palette.accent : palette.textTertiary },
              ]}
            >
              保存
            </Text>
          </Pressable>
        </View>

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
              {type === 'expense' ? '支出分类' : '收入分类'}
            </Text>
          </View>

          <TextInput
            style={[styles.nameInput, { backgroundColor: palette.card, color: palette.textPrimary }]}
            placeholder={`分类名称（最多 ${CATEGORY_NAME_MAX_LENGTH} 个字符）`}
            placeholderTextColor={palette.textTertiary}
            value={name}
            onChangeText={setName}
            maxLength={CATEGORY_NAME_MAX_LENGTH}
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
                  <Text style={[styles.iconGroupTitle, { color: palette.textSecondary }]}>{group.title}</Text>
                  {renderIconGrid(group.icons)}
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
    paddingHorizontal: Space[4],
    paddingVertical: Space[3],
  },
  title: { fontSize: 17, fontWeight: '700' },
  action: { fontSize: 16 },
  segment: { flexDirection: 'row', borderRadius: Radius.md, padding: 3, marginHorizontal: Space[4] },
  segmentItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: Space[2] },
  content: { paddingHorizontal: Space[4], paddingTop: Space[4], paddingBottom: Space[12], gap: Space[5] },
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
  rowName: { fontSize: 16, fontWeight: '500' },
  sysTag: { fontSize: 13 },
  archiveBtn: { padding: Space[1] },
  editorContent: { flex: 1, paddingHorizontal: Space[4], gap: Space[4] },
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
