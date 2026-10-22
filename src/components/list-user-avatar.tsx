/**
 * 原生 List 行内头像。只用 SwiftUI，不经 RNHostView。
 *
 * List 测量行时会给出很大的提议高度。RNHostView 的 matchContents 按 UIView.bounds
 * 回写 SwiftUI frame，会把这一行拉满，头像跟着变形。这里用明确的宽高锁住尺寸。
 * 照片只接受本地 file://；远程地址由调用方先落到磁盘缓存，避免主线程同步读网络。
 * 无图时用昵称末字。底色是 UserAvatar 渐变两端的中点：Expo UI background 只接受纯色。
 * 修饰符顺序必须是 frame → 填色 → clipShape；clip 写在 background 前面时底会保持方形。
 */
import { Image, Text, ZStack } from '@expo/ui/swift-ui';
import {
  aspectRatio,
  background,
  clipShape,
  font,
  foregroundColor,
  frame,
  resizable,
  shapes,
} from '@expo/ui/swift-ui/modifiers';

import { avatarInitialFromNickname } from '@/lib/profile';

const FALLBACK_AVATAR_BG = '#98A9D5';

export function ListUserAvatar({ uri, nickname, size }: { uri: string | null; nickname: string; size: number }) {
  if (uri) {
    return (
      <Image
        uiImage={uri}
        modifiers={[
          resizable(),
          aspectRatio({ contentMode: 'fill' }),
          frame({ width: size, height: size }),
          clipShape('circle'),
        ]}
      />
    );
  }

  return (
    <ZStack
      alignment="center"
      modifiers={[
        frame({ width: size, height: size }),
        background(FALLBACK_AVATAR_BG, shapes.circle()),
        clipShape('circle'),
      ]}
    >
      <Text modifiers={[font({ size: Math.round(size * 0.52), weight: 'bold' }), foregroundColor('#FFFFFF')]}>
        {avatarInitialFromNickname(nickname)}
      </Text>
    </ZStack>
  );
}
