import { Image, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { usePalette } from '@/constants/design';

/** 冷启动品牌页：在本地 session 与主题偏好准备好前覆盖导航。 */
export function LaunchScreenOverlay() {
  const palette = usePalette();
  const { height } = useWindowDimensions();

  return (
    <View accessibilityViewIsModal style={[styles.root, { backgroundColor: palette.base }]}>
      <View style={[styles.brand, { transform: [{ translateY: -height * 0.095 }] }]}>
        <Image
          accessibilityLabel="家账图标"
          resizeMode="contain"
          source={require('@/assets/images/splash-icon.png')}
          style={styles.logo}
        />
        <Text accessibilityRole="header" style={[styles.name, { color: palette.textPrimary }]}>
          家账
        </Text>
        <Text style={[styles.slogan, { color: palette.textSecondary }]}>一家人的账，共同记录</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    elevation: 1000,
  },
  brand: {
    alignItems: 'center',
  },
  logo: {
    width: 200,
    height: 200,
  },
  name: {
    marginTop: 8,
    fontSize: 38,
    lineHeight: 46,
    fontWeight: '700',
  },
  slogan: {
    marginTop: 12,
    fontSize: 16,
    lineHeight: 24,
  },
});
