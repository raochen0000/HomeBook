-- 0053 · Grant the Edge push dispatcher only the table privileges it needs.
-- ---------------------------------------------------------------------------
-- `service_role` bypasses RLS but still requires explicit table privileges.
-- These grants are server-only: no anon/authenticated privileges are added or
-- changed, and existing RLS policies remain in force for client requests.

grant select on table public.notification_preferences to service_role;
grant select, delete on table public.device_tokens to service_role;
