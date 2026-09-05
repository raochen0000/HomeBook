import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.108.2";

type NotificationType =
  | "removed"
  | "transfer"
  | "succession"
  | "goal_achieved"
  | "budget_alert"
  | "monthly_summary";

type PreferenceCategory =
  | "family_activity"
  | "budget_alert"
  | "savings_progress"
  | "monthly_summary"
  | "member_change";

type JsonRecord = Record<string, unknown>;

type ClaimedNotification = {
  id: string;
  userId: string;
  type: NotificationType;
  payload: JsonRecord;
  pushAttempts: number;
};

type DeviceToken = {
  token: string;
  locale: "zh" | "en";
};

type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  sound: "default";
  data: {
    type: NotificationType;
    id: string;
    url: string;
  };
};

type MessageEntry = {
  notification: ClaimedNotification;
  token: string;
  message: ExpoPushMessage;
};

type AdminClient = SupabaseClient;

const TYPE_CATEGORY: Record<NotificationType, PreferenceCategory> = {
  removed: "member_change",
  transfer: "family_activity",
  succession: "family_activity",
  goal_achieved: "savings_progress",
  budget_alert: "budget_alert",
  monthly_summary: "monthly_summary",
};

const MAX_BATCH_SIZE = 100;
const EXPONENTIAL_RETRY_BASE_SECONDS = 60;
const MAX_RETRY_SECONDS = 60 * 60;

export default {
  fetch: withSupabase({ auth: "none" }, async (request, context) => {
    if (request.method !== "POST") {
      return Response.json({ error: "method_not_allowed" }, { status: 405 });
    }

    const expectedSecret = Deno.env.get("PUSH_DISPATCH_CRON_SECRET");
    const receivedSecret = request.headers.get("x-homebook-cron-secret");
    if (
      !expectedSecret || !receivedSecret ||
      !timingSafeEqual(receivedSecret, expectedSecret)
    ) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const admin = context.supabaseAdmin;
    const claimToken = crypto.randomUUID();
    const producedMonthly = await emitMonthlySummaries(admin);
    const claimed = await claimNotifications(admin, claimToken);

    if (claimed.length === 0) {
      return Response.json({
        producedMonthly,
        processed: 0,
        retried: 0,
        sent: 0,
        invalid: 0,
      });
    }

    const preferencesByUser = await loadPreferences(admin, claimed);
    const tokensByUser = await loadTokens(admin, claimed);
    const terminalIds: string[] = [];
    const failed = new Map<string, ClaimedNotification>();
    const messages: MessageEntry[] = [];

    for (const notification of claimed) {
      const category = TYPE_CATEGORY[notification.type];
      if (preferencesByUser.get(notification.userId)?.[category] === false) {
        terminalIds.push(notification.id);
        continue;
      }

      const tokens = tokensByUser.get(notification.userId) ?? [];
      if (tokens.length === 0) {
        terminalIds.push(notification.id);
        continue;
      }

      const url = notificationUrl(notification.type, notification.payload);
      for (const device of tokens) {
        const copy = describe(notification, device.locale);
        messages.push({
          notification,
          token: device.token,
          message: {
            to: device.token,
            title: copy.title,
            body: copy.body,
            sound: "default",
            data: { type: notification.type, id: notification.id, url },
          },
        });
      }
    }

    const invalidTokens = new Set<string>();
    let sent = 0;
    for (let index = 0; index < messages.length; index += MAX_BATCH_SIZE) {
      const chunk = messages.slice(index, index + MAX_BATCH_SIZE);
      try {
        const tickets = await sendExpoPush(chunk.map((entry) => entry.message));
        chunk.forEach((entry, ticketIndex) => {
          const ticket = tickets[ticketIndex];
          if (ticket?.status === "ok") {
            sent += 1;
          } else if (
            isRecord(ticket?.details) &&
            ticket.details.error === "DeviceNotRegistered"
          ) {
            invalidTokens.add(entry.token);
          } else {
            failed.set(entry.notification.id, entry.notification);
          }
        });
      } catch {
        for (const entry of chunk) {
          failed.set(entry.notification.id, entry.notification);
        }
      }
    }

    for (const notification of claimed) {
      if (
        !failed.has(notification.id) && !terminalIds.includes(notification.id)
      ) {
        terminalIds.push(notification.id);
      }
    }

    await deleteInvalidTokens(admin, invalidTokens);
    await finalizeTerminalNotifications(admin, claimToken, terminalIds);
    await finalizeRetryNotifications(admin, claimToken, failed);

    return Response.json({
      producedMonthly,
      processed: terminalIds.length,
      retried: failed.size,
      sent,
      invalid: invalidTokens.size,
    });
  }),
};

function timingSafeEqual(actual: string, expected: string): boolean {
  const actualBytes = new TextEncoder().encode(actual);
  const expectedBytes = new TextEncoder().encode(expected);
  if (actualBytes.length !== expectedBytes.length) return false;

  let difference = 0;
  for (let index = 0; index < actualBytes.length; index += 1) {
    difference |= actualBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}

async function emitMonthlySummaries(admin: AdminClient): Promise<number> {
  const { data, error } = await admin.rpc("emit_monthly_summary_notifications");
  if (error) {
    console.error("push_dispatch_monthly_summary_failed");
    return 0;
  }
  return typeof data === "number" ? data : 0;
}

async function claimNotifications(
  admin: AdminClient,
  claimToken: string,
): Promise<ClaimedNotification[]> {
  const { data, error } = await admin.rpc("claim_due_push_notifications", {
    p_claim_token: claimToken,
    p_limit: MAX_BATCH_SIZE,
  });
  if (error) throw new Error("push_dispatch_claim_failed");
  return parseClaimedNotifications(data);
}

async function loadPreferences(
  admin: AdminClient,
  notifications: ClaimedNotification[],
): Promise<Map<string, Partial<Record<PreferenceCategory, boolean>>>> {
  const userIds = [
    ...new Set(notifications.map((notification) => notification.userId)),
  ];
  const { data, error } = await admin
    .from("notification_preferences")
    .select(
      "user_id, family_activity, budget_alert, savings_progress, monthly_summary, member_change",
    )
    .in("user_id", userIds);
  if (error) throw new Error("push_dispatch_preferences_failed");

  const preferences = new Map<
    string,
    Partial<Record<PreferenceCategory, boolean>>
  >();
  for (const row of asRecords(data)) {
    const userId = asString(row.user_id);
    if (!userId) continue;
    preferences.set(userId, {
      family_activity: row.family_activity !== false,
      budget_alert: row.budget_alert !== false,
      savings_progress: row.savings_progress !== false,
      monthly_summary: row.monthly_summary !== false,
      member_change: row.member_change !== false,
    });
  }
  return preferences;
}

async function loadTokens(
  admin: AdminClient,
  notifications: ClaimedNotification[],
): Promise<Map<string, DeviceToken[]>> {
  const userIds = [
    ...new Set(notifications.map((notification) => notification.userId)),
  ];
  const { data, error } = await admin.from("device_tokens").select(
    "user_id, token, locale",
  ).in("user_id", userIds);
  if (error) throw new Error("push_dispatch_tokens_failed");

  const tokensByUser = new Map<string, DeviceToken[]>();
  for (const row of asRecords(data)) {
    const userId = asString(row.user_id);
    const token = asString(row.token);
    if (!userId || !token) continue;

    const tokens = tokensByUser.get(userId) ?? [];
    tokens.push({ token, locale: row.locale === "en" ? "en" : "zh" });
    tokensByUser.set(userId, tokens);
  }
  return tokensByUser;
}

async function sendExpoPush(
  messages: ExpoPushMessage[],
): Promise<JsonRecord[]> {
  const headers = new Headers({
    accept: "application/json",
    "content-type": "application/json",
  });
  const expoAccessToken = Deno.env.get("EXPO_ACCESS_TOKEN");
  if (expoAccessToken) {
    headers.set("authorization", `Bearer ${expoAccessToken}`);
  }

  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers,
    body: JSON.stringify(messages),
  });
  if (!response.ok) throw new Error("expo_push_request_failed");

  const body: unknown = await response.json();
  if (!isRecord(body)) throw new Error("expo_push_response_invalid");
  return asRecords(body.data);
}

async function deleteInvalidTokens(
  admin: AdminClient,
  tokens: Set<string>,
): Promise<void> {
  if (tokens.size === 0) return;
  const { error } = await admin.from("device_tokens").delete().in("token", [
    ...tokens,
  ]);
  if (error) throw new Error("push_dispatch_token_cleanup_failed");
}

async function finalizeTerminalNotifications(
  admin: AdminClient,
  claimToken: string,
  notificationIds: string[],
): Promise<void> {
  if (notificationIds.length === 0) return;
  await finalizeNotifications(
    admin,
    claimToken,
    notificationIds,
    "terminal",
    null,
  );
}

async function finalizeRetryNotifications(
  admin: AdminClient,
  claimToken: string,
  failed: Map<string, ClaimedNotification>,
): Promise<void> {
  const retriesByAttempt = new Map<number, string[]>();
  for (const notification of failed.values()) {
    const notificationIds = retriesByAttempt.get(notification.pushAttempts) ??
      [];
    notificationIds.push(notification.id);
    retriesByAttempt.set(notification.pushAttempts, notificationIds);
  }

  for (const [attempts, notificationIds] of retriesByAttempt) {
    const nextAttemptAt = new Date(
      Date.now() + retryDelaySeconds(attempts) * 1000,
    ).toISOString();
    await finalizeNotifications(
      admin,
      claimToken,
      notificationIds,
      "retry",
      nextAttemptAt,
    );
  }
}

async function finalizeNotifications(
  admin: AdminClient,
  claimToken: string,
  notificationIds: string[],
  outcome: "terminal" | "retry",
  nextAttemptAt: string | null,
): Promise<void> {
  const { data, error } = await admin.rpc("finalize_push_notifications", {
    p_claim_token: claimToken,
    p_notification_ids: notificationIds,
    p_outcome: outcome,
    p_next_attempt_at: nextAttemptAt,
  });
  if (error || data !== notificationIds.length) {
    throw new Error("push_dispatch_finalize_failed");
  }
}

function retryDelaySeconds(currentAttempts: number): number {
  return Math.min(
    EXPONENTIAL_RETRY_BASE_SECONDS * 2 ** Math.min(currentAttempts, 6),
    MAX_RETRY_SECONDS,
  );
}

function parseClaimedNotifications(value: unknown): ClaimedNotification[] {
  const claimed: ClaimedNotification[] = [];
  for (const row of asRecords(value)) {
    const id = asString(row.id);
    const userId = asString(row.user_id);
    const type = asNotificationType(row.type);
    if (!id || !userId || !type) {
      throw new Error("push_dispatch_claim_payload_invalid");
    }
    claimed.push({
      id,
      userId,
      type,
      payload: isRecord(row.payload) ? row.payload : {},
      pushAttempts: asNonNegativeInteger(row.push_attempts),
    });
  }
  return claimed;
}

function describe(
  notification: ClaimedNotification,
  locale: "zh" | "en",
): { title: string; body: string } {
  const payload = notification.payload;
  const isEnglish = locale === "en";
  const familyName = asString(payload.family_name) ??
    (isEnglish ? "the family" : "家庭");
  const quotedFamily = familyName === "家庭" || familyName === "the family"
    ? familyName
    : `「${familyName}」`;

  switch (notification.type) {
    case "removed":
      if (payload.reason === "dissolved") {
        return isEnglish
          ? {
            title: "Family dissolved",
            body: `${quotedFamily} was dissolved by the owner`,
          }
          : { title: "家庭已解散", body: `${quotedFamily}已被户主解散` };
      }
      return isEnglish
        ? {
          title: "You were removed",
          body: `You were removed from ${quotedFamily}`,
        }
        : { title: "你已被移出家庭", body: `你已被移出${quotedFamily}` };
    case "transfer": {
      if (payload.new_owner_user_id === notification.userId) {
        return isEnglish
          ? {
            title: "Owner changed",
            body: `You are now the owner of ${quotedFamily}`,
          }
          : { title: "户主变更", body: `你已成为${quotedFamily}的户主` };
      }
      const ownerName = asString(payload.new_owner_name) ??
        (isEnglish ? "A family member" : "一位家庭成员");
      return isEnglish
        ? {
          title: "Owner changed",
          body: `${ownerName} is now the owner of ${quotedFamily}`,
        }
        : {
          title: "户主变更",
          body: `${ownerName}已成为${quotedFamily}的户主`,
        };
    }
    case "succession":
      return isEnglish
        ? {
          title: "Owner succession",
          body: "Someone requested to become the owner",
        }
        : { title: "户主继任", body: "有成员发起了户主继任申请" };
    case "goal_achieved": {
      const goalName = asString(payload.goal_name) ??
        (isEnglish ? "A savings goal" : "一个储蓄目标");
      return isEnglish
        ? { title: "Savings goal reached", body: `${goalName} is complete 🎉` }
        : { title: "储蓄目标达成", body: `${goalName}已达成 🎉` };
    }
    case "budget_alert":
      return isEnglish
        ? { title: "Budget alert", body: "This month’s budget needs attention" }
        : {
          title: "预算预警",
          body: asString(payload.text) ?? "本月预算需要关注",
        };
    case "monthly_summary": {
      const period = asString(payload.period) ??
        (isEnglish ? "last month" : "上月");
      return isEnglish
        ? {
          title: "Monthly recap",
          body: `The ${period} household recap is ready`,
        }
        : { title: "月度总结", body: `${period}的家庭总结已生成` };
    }
  }
}

function notificationUrl(type: NotificationType, payload: JsonRecord): string {
  const period = asString(payload.period);
  if (type === "monthly_summary") {
    return period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period)
      ? `/summary?period=${period}`
      : "/summary";
  }
  return type === "goal_achieved" || type === "transfer" ||
      type === "succession" || type === "removed"
    ? "/family"
    : "/";
}

function asRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

function asNotificationType(value: unknown): NotificationType | null {
  return typeof value === "string" && value in TYPE_CATEGORY
    ? (value as NotificationType)
    : null;
}

export { describe, notificationUrl, retryDelaySeconds, timingSafeEqual };
