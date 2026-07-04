/**
 * 安全加载 expo-notifications。原生模块缺席时（例如加了依赖但没重编的旧 dev client），
 * 直接 `import 'expo-notifications'` 会在模块求值期抛 'Cannot find native module' 把整个 App
 * 拖成红屏（expo-notifications 内部用 requireNativeModule，缺席即抛）。
 *
 * 这里改为**惰性 require + try/catch**：把求值推迟到真正用到时、并能被兜住（静态 import 做不到）。
 * 缺席则返回 null，调用方降级（引导条退化为「去系统设置」、令牌注册整段跳过），而非崩溃。
 * 结果缓存，避免重复触发/重复抛错。
 */
type NotificationsModule = typeof import('expo-notifications');

let cached: NotificationsModule | null | undefined;

/** 取原生通知模块；缺席（旧包未重编）返回 null。 */
export function getNotifications(): NotificationsModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-notifications') as NotificationsModule;
  } catch {
    cached = null;
  }
  return cached;
}

/** 原生通知模块是否可用。 */
export function hasNativeNotifications(): boolean {
  return getNotifications() != null;
}
