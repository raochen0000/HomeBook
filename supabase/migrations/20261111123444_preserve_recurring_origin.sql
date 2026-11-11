-- Keep the origin on the transaction even when its recurring rule is deleted.
alter table public.transactions add column is_recurring boolean not null default false;

-- Recording provenance is not a user edit and must not replace edit metadata.
create function private.preserve_transaction_edit_metadata() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.is_recurring is distinct from old.is_recurring
    and (to_jsonb(new) - array['is_recurring', 'updated_at', 'last_editor_user_id'])
      = (to_jsonb(old) - array['is_recurring', 'updated_at', 'last_editor_user_id']) then
    new.updated_at := old.updated_at;
    new.last_editor_user_id := old.last_editor_user_id;
  end if;
  return new;
end;
$$;
revoke all on function private.preserve_transaction_edit_metadata() from public, anon, authenticated;
create trigger zzz_preserve_transaction_edit_metadata before update on public.transactions
for each row execute function private.preserve_transaction_edit_metadata();

update public.transactions t set is_recurring = true
where exists (select 1 from public.recurring_runs r where r.transaction_id = t.id);

create function private.mark_recurring_transaction() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.transaction_id is not null then
    update public.transactions set is_recurring = true where id = new.transaction_id;
  end if;
  return new;
end;
$$;
revoke all on function private.mark_recurring_transaction() from public, anon, authenticated;

create trigger mark_recurring_transaction
after insert or update of transaction_id on public.recurring_runs
for each row execute function private.mark_recurring_transaction();
