-- =====================================================================
-- P O Foundation — Money in (contributions) and the accounts it sits in.
-- Run AFTER schema.sql, 002 and 003. Safe to re-run.
-- =====================================================================

-- ---------- Accounts that hold the money ("funds") ----------
create table if not exists public.funds (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null,
  holder      uuid references public.profiles(id),   -- person who holds this money
  is_default  boolean not null default false,        -- used for payments unless changed
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  unique (project_id, name)
);

-- ---------- Money in ----------
create table if not exists public.contributions (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  fund_id        uuid not null references public.funds(id),
  contributor    text not null,                       -- relative's name (need not be an app user)
  contributor_id uuid references public.profiles(id), -- set when the contributor is an app user
  amount         numeric(12,2) not null check (amount > 0),
  status         text not null default 'received' check (status in ('pledged','received')),
  received_on    date,
  mode           text check (mode in ('upi','bank','cash','cheque')),
  reference      text,                                -- UTR / cheque no.
  note           text,
  proof_path     text,                                -- screenshot in storage bucket pof-docs
  proof_mime     text,
  recorded_by    uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists contributions_project_idx on public.contributions(project_id, received_on desc);

-- ---------- Money out: which account paid each bill ----------
alter table public.expenses add column if not exists paid_from    uuid references public.funds(id); -- null = payer's own money
alter table public.expenses add column if not exists prepaid_fund uuid references public.funds(id); -- bill already paid by the person who entered it

-- ---------- Who may see where the money came from ----------
-- Some people (e.g. the groom) shouldn't see who contributed. They still see their own account's entries.
alter table public.profiles add column if not exists hide_money_sources boolean not null default false;
update public.profiles set hide_money_sources = true where username = 'bejoy';

create or replace function public.sees_money_sources() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active and not hide_money_sources);
$$;

-- ---------- Helper ----------
create or replace function public.can_record_fund(p_fund uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('admin') or exists (select 1 from funds where id = p_fund and holder = auth.uid());
$$;

-- ---------- RLS ----------
alter table public.funds enable row level security;
alter table public.contributions enable row level security;

drop policy if exists funds_read on public.funds;
create policy funds_read on public.funds for select to authenticated using (public.is_member());
drop policy if exists funds_admin on public.funds;
create policy funds_admin on public.funds for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

drop policy if exists contributions_read on public.contributions;
create policy contributions_read on public.contributions for select to authenticated
  using (public.is_member() and (public.sees_money_sources() or exists
    (select 1 from public.funds f where f.id = fund_id and f.holder = auth.uid())));
drop policy if exists contributions_insert on public.contributions;
create policy contributions_insert on public.contributions for insert to authenticated
  with check (public.can_record_fund(fund_id));
drop policy if exists contributions_update on public.contributions;
create policy contributions_update on public.contributions for update to authenticated
  using (public.can_record_fund(fund_id)) with check (public.can_record_fund(fund_id));
drop policy if exists contributions_delete on public.contributions;
create policy contributions_delete on public.contributions for delete to authenticated
  using (public.can_record_fund(fund_id));

-- ---------- New bills: "already paid" only from a fund you hold ----------
create or replace function public.trg_expense_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.serial := 'POF-' || lpad(nextval('expense_serial_seq')::text, 4, '0');
  new.status := 'submitted';
  new.submitted_by := auth.uid();
  new.approved_amount := null; new.payer_id := null; new.paid_at := null; new.paid_amount := null;
  new.paid_by := null; new.paid_from := null;
  if new.prepaid_fund is not null and not public.can_record_fund(new.prepaid_fund) then
    raise exception 'You can only mark bills as already paid from money you hold';
  end if;
  if new.prepaid_fund is null then new.payment_mode := null; new.payment_ref := null; end if;
  return new;
end $$;

-- ---------- Approve: an already-paid bill goes straight to Paid ----------
create or replace function public.approve_expense(
  p_id uuid, p_amount numeric, p_payer uuid, p_category text, p_payee uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare e expenses;
begin
  if not has_role('approver') then raise exception 'Only approvers can approve'; end if;
  select * into e from expenses where id = p_id for update;
  if e.status not in ('submitted','query','approved') then raise exception 'Expense is %', e.status; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;

  if e.prepaid_fund is not null then
    update expenses set status = 'paid', approved_amount = p_amount,
      payer_id = e.submitted_by, paid_by = e.submitted_by, paid_from = e.prepaid_fund,
      paid_amount = p_amount, paid_at = coalesce(e.paid_at, now()),
      payment_mode = coalesce(e.payment_mode, 'upi'),
      category = coalesce(p_category, category), payee_id = coalesce(p_payee, payee_id),
      approver_note = p_note, approved_by = auth.uid(), approved_at = now(), updated_at = now()
    where id = p_id;
    perform log_activity(p_id, 'approved', jsonb_build_object('submitted_amount', e.amount, 'approved_amount', p_amount,
      'altered', p_amount <> e.amount, 'payer', (select full_name from profiles where id = e.submitted_by),
      'note', p_note, 'already_paid', true));
    perform log_activity(p_id, 'paid', jsonb_build_object('mode', coalesce(e.payment_mode, 'upi'), 'ref', e.payment_ref,
      'amount', p_amount, 'from', (select name from funds where id = e.prepaid_fund)));
    return;
  end if;

  if not exists (select 1 from profiles where id = p_payer and active and 'payer' = any(roles)) then
    raise exception 'Choose a valid payer';
  end if;
  update expenses set status = 'approved', approved_amount = p_amount, payer_id = p_payer,
    category = coalesce(p_category, category), payee_id = coalesce(p_payee, payee_id),
    approver_note = p_note, approved_by = auth.uid(), approved_at = now(), updated_at = now()
  where id = p_id;
  perform log_activity(p_id, case when e.status = 'approved' then 're-approved' else 'approved' end,
    jsonb_build_object('submitted_amount', e.amount, 'approved_amount', p_amount,
      'altered', p_amount <> coalesce(e.approved_amount, e.amount),
      'payer', (select full_name from profiles where id = p_payer), 'note', p_note));
end $$;

-- ---------- Pay: record which account the money came from ----------
drop function if exists public.mark_paid(uuid, text, text, numeric, timestamptz);
create or replace function public.mark_paid(
  p_id uuid, p_mode text, p_ref text, p_amount numeric, p_paid_at timestamptz, p_from uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare e expenses;
begin
  select * into e from expenses where id = p_id for update;
  if e.status <> 'approved' then raise exception 'Only approved expenses can be paid (this is %)', e.status; end if;
  if not (e.payer_id = auth.uid() or has_role('admin')) then
    raise exception 'Only the assigned payer can record this payment';
  end if;
  update expenses set status = 'paid', payment_mode = p_mode, payment_ref = nullif(trim(p_ref), ''),
    paid_amount = coalesce(p_amount, e.approved_amount), paid_at = coalesce(p_paid_at, now()),
    paid_by = auth.uid(), paid_from = p_from, updated_at = now() where id = p_id;
  perform log_activity(p_id, 'paid', jsonb_build_object('mode', p_mode, 'ref', p_ref,
    'amount', coalesce(p_amount, e.approved_amount),
    'mismatch', coalesce(p_amount, e.approved_amount) <> e.approved_amount,
    'from', coalesce((select name from funds where id = p_from), 'own money')));
end $$;

-- Failed payment also clears the account
create or replace function public.revert_payment(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare e expenses;
begin
  select * into e from expenses where id = p_id for update;
  if e.status <> 'paid' then raise exception 'Expense is not paid'; end if;
  if not (e.paid_by = auth.uid() or e.payer_id = auth.uid() or has_role('admin')) then raise exception 'Not allowed'; end if;
  update expenses set status = 'approved', payment_mode = null, payment_ref = null, paid_amount = null,
    paid_at = null, paid_by = null, paid_from = null, prepaid_fund = null,
    payer_id = coalesce(payer_id, e.paid_by), updated_at = now() where id = p_id;
  perform log_activity(p_id, 'payment_reverted', jsonb_build_object('note', p_note, 'old_ref', e.payment_ref));
end $$;

-- ---------- Realtime ----------
do $$ begin
  begin alter publication supabase_realtime add table public.contributions; exception when others then null; end;
end $$;

-- ---------- Seed the two accounts ----------
insert into public.funds (project_id, name, holder, is_default, sort)
select p.id, 'Disbursement account (Sherine)', (select id from public.profiles where username = 'sherine'), true, 1
from public.projects p where p.code = 'bejoy-marriage'
on conflict (project_id, name) do nothing;

insert into public.funds (project_id, name, holder, is_default, sort)
select p.id, 'With Bejoy (given directly)', (select id from public.profiles where username = 'bejoy'), false, 2
from public.projects p where p.code = 'bejoy-marriage'
on conflict (project_id, name) do nothing;

-- Payments Sherine already recorded came from the disbursement account
update public.expenses x set paid_from = f.id
from public.funds f
where f.is_default and x.status = 'paid' and x.paid_from is null
  and x.paid_by = (select id from public.profiles where username = 'sherine');

select name, (select full_name from public.profiles where id = holder) as held_by, is_default from public.funds order by sort;
