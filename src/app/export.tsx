import { ComingSoon } from '@/features/settings/coming-soon';
import { t } from '@/i18n';

/** G11 导出数据（CSV → 系统分享）——依赖 expo-sharing，留待下一轮（需重建 dev client）。 */
export default function ExportScreen() {
  return <ComingSoon title={t('settings.export')} note={t('settings.exportSoon')} />;
}
