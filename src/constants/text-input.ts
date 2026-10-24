import { Platform, type TextStyle, type ViewStyle } from 'react-native';

/**
 * 单行 TextInput 的共享样式。
 * iOS 的 UITextField 一旦带上 lineHeight，就会使用按词换行的段落样式；
 * 字段约 52pt 高时，长邮箱会在框内折成两行。垂直居中交给系统控件。
 */
export const singleLineTextInputStyle: TextStyle & ViewStyle = {
  flex: 1,
  height: '100%',
  fontSize: 16,
  paddingTop: 0,
  paddingBottom: 0,
  paddingVertical: 0,
  ...(Platform.OS === 'android'
    ? {
        includeFontPadding: false,
        textAlignVertical: 'center',
        lineHeight: 20,
      }
    : null),
};
