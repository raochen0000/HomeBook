/**
 * 用户协议 / 隐私政策 内容 Sheet（B2，PRD §3.6 / §18.3.8；DESIGN §9.9「内容型 Sheet」）。
 * 从底部弹出、内置静态内容（不外链）；顶部右上角有 X 关闭按钮，同时保留抓手下滑关闭。
 * 登录页与「关于家账」共用本组件（单一信源）。当前正文为占位文案，上架前替换为正式法务文本。
 */
import { SymbolView } from 'expo-symbols';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Radius, Space, usePalette } from '@/constants/design';

export type LegalKind = 'terms' | 'privacy';

const CHIP_FILL = 'rgba(120,120,128,0.16)';

const TITLES: Record<LegalKind, string> = { terms: '用户协议', privacy: '隐私政策' };

/** 占位正文（上架前替换为正式条款）。每段一个小标题 + 正文。 */
const SECTIONS: Record<LegalKind, { h: string; p: string }[]> = {
  terms: [
    { h: '一、服务范围', p: '家账为家庭提供共同记账与账本协作服务。使用本服务即表示你同意本协议全部条款。' },
    { h: '二、账号与家庭', p: '一个账号同时仅属于一个家庭；家庭数据归属于家庭，成员退出后历史记账保留在原家庭。' },
    { h: '三、用户行为', p: '你应对账号下的记账内容负责，不得利用本服务从事违法或侵害他人权益的行为。' },
    { h: '四、免责与变更', p: '我们会尽力保障服务稳定，但不对不可抗力导致的中断负责。协议更新将在应用内公示。' },
  ],
  privacy: [
    { h: '一、我们收集的信息', p: '为提供记账与登录服务，我们收集手机号 / 邮箱、昵称头像与你主动录入的记账数据。' },
    { h: '二、信息的使用', p: '收集的信息仅用于实现记账、家庭协作与账号安全，不用于与服务无关的用途。' },
    { h: '三、信息的共享', p: '家庭内记账数据在家庭成员间共享；除法律要求外，我们不向第三方提供你的个人信息。' },
    { h: '四、你的权利', p: '你可随时修改资料、导出或注销账号；注销后账号数据将被永久删除、不可恢复。' },
  ],
};

export function LegalSheet({ kind, onClose }: { kind: LegalKind | null; onClose: () => void }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const visible = kind !== null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* 上方遮罩区：点击关闭（背景消隐语义，DESIGN §9.9） */}
        <Pressable style={styles.scrim} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: palette.base, paddingBottom: insets.bottom + Space[4] }]}>
          <View style={[styles.grabber, { backgroundColor: palette.separator }]} />
          <View style={styles.header}>
            <ThemedText style={[styles.title, { color: palette.textPrimary }]}>{kind ? TITLES[kind] : ''}</ThemedText>
            {/* 右上角 X 关闭按钮（DESIGN §9.9 内容型 Sheet） */}
            <Pressable hitSlop={10} onPress={onClose} style={[styles.close, { backgroundColor: CHIP_FILL }]}>
              <SymbolView name="xmark" tintColor={palette.textSecondary} size={14} />
            </Pressable>
          </View>
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator>
            {(kind ? SECTIONS[kind] : []).map((s) => (
              <View key={s.h} style={styles.section}>
                <ThemedText style={[styles.h, { color: palette.textPrimary }]}>{s.h}</ThemedText>
                <ThemedText style={[styles.p, { color: palette.textSecondary }]}>{s.p}</ThemedText>
              </View>
            ))}
            <ThemedText style={[styles.note, { color: palette.textTertiary }]}>
              以上为占位条款示例，正式版本以上架前发布的法务文本为准。
            </ThemedText>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  scrim: { flex: 1 },
  sheet: {
    height: '82%',
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Space[5],
  },
  grabber: { width: 38, height: 5, borderRadius: Radius.full, alignSelf: 'center', marginTop: Space[2] },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Space[3],
  },
  title: { fontSize: 18, fontWeight: '600' },
  close: { width: 30, height: 30, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  bodyContent: { paddingBottom: Space[4] },
  section: { marginBottom: Space[5] },
  h: { fontSize: 16, fontWeight: '600', marginBottom: Space[2] },
  p: { fontSize: 15, lineHeight: 22 },
  note: { fontSize: 13, lineHeight: 20, marginTop: Space[2] },
});
