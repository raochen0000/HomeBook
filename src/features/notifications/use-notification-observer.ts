/** 根级推送响应观察：前台展示横幅；点按通知（含冷启动）只跳转到白名单内的 App 路由。 */
import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { getNotifications } from './expo-notifications-safe';
import { notificationHrefFromPushData } from './notification-routes';

function responseData(response: unknown): unknown {
  if (!response || typeof response !== 'object') return null;
  const notification = (response as { notification?: { request?: { content?: { data?: unknown } } } }).notification;
  return notification?.request?.content?.data ?? null;
}

export function useNotificationObserver(enabled: boolean) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
    const N = getNotifications();
    if (!N) return;

    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });

    const openResponse = (response: unknown) => router.push(notificationHrefFromPushData(responseData(response)));
    // 冷启动场景：Expo 会保留最近一次点按响应，消费后清掉以免下次启动重复跳转。
    try {
      const last = N.getLastNotificationResponse();
      if (last) {
        openResponse(last);
        N.clearLastNotificationResponse();
      }
    } catch {
      // 原生模块或旧 runtime 的兼容降级：常规 listener 仍可工作。
    }
    const subscription = N.addNotificationResponseReceivedListener(openResponse);
    return () => subscription.remove();
  }, [enabled, router]);
}
