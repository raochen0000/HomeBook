import { Platform, type TextStyle, type ViewStyle } from 'react-native';

export const singleLineTextInputStyle: TextStyle & ViewStyle = {
  flex: 1,
  height: '100%',
  fontSize: 16,
  lineHeight: 20,
  paddingTop: 0,
  paddingBottom: 0,
  paddingVertical: 0,
  ...(Platform.OS === 'android'
    ? {
        includeFontPadding: false,
        textAlignVertical: 'center',
      }
    : null),
};
