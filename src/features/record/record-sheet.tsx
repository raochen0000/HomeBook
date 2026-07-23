/**
 * 记账面板（流程 2 + 流程 10 编辑/删除）。
 *
 * DESIGN §5.3：记账面板 = 原生 Sheet 壳 + 自定义大号金额键盘（L-Custom）。
 * 这里用 RN `Modal`（iOS `pageSheet`，自带下滑关）承载原生 Sheet 观感，顶部用居中抓手提示「拖拽」，
 * 内部金额键盘按设计走自定义 RN 层（@expo/ui 无此交互），避免 RNHostView 桥接的脆弱性。
 *
 * 布局：固定区（抓手 / 标题 / 支出收入分段 / 大号金额）+ 详情卡（分类区可滚动；备注·时间·记账人固定）
 * + 固定底部（数字键盘 / 保存）。展开分类时仅分类网格滚动，键盘与保存恒贴底。
 */
import { DatePicker, Host, Picker, Text as UIText } from '@expo/ui/swift-ui';
import { datePickerStyle, labelsHidden, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type DimensionValue,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  useAccountingPrefs,
  useCategories,
  useCreateTransaction,
  useHiddenCategoryIds,
  useMemberships,
  useTransactions,
  useUpdateTransaction,
  type Category,
  type FamilyMembership,
  type Transaction,
} from '@/api';
import { toast } from '@/components/toast';
import { Radius, Space, useCategoryColors, usePalette } from '@/constants/design';
import { categoryColorKey, categorySymbol } from '@/lib/category-style';

type TxnType = 'expense' | 'income';

export type RecordSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** 当前家庭 id（记一笔必须，创建即绑定，不可变）。 */
  familyId: string;
  /** 当前登录用户 id（记账人默认值）。 */
  recorderId: string;
  /** null = 新建；非 null = 编辑该流水。 */
  editing: Transaction | null;
  /** 保存成功回调；firstRecord=true 表示这是家庭第一笔（父层据此在面板关闭后弹庆祝，否则弹 toast）。 */
  onSaved?: (info: { firstRecord: boolean }) => void;
  /** 面板关闭动画结束（iOS）；父层用它在面板消失后再弹首次记账庆祝。 */
  onDismiss?: () => void;
};

/** 数字键盘按行排布（便于画分割线，形成网格分割感）。 */
const KEY_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', '⌫'],
] as const;

/** 把正在输入的金额字符串拆为「整数（含千分位） + 小数」用于展示。 */
function displayParts(raw: string): { integer: string; decimal: string; hasDot: boolean } {
  const [intRaw = '', decRaw] = raw.split('.');
  const intNum = intRaw === '' ? 0 : Number(intRaw);
  return { integer: intNum.toLocaleString('en-US'), decimal: decRaw ?? '', hasDot: raw.includes('.') };
}

/** 输入串 → 分（bigint 口径）。 */
function rawToCents(raw: string): number {
  return Math.round(Number(raw || '0') * 100);
}

/** 外壳：原生 pageSheet。内部表单只在打开时挂载，靠 useState 初值按 editing 还原（避免 setState-in-effect）。 */
export function RecordSheet({ visible, onClose, onDismiss, familyId, recorderId, editing, onSaved }: RecordSheetProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onDismiss={onDismiss}
    >
      {visible ? (
        <RecordForm familyId={familyId} recorderId={recorderId} editing={editing} onClose={onClose} onSaved={onSaved} />
      ) : null}
    </Modal>
  );
}

function RecordForm({ familyId, recorderId, editing, onClose, onSaved }: Omit<RecordSheetProps, 'visible'>) {
  const palette = usePalette();
  const catColors = useCategoryColors();

  const categoriesQ = useCategories();
  const hiddenQ = useHiddenCategoryIds();
  const membersQ = useMemberships();
  const createM = useCreateTransaction();
  const updateM = useUpdateTransaction();
  const transactionsQ = useTransactions();
  const saving = createM.isPending || updateM.isPending;

  // 记账偏好（记账设置 §18.3.1）：默认记账类型 + 记一笔后行为。
  const prefs = useAccountingPrefs().data;
  const afterBehavior = prefs?.after_record_behavior ?? 'close';

  // 初值按 editing 还原（表单随每次打开重新挂载，初值即生效）；新建时用「默认记账类型」偏好。
  const [type, setType] = useState<TxnType>(
    editing ? (editing.type === 'income' ? 'income' : 'expense') : (prefs?.default_txn_type ?? 'expense'),
  );
  const [raw, setRaw] = useState(editing?.amount ? (editing.amount / 100).toString() : '');
  const [categoryId, setCategoryId] = useState<string | null>(editing?.category_id ?? null);
  const [note, setNote] = useState(editing?.note ?? '');
  const [occurredAt, setOccurredAt] = useState<Date>(editing?.occurred_at ? new Date(editing.occurred_at) : new Date());
  const [recorderUserId, setRecorderUserId] = useState(editing?.recorder_user_id ?? recorderId);
  const [catExpanded, setCatExpanded] = useState(false);
  const [memberOpen, setMemberOpen] = useState(false);
  // 分类区可用宽度（实测），用于折叠/展开两态统一每行 5 个、同一像素宽，避免切换时图标横向跳动。
  const [catAreaW, setCatAreaW] = useState(0);

  // 同家庭成员；仅户主可查看并切换「记账人」，普通成员默认记到自己名下。
  const members = membersQ.data ?? [];
  const showRecorder = members.some((m) => m.userId === recorderId && m.role === 'owner');
  const recorderName = members.find((m) => m.userId === recorderUserId)?.nickname ?? '我';

  // 可手动选择的分类：当前类型 + 排除储蓄类系统分类（储蓄走专门入口，PRD 口径）+ 排除本家庭隐藏的系统分类。
  // 仅显示当前 Tab 类型——支出 Tab 不混入收入分类，反之亦然。
  // 编辑时若该笔原分类已被家庭隐藏，仍保留它，便于查看/保留原分类。
  const categories = useMemo<Category[]>(() => {
    const hidden = hiddenQ.data ?? new Set<string>();
    const all = categoriesQ.data ?? [];
    return all.filter(
      (c) => c.type === type && !c.name.startsWith('储蓄·') && (!hidden.has(c.id) || c.id === editing?.category_id),
    );
  }, [categoriesQ.data, hiddenQ.data, type, editing?.category_id]);

  // 有效分类：用户已选且仍合法则用之，否则落到当前类型第一项（在 render 期派生，不用 effect）。
  const effectiveCategoryId = useMemo(() => {
    if (categoryId && categories.some((c) => c.id === categoryId)) return categoryId;
    return categories[0]?.id ?? null;
  }, [categoryId, categories]);

  // 每行 5 个；折叠态与展开态共用同一像素宽（实测宽 ÷ 5），切换不抖动。
  const catItemW = catAreaW > 0 ? catAreaW / 5 : 64;

  const cents = rawToCents(raw);
  const canSave = cents > 0 && !!effectiveCategoryId && !!familyId && !saving;
  const amountColor = type === 'expense' ? palette.expense : palette.income;
  const sign = type === 'expense' ? '-' : '+';
  const parts = displayParts(raw);

  const press = (k: string) => {
    setRaw((prev) => {
      if (k === '⌫') return prev.slice(0, -1);
      if (k === '.') {
        if (prev.includes('.')) return prev;
        return prev === '' ? '0.' : prev + '.';
      }
      // 数字键
      const [, dec] = prev.split('.');
      if (dec !== undefined && dec.length >= 2) return prev; // 最多两位小数
      if (prev === '0') return k; // 避免前导零
      if (prev.replace('.', '').length >= 9) return prev; // 整体位数上限
      return prev + k;
    });
  };

  const handleSave = async () => {
    if (!canSave || !effectiveCategoryId) return;
    // 家庭第一笔？仅新建、且流水列表已加载为空时判定（写入前判，避免失效刷新干扰）。
    const isFirstRecord = !editing && transactionsQ.isSuccess && (transactionsQ.data?.length ?? 0) === 0;
    try {
      if (editing) {
        await updateM.mutateAsync({
          id: editing.id,
          type,
          amount: cents,
          category_id: effectiveCategoryId,
          note: note || null,
          occurred_at: occurredAt.toISOString(),
          recorder_user_id: recorderUserId,
        });
        onSaved?.({ firstRecord: false });
        onClose();
        return;
      }

      await createM.mutateAsync({
        family_id: familyId,
        recorder_user_id: recorderUserId,
        type,
        amount: cents,
        category_id: effectiveCategoryId,
        note: note || null,
        occurred_at: occurredAt.toISOString(),
      });

      // 记一笔后行为（§18.3.1）：继续记下一笔 → 清空金额/备注/分类、面板不关；否则保存即关。
      if (afterBehavior === 'continue') {
        setRaw('');
        setNote('');
        setCategoryId(null);
        toast.success('已保存，继续记下一笔');
      } else {
        // 庆祝交由父层在面板关闭后展示（onDismiss），这里只上报「是否家庭第一笔」并关闭面板。
        onSaved?.({ firstRecord: isFirstRecord });
        onClose();
      }
    } catch (e) {
      Alert.alert('保存失败', (e as Error).message ?? String(e));
    }
  };

  /** 单个分类圆底项（横滑与网格两种布局复用）。 */
  const renderCat = (c: Category, itemWidth: DimensionValue) => {
    const active = c.id === effectiveCategoryId;
    const color = catColors[categoryColorKey(c.name, type)];
    return (
      <Pressable key={c.id} style={[styles.catItem, { width: itemWidth }]} onPress={() => setCategoryId(c.id)}>
        <View
          style={[
            styles.catCircle,
            { backgroundColor: color, opacity: active ? 1 : 0.55 },
            active && { borderWidth: 2, borderColor: palette.textPrimary },
          ]}
        >
          <SymbolView name={categorySymbol(c.icon, type) as SymbolViewProps['name']} tintColor="#FFFFFF" size={22} />
        </View>
        <Text
          numberOfLines={1}
          style={{
            color: active ? palette.textPrimary : palette.textSecondary,
            fontSize: 12,
            fontWeight: active ? '600' : '400',
            maxWidth: 56,
          }}
        >
          {c.name}
        </Text>
      </Pressable>
    );
  };

  const divider = <View style={[styles.divider, { backgroundColor: palette.separator }]} />;

  // 详情卡（分类/备注/时间/记账人）。折叠态分类横滑；展开态仅分类网格在卡内纵向滚动，备注等字段始终可见。
  const detailCardNode = (
    <View style={[styles.detailCard, { backgroundColor: palette.card }, catExpanded && styles.detailCardExpanded]}>
      {/* 分类标题行 + 展开/收起 */}
      <View style={styles.catHeader}>
        <Text style={[styles.catHeaderLabel, { color: palette.textSecondary }]}>分类</Text>
        <Pressable style={styles.catToggle} hitSlop={8} onPress={() => setCatExpanded((v) => !v)}>
          <Text style={[styles.catToggleText, { color: palette.textSecondary }]}>{catExpanded ? '收起' : '展开'}</Text>
          <SymbolView name={catExpanded ? 'chevron.up' : 'chevron.down'} tintColor={palette.textSecondary} size={11} />
        </Pressable>
      </View>

      {/* 分类：折叠=横滑单行；展开=卡内 ScrollView 纵向网格（仅此区域滚动）。 */}
      <View
        style={catExpanded ? styles.catAreaExpanded : undefined}
        onLayout={(e) => setCatAreaW(e.nativeEvent.layout.width)}
      >
        {categoriesQ.isLoading ? (
          <View style={styles.catLoading}>
            <ActivityIndicator />
          </View>
        ) : catExpanded ? (
          <ScrollView
            style={styles.catScroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            <View style={styles.catGrid}>{categories.map((c) => renderCat(c, catItemW))}</View>
          </ScrollView>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.catRow}
            keyboardShouldPersistTaps="handled"
          >
            {categories.map((c) => renderCat(c, catItemW))}
          </ScrollView>
        )}
      </View>

      {divider}

      {/* 备注 */}
      <View style={styles.rowInner}>
        <SymbolView name="pencil" tintColor={palette.textTertiary} size={16} />
        <TextInput
          style={[styles.noteInput, { color: palette.textPrimary }]}
          placeholder="加个备注…"
          placeholderTextColor={palette.textTertiary}
          value={note}
          onChangeText={setNote}
          maxLength={50}
          returnKeyType="done"
        />
      </View>

      {divider}

      {/* 时间：原生 DatePicker（compact，点击弹原生日期/时间选择） */}
      <View style={styles.rowInner}>
        <SymbolView name="clock" tintColor={palette.textTertiary} size={16} />
        <Text style={[styles.infoLabel, { color: palette.textPrimary }]}>时间</Text>
        <View style={styles.rowSpacer} />
        <Host matchContents style={styles.dateHost}>
          <DatePicker
            selection={occurredAt}
            displayedComponents={['date', 'hourAndMinute']}
            onDateChange={setOccurredAt}
            modifiers={[datePickerStyle('compact'), labelsHidden()]}
          />
        </Host>
      </View>

      {/* 记账人：仅户主可选择 */}
      {showRecorder ? (
        <>
          {divider}
          <Pressable style={styles.rowInner} onPress={() => setMemberOpen(true)}>
            <SymbolView name="person.crop.circle" tintColor={palette.textTertiary} size={16} />
            <Text style={[styles.infoLabel, { color: palette.textPrimary }]}>记账人</Text>
            <View style={styles.rowSpacer} />
            <Text style={[styles.infoValue, { color: palette.textSecondary }]}>{recorderName}</Text>
            <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={13} />
          </Pressable>
        </>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      {/* 居中抓手（替代「取消」：拖拽 / 下滑收起，由 pageSheet 原生处理） */}
      <View style={styles.grabberWrap}>
        <View style={[styles.grabber, { backgroundColor: palette.separator }]} />
      </View>

      {/* 标题行：标题居中（删除入口走列表左滑，DESIGN §9.9：非保存动作不放标题两侧） */}
      <View style={styles.topBar}>
        <View style={styles.topActionSpacer} />
        <Text style={[styles.topTitle, { color: palette.textPrimary }]}>{editing ? '编辑流水' : '记一笔'}</Text>
        <View style={styles.topActionSpacer} />
      </View>

      {/* 支出 / 收入：iOS 原生分段控件（SwiftUI Picker.segmented） */}
      <Host style={styles.segmentHost}>
        <Picker
          modifiers={[pickerStyle('segmented')]}
          selection={type}
          onSelectionChange={(t) => setType(t as TxnType)}
        >
          <UIText modifiers={[tag('expense')]}>支出</UIText>
          <UIText modifiers={[tag('income')]}>收入</UIText>
        </Picker>
      </Host>

      {/* 大号金额（支出绿 / 收入红） */}
      <View style={styles.amountRow}>
        <Text style={[styles.amountSign, { color: amountColor }]}>{`${sign}¥`}</Text>
        <Text style={[styles.amountInt, { color: amountColor }]}>{parts.integer}</Text>
        {parts.hasDot ? <Text style={[styles.amountDec, { color: amountColor }]}>{`.${parts.decimal}`}</Text> : null}
      </View>

      {/* 详情卡：展开时外层弹性区 + 卡内分类滚动；折叠时随内容高度紧贴键盘 */}
      {catExpanded ? <View style={styles.middleFlex}>{detailCardNode}</View> : detailCardNode}

      {/* 自定义数字键盘：每个键独立成块（白底圆角 + 键间留白），近似 iOS 系统键盘的独立按键观感 */}
      <View style={styles.keypad}>
        {KEY_ROWS.map((row, ri) => (
          <View key={ri} style={styles.keyRow}>
            {row.map((k) => (
              <Pressable
                key={k}
                style={({ pressed }) => [styles.key, { backgroundColor: pressed ? palette.separator : palette.card }]}
                onPress={() => press(k)}
              >
                {k === '⌫' ? (
                  <SymbolView name="delete.left" tintColor={palette.textPrimary} size={24} />
                ) : (
                  <Text style={[styles.keyText, { color: palette.textPrimary }]}>{k}</Text>
                )}
              </Pressable>
            ))}
          </View>
        ))}
      </View>

      {/* 保存（金额 > 0 才可用），贴底展示 */}
      <Pressable
        disabled={!canSave}
        onPress={handleSave}
        style={[
          styles.save,
          // 贴底但留出 Home Indicator 的清空间（折叠态还会有少量余量落在按钮下方，整体不挡系统横条）。
          { backgroundColor: palette.ink, opacity: canSave ? 1 : 0.35, marginBottom: Space[6] },
        ]}
      >
        {saving ? (
          <ActivityIndicator color={palette.onInk} />
        ) : (
          <Text style={[styles.saveText, { color: palette.onInk }]}>保存</Text>
        )}
      </Pressable>

      {/* 记账人选择（底部 sheet） */}
      <MemberPickerSheet
        visible={showRecorder && memberOpen}
        members={members}
        selectedUserId={recorderUserId}
        onSelect={(uid) => {
          setRecorderUserId(uid);
          setMemberOpen(false);
        }}
        onClose={() => setMemberOpen(false)}
      />
    </View>
  );
}

/** 记账人选择：从底部弹出的成员列表（无「添加其它成员」入口）。 */
function MemberPickerSheet({
  visible,
  members,
  selectedUserId,
  onSelect,
  onClose,
}: {
  visible: boolean;
  members: FamilyMembership[];
  selectedUserId: string;
  onSelect: (userId: string) => void;
  onClose: () => void;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* 内层吞掉点击，避免点列表关弹层 */}
        <Pressable
          style={[styles.memberSheet, { backgroundColor: palette.elevated, paddingBottom: insets.bottom + Space[3] }]}
          onPress={() => {}}
        >
          <View style={[styles.grabber, { backgroundColor: palette.separator, marginTop: Space[2] }]} />
          <View style={styles.memberHeader}>
            <View style={styles.memberHeaderSide} />
            <Text style={[styles.memberTitle, { color: palette.textPrimary }]}>记账人</Text>
            <Pressable style={styles.memberHeaderSide} hitSlop={8} onPress={onClose}>
              <SymbolView name="xmark" tintColor={palette.textTertiary} size={16} />
            </Pressable>
          </View>
          {members.map((m) => {
            const active = m.userId === selectedUserId;
            return (
              <Pressable key={m.id} style={styles.memberRow} onPress={() => onSelect(m.userId)}>
                <SymbolView name="person.crop.circle.fill" tintColor={palette.textTertiary} size={32} />
                <Text style={[styles.memberName, { color: palette.textPrimary }]}>{m.nickname}</Text>
                <View style={styles.rowSpacer} />
                {active ? <SymbolView name="checkmark" tintColor={palette.info} size={18} /> : null}
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: Space[4], paddingTop: Space[2] },
  grabberWrap: { alignItems: 'center', paddingBottom: Space[1] },
  grabber: { width: 36, height: 5, borderRadius: Radius.full, alignSelf: 'center' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Space[1] },
  topAction: { fontSize: 16 },
  topActionRight: { width: 48, alignItems: 'flex-end' },
  topActionSpacer: { width: 48 },
  topTitle: { fontSize: 17, fontWeight: '600' },
  segmentHost: { height: 34, marginTop: Space[2] },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', paddingVertical: Space[5] },
  amountSign: { fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] },
  amountInt: { fontSize: 48, fontWeight: '700', fontVariant: ['tabular-nums'] },
  amountDec: { fontSize: 28, fontWeight: '400', fontVariant: ['tabular-nums'] },
  // 金额与键盘之间的弹性区；展开态详情卡填满此区，分类 ScrollView 在卡内滚动。
  middleFlex: { flex: 1, minHeight: 0 },
  detailCard: { borderRadius: Radius.lg, paddingHorizontal: Space[4] },
  detailCardExpanded: { flex: 1, minHeight: 0 },
  catHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Space[3],
    paddingBottom: Space[1],
  },
  catHeaderLabel: { fontSize: 13, fontWeight: '600' },
  catToggle: { flexDirection: 'row', alignItems: 'center', gap: Space[1] },
  catToggleText: { fontSize: 13 },
  catAreaExpanded: { flex: 1, minHeight: 0 },
  catScroll: { flex: 1 },
  catLoading: { height: 80, alignItems: 'center', justifyContent: 'center' },
  // 折叠横滑：不留 gap，让前 5 个正好铺满实测宽，位置与展开第一行完全一致（切换不跳）。
  catRow: { paddingVertical: Space[2] },
  // 展开网格：每行 5 个（itemW=实测宽/5），rowGap 保证 ≥3 行图标完整展示。
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: Space[3], paddingVertical: Space[2] },
  catItem: { alignItems: 'center', gap: Space[1] },
  catCircle: { width: 52, height: 52, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: Space[6] },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: Space[2], paddingVertical: Space[3], minHeight: 48 },
  noteInput: { flex: 1, fontSize: 15, padding: 0 },
  infoLabel: { fontSize: 15 },
  infoValue: { fontSize: 15 },
  rowSpacer: { flex: 1 },
  // matchContents 让 host 贴合原生 DatePicker 胶囊尺寸；minWidth/minHeight 仅作初次测量前的兜底。
  dateHost: { minWidth: 130, minHeight: 28 },
  // 键盘：独立按键（白底圆角 + 行/键间留白），近似 iOS 系统键盘。marginTop 即「分类卡↔键盘」间距，与金额上下间距一致（Space[5]）。
  keypad: { marginTop: Space[5], gap: Space[2] },
  keyRow: { flexDirection: 'row', gap: Space[2] },
  key: {
    flex: 1,
    height: 50,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 1 },
  },
  keyText: { fontSize: 26, fontWeight: '500', fontVariant: ['tabular-nums'] },
  save: { height: 50, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', marginTop: Space[3] },
  saveText: { fontSize: 17, fontWeight: '600' },
  // 记账人底部 sheet
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  memberSheet: {
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    paddingHorizontal: Space[4],
    alignItems: 'stretch',
  },
  memberHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Space[3],
  },
  memberHeaderSide: { width: 24, alignItems: 'flex-end' },
  memberTitle: { fontSize: 16, fontWeight: '600' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: Space[3], paddingVertical: Space[3] },
  memberName: { fontSize: 16, fontWeight: '500' },
});
