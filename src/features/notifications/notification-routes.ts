/** 通知跳转白名单：只接受 App 内已注册路由，绝不直接执行远端 payload 给出的 URL。 */
import type { Href } from 'expo-router';

import type { Notification } from '@/api';

type NotificationPayload = Record<string, unknown> | null;
const MONTH_PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

function payloadOf(value: unknown): NotificationPayload {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function summaryHref(period: unknown): Href {
  return typeof period === 'string' && MONTH_PERIOD.test(period)
    ? (`/summary?period=${period}` as Href)
    : ('/summary' as Href);
}

export function notificationHrefForItem(notification: Notification): Href {
  const payload = payloadOf(notification.payload);
  switch (notification.type) {
    case 'monthly_summary':
      return summaryHref(payload?.period);
    case 'goal_achieved':
    case 'transfer':
    case 'succession':
    case 'removed':
      return '/family' as Href;
    case 'budget_alert':
    default:
      return '/' as Href;
  }
}

/** Expo Push data 中允许的路由。即使 payload 被篡改，也只能落到这些安全目的地。 */
export function notificationHrefFromPushData(data: unknown): Href {
  const payload = payloadOf(data);
  if (payload?.url === '/' || payload?.url === '/family' || payload?.url === '/summary') return payload.url as Href;
  if (typeof payload?.url === 'string' && payload.url.startsWith('/summary?period=')) {
    return summaryHref(payload.url.slice('/summary?period='.length));
  }

  const type = typeof payload?.type === 'string' ? payload.type : '';
  if (type === 'monthly_summary') return summaryHref(payload?.period);
  if (type === 'goal_achieved' || type === 'transfer' || type === 'succession' || type === 'removed')
    return '/family' as Href;
  return '/' as Href;
}
