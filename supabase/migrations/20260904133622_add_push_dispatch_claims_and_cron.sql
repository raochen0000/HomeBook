-- 0051 · Supabase Edge Function push dispatcher: claims, settlement, and Cron
-- ---------------------------------------------------------------------------
-- A worker first claims rows with SKIP LOCKED, then calls Expo, then settles
-- only rows still owned by its claim token. This prevents overlapping Cron
-- invocations from delivering the same notification concurrently.

create extension if not exists pg_cron;
create extension if not exists pg_net;

alter table public.notifications
  add column if not exists push_claim_token uuid,
  add column if not exists push_claimed_at timestamptz;

create index if not exists notifications_push_unclaimed_due_idx
  on public.notifications (push_next_attempt_at nulls first, created_at)
  where channel = 'in_app'
    and pushed_at is null
    and push_claimed_at is null;

create index if not exists notifications_push_expired_claim_idx
  on public.notifications (push_claimed_at)
  where channel = 'in_app'
    and pushed_at is null
    and push_claimed_at is not null;

create or replace function public.claim_due_push_notifications(
  p_claim_token uuid,
  p_limit integer default 100
)
returns table (
  id uuid,
  user_id uuid,
  type text,
  payload jsonb,
  push_attempts smallint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_claim_token is null then
    raise exception 'claim token is required' using errcode = '22023';
  end if;

  return query
  with eligible as (
    select n.id
      from public.notifications n
     where n.channel = 'in_app'
       and n.pushed_at is null
       and (n.push_next_attempt_at is null or n.push_next_attempt_at <= now())
       and (
         n.push_claimed_at is null
         or n.push_claimed_at < now() - interval '10 minutes'
       )
     order by n.push_next_attempt_at nulls first, n.created_at
     limit least(greatest(coalesce(p_limit, 100), 1), 100)
     for update skip locked
  ), claimed as (
    update public.notifications n
       set push_claim_token = p_claim_token,
           push_claimed_at = now()
      from eligible e
     where n.id = e.id
     returning n.id, n.user_id, n.type, n.payload, n.push_attempts
  )
  select c.id, c.user_id, c.type, c.payload, c.push_attempts
    from claimed c;
end;
$$;

revoke all on function public.claim_due_push_notifications(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_due_push_notifications(uuid, integer) to service_role;

create or replace function public.finalize_push_notifications(
  p_claim_token uuid,
  p_notification_ids uuid[],
  p_outcome text,
  p_next_attempt_at timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_count integer;
begin
  if p_claim_token is null or coalesce(array_length(p_notification_ids, 1), 0) = 0 then
    raise exception 'claim token and notification ids are required' using errcode = '22023';
  end if;

  if p_outcome not in ('terminal', 'retry') then
    raise exception 'unsupported push outcome: %', p_outcome using errcode = '22023';
  end if;

  if p_outcome = 'retry' and p_next_attempt_at is null then
    raise exception 'retry requires next attempt time' using errcode = '22023';
  end if;

  update public.notifications n
     set pushed_at = case when p_outcome = 'terminal' then now() else n.pushed_at end,
         push_attempts = case
           when p_outcome = 'retry' then least(n.push_attempts + 1, 32767)::smallint
           else n.push_attempts
         end,
         push_next_attempt_at = case when p_outcome = 'retry' then p_next_attempt_at else null end,
         push_claim_token = null,
         push_claimed_at = null
   where n.id = any(p_notification_ids)
     and n.push_claim_token = p_claim_token;

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$$;

revoke all on function public.finalize_push_notifications(uuid, uuid[], text, timestamptz) from public, anon, authenticated;
grant execute on function public.finalize_push_notifications(uuid, uuid[], text, timestamptz) to service_role;

-- The two Vault values are created manually before this migration is applied:
--   homebook_project_url                  = https://<project-ref>.supabase.co
--   homebook_push_dispatch_cron_secret    = same value as Edge Function
--                                          PUSH_DISPATCH_CRON_SECRET
-- Never put either value in this migration or a committed env file.
do $schedule$
declare
  existing_job_id bigint;
begin
  select jobid
    into existing_job_id
    from cron.job
   where jobname = 'homebook-push-dispatch';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'homebook-push-dispatch',
    '*/10 * * * *',
    $job$
      select net.http_post(
        url := (
          select decrypted_secret
            from vault.decrypted_secrets
           where name = 'homebook_project_url'
        ) || '/functions/v1/push-dispatch',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-homebook-cron-secret', (
            select decrypted_secret
              from vault.decrypted_secrets
             where name = 'homebook_push_dispatch_cron_secret'
          )
        ),
        body := jsonb_build_object('scheduled_at', now()),
        timeout_milliseconds := 15000
      );
    $job$
  );
end;
$schedule$;
