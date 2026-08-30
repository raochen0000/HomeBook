import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { DynamicColorIOS, Platform, useColorScheme } from 'react-native';

import { t, useLocalePreference } from '@/i18n';
import { Colors } from '@/constants/theme';

export default function AppTabs() {
  const scheme = useColorScheme();
  const { locale } = useLocalePreference();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];
  // NativeTabs 的 UITabBarAppearance 不一定会在 JS 外观切换时重建。
  // 用原生动态色让 UIKit 在深浅色 trait 改变时自行重新解析，避免当前项保留浅色的近黑而隐没。
  const tabColors =
    Platform.OS === 'ios'
      ? {
          background: DynamicColorIOS({ light: Colors.light.background, dark: Colors.dark.background }),
          active: DynamicColorIOS({ light: Colors.light.tabActive, dark: Colors.dark.tabActive }),
          inactive: DynamicColorIOS({ light: Colors.light.tabInactive, dark: Colors.dark.tabInactive }),
        }
      : {
          background: colors.background,
          active: colors.tabActive,
          inactive: colors.tabInactive,
        };

  return (
    <NativeTabs
      backgroundColor={tabColors.background}
      indicatorColor={colors.backgroundElement}
      iconColor={{ default: tabColors.inactive, selected: tabColors.active }}
      labelStyle={{
        default: { color: tabColors.inactive, fontSize: 11, fontWeight: '400' },
        selected: { color: tabColors.active, fontSize: 12, fontWeight: '600' },
      }}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label key={locale}>{t('tabs.home')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="report">
        <NativeTabs.Trigger.Label key={locale}>{t('tabs.report')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'chart.pie', selected: 'chart.pie.fill' }} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="family">
        <NativeTabs.Trigger.Label key={locale}>{t('tabs.family')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="mine">
        <NativeTabs.Trigger.Label key={locale}>{t('tabs.mine')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
