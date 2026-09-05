-- 0054 · Reassert the approved two-minute push dispatcher cadence.
-- ---------------------------------------------------------------------------
-- Migration 0052 introduced the two-minute cadence. This follow-up restores
-- it in Cloud after an out-of-band schedule change, so replayed migrations and
-- the live project have the same final state.

do $schedule$
declare
  existing_job_id bigint;
begin
  select jobid
    into existing_job_id
    from cron.job
   where jobname = 'homebook-push-dispatch';

  if existing_job_id is null then
    raise exception 'homebook-push-dispatch Cron job is missing';
  end if;

  perform cron.unschedule(existing_job_id);

  perform cron.schedule(
    'homebook-push-dispatch',
    '*/2 * * * *',
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
