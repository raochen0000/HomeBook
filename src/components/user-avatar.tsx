import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { avatarInitialFromNickname } from '@/lib/profile';

type UserAvatarProps = {
  avatarUrl: string | null | undefined;
  nickname: string;
  size: number;
};

/**
 * 用户头像：优先显示用户上传的照片；缺省时以昵称末字和固定的蓝紫渐变呈现。
 * 渐变固定，避免把颜色作为成员身份的唯一线索；昵称本身才是识别来源。
 */
export function UserAvatar({ avatarUrl, nickname, size }: UserAvatarProps) {
  const radius = size / 2;

  if (avatarUrl) {
    return (
      <Image
        source={avatarUrl}
        style={[styles.avatar, { width: size, height: size, borderRadius: radius }]}
        contentFit="cover"
        transition={120}
      />
    );
  }

  return (
    <View style={[styles.avatar, styles.fallback, { width: size, height: size, borderRadius: radius }]}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <LinearGradient id="user-avatar-gradient" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#B7CDEB" />
            <Stop offset="1" stopColor="#7885BF" />
          </LinearGradient>
        </Defs>
        <Rect width={size} height={size} rx={radius} ry={radius} fill="url(#user-avatar-gradient)" />
      </Svg>
      <Text
        style={[styles.initial, { fontSize: Math.round(size * 0.52), lineHeight: Math.round(size * 0.62) }]}
        maxFontSizeMultiplier={1.15}
      >
        {avatarInitialFromNickname(nickname)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { overflow: 'hidden' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  initial: { color: '#FFFFFF', fontWeight: '700', includeFontPadding: false },
});
