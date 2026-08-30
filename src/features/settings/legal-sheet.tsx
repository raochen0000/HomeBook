/**
 * 用户协议 / 隐私政策 内容 Sheet（B2，PRD §3.6 / §18.3.8；DESIGN §9.9「内容型 Sheet」）。
 * 系统 pageSheet（下滑关 + 系统抓手）承载纯阅读内容（不外链）；顶部右上角保留 X 关闭按钮。
 * 登录页与「关于家账」共用本组件（单一信源）。公开网页发布时须与本正文同步，并由运营者完成法律审核。
 */
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { t, useLocalePreference } from '@/i18n';
import { legalSections, type LegalKind } from '@/i18n/legal-copy';
import { PageSheet } from '@/components/page-sheet';
import { SHEET_CONTENT_TOP_PADDING, SheetHeader } from '@/components/sheet-header';
import { ThemedText } from '@/components/themed-text';
import { Space, useSheetPalette } from '@/constants/design';

export type { LegalKind };

export function LegalSheet({ kind, onClose }: { kind: LegalKind | null; onClose: () => void }) {
  // iOS 的 pageSheet 在拖拽关闭时会先触发 onRequestClose，再继续原生退出动画。
  // 保留最后打开的正文到 onDismiss，避免动画期间露出 Modal 默认的白色容器。
  const [presentedKind, setPresentedKind] = useState<LegalKind | null>(null);
  const displayedKind = kind ?? presentedKind;

  return (
    <PageSheet
      visible={kind !== null}
      onClose={() => {
        setPresentedKind(kind);
        onClose();
      }}
      onDismiss={() => {
        if (kind === null) setPresentedKind(null);
      }}
    >
      {displayedKind !== null ? <Body kind={displayedKind} /> : null}
    </PageSheet>
  );
}

function Body({ kind }: { kind: LegalKind }) {
  const palette = useSheetPalette();
  const { locale } = useLocalePreference();
  const title = kind === 'terms' ? t('legal.termsTitle') : t('legal.privacyTitle');
  const sections = legalSections(kind, locale);
  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.flex}>
        <SheetHeader title={title} />
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator>
          {sections.map((s) => (
            <View key={s.h} style={styles.section}>
              <ThemedText style={[styles.h, { color: palette.textPrimary }]}>{s.h}</ThemedText>
              <ThemedText style={[styles.p, { color: palette.textSecondary }]}>{s.p}</ThemedText>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  body: { flex: 1 },
  bodyContent: { paddingTop: SHEET_CONTENT_TOP_PADDING, paddingHorizontal: Space[6], paddingBottom: Space[6] },
  section: { marginBottom: Space[5] },
  h: { fontSize: 16, fontWeight: '600', marginBottom: Space[2] },
  p: { fontSize: 15, lineHeight: 22 },
  note: { fontSize: 13, lineHeight: 20, marginTop: Space[2] },
});
