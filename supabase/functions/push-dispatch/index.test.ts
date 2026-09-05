import {
  describe,
  notificationUrl,
  retryDelaySeconds,
  timingSafeEqual,
} from "./index.ts";

function assertEqual<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

Deno.test("push-dispatch uses bounded exponential retry delays", () => {
  assertEqual(retryDelaySeconds(0), 60);
  assertEqual(retryDelaySeconds(1), 120);
  assertEqual(retryDelaySeconds(6), 3600);
  assertEqual(retryDelaySeconds(20), 3600);
});

Deno.test("push-dispatch only creates summary deep links for valid periods", () => {
  assertEqual(
    notificationUrl("monthly_summary", { period: "2026-09" }),
    "/summary?period=2026-09",
  );
  assertEqual(
    notificationUrl("monthly_summary", { period: "2026-13" }),
    "/summary",
  );
  assertEqual(notificationUrl("transfer", {}), "/family");
});

Deno.test("push-dispatch keeps notification copy aligned with the existing transfer behavior", () => {
  const copy = describe(
    {
      id: "notification-id",
      userId: "new-owner-id",
      type: "transfer",
      payload: {
        family_name: "Home",
        new_owner_user_id: "new-owner-id",
      },
      pushAttempts: 0,
    },
    "en",
  );

  assertEqual(copy.title, "Owner changed");
  assertEqual(copy.body, "You are now the owner of 「Home」");
});

Deno.test("push-dispatch rejects a different Cron secret", () => {
  assertEqual(timingSafeEqual("same", "same"), true);
  assertEqual(timingSafeEqual("different", "same"), false);
  assertEqual(timingSafeEqual("short", "longer"), false);
});
