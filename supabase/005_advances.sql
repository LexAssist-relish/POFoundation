-- =====================================================================
-- P O Foundation — Advances ("Pending Settlement")
-- Bejoy requests an advance → approved → paid to his UPI → he settles it
-- by recording the bills he pays (each one is Paid immediately).
-- Run AFTER 004_contributions.sql. Safe to re-run.
-- =====================================================================

-- UPI ID for people who receive advances / reimbursements
alter table public.profiles add column if not exists upi_id text;
update public.profiles set upi_id = 'bejoys0808-2@okicici' where username = 'bejoy' and upi_id is null;

create sequence if not exists public.advance_serial_seq;

create table if not exists public.advances (
  id              uuid primary key default gen_random_uuid(),
  serial          text unique,
  project_id      uuid not null references public.projects(id),
  requested_by    uuid not null references public.profiles(id) default auth.uid(),
  purpose         text not null,
  amount          numeric(12,2) not null check (amount > 0),        -- as requested
  approved_amount numeric(12,2),
  status          text not null default 'requested'
                  check (status in ('requested','query','approved','paid','rejected','closed')),
  payer_id        uuid references public.profiles(id),
  approver_note   text,
  approved_by     uuid references public.profiles(id),
  approved_at     timestamptz,
  paid_from       uuid references public.funds(id),                  -- null = payer's own money
  paid_amount     numeric(12,2),
  payment_mode    text check (payment_mode in ('upi','bank','cash')),
  payment_ref     text,
  paid_at         timestamptz,
  paid_by         uuid references public.profiles(id),
  returned_amount numeric(12,2) not null default 0,                  -- unspent money given back
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists advances_project_idx on public.advances(project_id, created_at desc);

-- Bills settled against an advance
alter table public.expenses add column if not exists advance_id uuid references public.advances(id);

-- Attachments and history can belong to an advance too
alter table public.attachments alter column expense_id drop not null;
alter table public.attachments add column if not exists advance_id uuid references public.advances(id) on delete cascade;
alter table public.activity add column if not exists advance_id uuid references public.advances(id) on delete cascade;
create index if not exists attachments_advance_idx on public.attachments(advance_id);

create or replace function public.log_advance(p_adv uuid, p_action text, p_details jsonb)
returns void language sql security definer set search_path = public as $$
  insert into activity(advance_id, actor, action, details) values (p_adv, auth.uid(), p_action, p_details);
$$;

-- ---------- New advance ----------
create or replace function public.trg_advance_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not (has_role('inputter') or has_role('admin')) then raise exception 'Not allowed to request advances'; end if;
  new.serial := 'ADV-' || lpad(nextval('advance_serial_seq')::text, 3, '0');
  new.status := 'requested';
  new.requested_by := auth.uid();
  new.approved_amount := null; new.payer_id := null; new.paid_amount := null; new.paid_at := null;
  new.paid_by := null; new.paid_from := null; new.returned_amount := 0;
  return new;
end $$;
drop trigger if exists advance_before_insert on public.advances;
create trigger advance_before_insert before insert on public.advances
  for each row execute function public.trg_advance_before_insert();

create or replace function public.trg_advance_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform log_advance(new.id, 'requested', jsonb_build_object('amount', new.amount, 'purpose', new.purpose));
  return new;
end $$;
drop trigger if exists advance_after_insert on public.advances;
create trigger advance_after_insert after insert on public.advances
  for each row execute function public.trg_advance_after_insert();

-- Requester edits while Requested / Query (goes back to Requested)
create or replace function public.edit_advance(p_id uuid, p_amount numeric, p_purpose text)
returns void language plpgsql security definer set search_path = public as $$
declare a advances;
begin
  select * into a from advances where id = p_id for update;
  if not ((a.requested_by = auth.uid() and a.status in ('requested','query')) or (has_role('admin') and a.status in ('requested','query','approved'))) then
    raise exception 'This advance can no longer be edited';
  end if;
  update advances set amount = p_amount, purpose = p_purpose,
    status = case when status = 'query' then 'requested' else status end, updated_at = now() where id = p_id;
  perform log_advance(p_id, 'edited', jsonb_build_object('from', a.amount, 'to', p_amount));
end $$;

create or replace function public.approve_advance(p_id uuid, p_amount numeric, p_payer uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare a advances;
begin
  if not has_role('approver') then raise exception 'Only approvers can approve'; end if;
  select * into a from advances where id = p_id for update;
  if a.status not in ('requested','query','approved') then raise exception 'Advance is %', a.status; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  if not exists (select 1 from profiles where id = p_payer and active and 'payer' = any(roles)) then raise exception 'Choose a valid payer'; end if;
  update advances set status = 'approved', approved_amount = p_amount, payer_id = p_payer, approver_note = p_note,
    approved_by = auth.uid(), approved_at = now(), updated_at = now() where id = p_id;
  perform log_advance(p_id, 'approved', jsonb_build_object('requested', a.amount, 'approved', p_amount,
    'payer', (select full_name from profiles where id = p_payer), 'note', p_note));
end $$;

create or replace function public.return_advance_request(p_id uuid, p_action text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare a advances;
begin
  if not has_role('approver') then raise exception 'Only approvers can do this'; end if;
  if p_action not in ('query','rejected') then raise exception 'Bad action'; end if;
  select * into a from advances where id = p_id for update;
  if a.status not in ('requested','query','approved') then raise exception 'Advance is %', a.status; end if;
  update advances set status = p_action, approver_note = p_note, approved_by = auth.uid(),
    payer_id = null, approved_amount = null, updated_at = now() where id = p_id;
  perform log_advance(p_id, p_action, jsonb_build_object('note', p_note));
end $$;

create or replace function public.mark_advance_paid(p_id uuid, p_mode text, p_ref text, p_amount numeric, p_from uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a advances;
begin
  select * into a from advances where id = p_id for update;
  if a.status <> 'approved' then raise exception 'Only approved advances can be paid (this is %)', a.status; end if;
  if not (a.payer_id = auth.uid() or has_role('admin')) then raise exception 'Only the assigned payer can record this'; end if;
  update advances set status = 'paid', payment_mode = p_mode, payment_ref = nullif(trim(p_ref), ''),
    paid_amount = coalesce(p_amount, a.approved_amount), paid_at = now(), paid_by = auth.uid(),
    paid_from = p_from, updated_at = now() where id = p_id;
  perform log_advance(p_id, 'paid', jsonb_build_object('mode', p_mode, 'ref', p_ref, 'amount', coalesce(p_amount, a.approved_amount),
    'from', coalesce((select name from funds where id = p_from), 'own money')));
end $$;

create or replace function public.revert_advance_payment(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare a advances;
begin
  select * into a from advances where id = p_id for update;
  if a.status <> 'paid' then raise exception 'Advance is not paid'; end if;
  if not (a.paid_by = auth.uid() or has_role('admin')) then raise exception 'Not allowed'; end if;
  if exists (select 1 from expenses where advance_id = p_id) then raise exception 'Bills are already settled against this advance'; end if;
  update advances set status = 'approved', payment_mode = null, payment_ref = null, paid_amount = null,
    paid_at = null, paid_by = null, paid_from = null, updated_at = now() where id = p_id;
  perform log_advance(p_id, 'payment_reverted', jsonb_build_object('note', p_note));
end $$;

-- Unspent advance given back (by the requester, or recorded by an admin)
create or replace function public.record_advance_return(p_id uuid, p_amount numeric, p_mode text, p_ref text)
returns void language plpgsql security definer set search_path = public as $$
declare a advances;
begin
  select * into a from advances where id = p_id for update;
  if a.status not in ('paid','closed') then raise exception 'Advance is not paid yet'; end if;
  if not (a.requested_by = auth.uid() or has_role('admin')) then raise exception 'Not allowed'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  update advances set returned_amount = returned_amount + p_amount, updated_at = now() where id = p_id;
  perform log_advance(p_id, 'returned', jsonb_build_object('amount', p_amount, 'mode', p_mode, 'ref', p_ref));
end $$;

-- Close an advance once fully settled (or admin closes it)
create or replace function public.close_advance(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare a advances;
begin
  select * into a from advances where id = p_id for update;
  if a.status <> 'paid' then raise exception 'Advance is %', a.status; end if;
  if not (a.requested_by = auth.uid() or has_role('admin')) then raise exception 'Not allowed'; end if;
  update advances set status = 'closed', updated_at = now() where id = p_id;
  perform log_advance(p_id, 'closed', jsonb_build_object('note', p_note));
end $$;

-- ---------- Bills: "I paid this" (from an advance, or from money given to me) are Paid immediately ----------
create or replace function public.trg_expense_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare a advances;
begin
  new.serial := 'POF-' || lpad(nextval('expense_serial_seq')::text, 4, '0');
  new.submitted_by := auth.uid();
  new.approved_amount := null; new.payer_id := null; new.paid_at := null; new.paid_amount := null;
  new.paid_by := null; new.paid_from := null;
  new.status := 'submitted';

  if new.advance_id is not null then
    select * into a from advances where id = new.advance_id;
    if not found or not (a.requested_by = auth.uid() or has_role('admin')) then raise exception 'That advance isn’t yours'; end if;
    if a.status <> 'paid' then raise exception 'That advance hasn’t been paid yet'; end if;
    new.status := 'paid'; new.approved_amount := new.amount; new.paid_amount := new.amount;
    new.payer_id := auth.uid(); new.paid_by := auth.uid(); new.paid_at := now();
    new.payment_mode := coalesce(new.payment_mode, 'upi'); new.prepaid_fund := null;
  elsif new.prepaid_fund is not null then
    if not public.can_record_fund(new.prepaid_fund) then raise exception 'You can only pay from money you hold'; end if;
    new.status := 'paid'; new.approved_amount := new.amount; new.paid_amount := new.amount;
    new.payer_id := auth.uid(); new.paid_by := auth.uid(); new.paid_at := now();
    new.paid_from := new.prepaid_fund; new.payment_mode := coalesce(new.payment_mode, 'upi');
  else
    new.payment_mode := null; new.payment_ref := null;
  end if;
  return new;
end $$;

create or replace function public.trg_expense_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform log_activity(new.id, 'submitted', jsonb_build_object('amount', new.amount));
  if new.status = 'paid' then
    perform log_activity(new.id, 'paid', jsonb_build_object('mode', new.payment_mode, 'ref', new.payment_ref, 'amount', new.amount,
      'from', coalesce((select serial from advances where id = new.advance_id), (select name from funds where id = new.paid_from)),
      'settled', true));
  end if;
  return new;
end $$;

-- A failed / wrong settlement can be undone; it no longer counts against the advance
create or replace function public.revert_payment(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare e expenses;
begin
  select * into e from expenses where id = p_id for update;
  if e.status <> 'paid' then raise exception 'Expense is not paid'; end if;
  if not (e.paid_by = auth.uid() or e.payer_id = auth.uid() or has_role('admin')) then raise exception 'Not allowed'; end if;
  update expenses set status = 'approved', payment_mode = null, payment_ref = null, paid_amount = null,
    paid_at = null, paid_by = null, paid_from = null, prepaid_fund = null, advance_id = null,
    payer_id = coalesce(payer_id, e.paid_by), updated_at = now() where id = p_id;
  perform log_activity(p_id, 'payment_reverted', jsonb_build_object('note', p_note, 'old_ref', e.payment_ref));
end $$;

-- ---------- RLS ----------
alter table public.advances enable row level security;
drop policy if exists advances_read on public.advances;
create policy advances_read on public.advances for select to authenticated using (public.is_member());
drop policy if exists advances_insert on public.advances;
create policy advances_insert on public.advances for insert to authenticated
  with check (public.has_role('inputter') or public.has_role('admin'));
drop policy if exists advances_delete on public.advances;
create policy advances_delete on public.advances for delete to authenticated
  using ((requested_by = auth.uid() and status in ('requested','query','rejected')) or (public.has_role('admin') and status <> 'paid' and status <> 'closed'));
-- no UPDATE policy: changes go through the functions above

-- People can remove a bill they recorded as already paid (to fix a mistake)
drop policy if exists expenses_delete on public.expenses;
create policy expenses_delete on public.expenses for delete to authenticated
  using (public.has_role('admin')
         or (submitted_by = auth.uid() and (status in ('submitted','query') or advance_id is not null or prepaid_fund is not null)));

-- ---------- Realtime ----------
do $$ begin
  begin alter publication supabase_realtime add table public.advances; exception when others then null; end;
end $$;

select 'advances ready' as status, (select upi_id from public.profiles where username = 'bejoy') as bejoy_upi;
