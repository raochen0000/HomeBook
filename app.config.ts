import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * 生产包不得绕过 iOS App Transport Security。
 *
 * 本地自托管后端尚在 HTTP 联调时，可在重建 development client 前显式设置
 * APP_VARIANT=development。这个例外绝不会进入 preview / production 的 EAS 构建。
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const infoPlist = { ...(config.ios?.infoPlist ?? {}) };
  delete infoPlist.NSAppTransportSecurity;

  if (process.env.APP_VARIANT === 'development') {
    infoPlist.NSAppTransportSecurity = { NSAllowsArbitraryLoads: true };
  }

  return {
    ...config,
    ios: {
      ...config.ios,
      infoPlist,
    },
  } as ExpoConfig;
};
