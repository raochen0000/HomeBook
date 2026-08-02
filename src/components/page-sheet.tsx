import { useState, type ReactNode } from 'react';
import { Modal, type ModalProps } from 'react-native';

import { useSheetPalette } from '@/constants/design';

type PageSheetProps = Omit<
  ModalProps,
  | 'animationType'
  | 'backdropColor'
  | 'children'
  | 'onDismiss'
  | 'onRequestClose'
  | 'onShow'
  | 'presentationStyle'
  | 'visible'
> & {
  visible: boolean;
  children: ReactNode;
  onClose: () => void;
  onDismiss?: () => void;
  onShow?: () => void;
};

/**
 * 原生 pageSheet 外壳：统一主题容器色，并在 UIKit 退出动画完成前保留内容。
 *
 * iOS 会在拖拽关闭的动画开始时通知 JS；若此时父组件立即把 `visible` 设为 false，
 * 普通 Modal 的条件子树会卸载，露出默认白色容器。调用方应始终传入内容节点，
 * 本组件仅在展示期间挂载它。
 */
export function PageSheet({ visible, children, onClose, onDismiss, onShow, ...props }: PageSheetProps) {
  const palette = useSheetPalette();
  const [hasDismissed, setHasDismissed] = useState(!visible);

  return (
    <Modal
      {...props}
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      backdropColor={palette.sheet}
      onRequestClose={onClose}
      onShow={() => {
        setHasDismissed(false);
        onShow?.();
      }}
      onDismiss={() => {
        setHasDismissed(true);
        onDismiss?.();
      }}
    >
      {visible || !hasDismissed ? children : null}
    </Modal>
  );
}
