/**
 * 未登录时的锚点路由。账号注销 / 退出后 Stack.Protected 把已登录页从栈里摘掉，落到本页。
 * ToastHost 挂在登录页内，避免原生栈把根布局的提示盖住。
 */
import { Stack } from 'expo-router';
import { View } from 'react-native';

import { ToastHost } from '@/components/toast';
import { LoginScreen } from '@/features/auth/login-screen';

export default function LoginRoute() {
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false, animation: 'fade' }} />
      <LoginScreen />
      <ToastHost />
    </View>
  );
}
