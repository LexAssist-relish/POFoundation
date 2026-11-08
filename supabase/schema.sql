-- =====================================================================
-- P O Foundation — Payments module
-- First flow: "Bejoy John - Marriage"
-- Run once in Supabase → SQL Editor (new project). Safe to re-run.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Roles:  admin | approver | payer | inputter | viewer   (a user can hold several)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text unique not null check (username ~ '^[a-z0-9._-]{2,32}$'),
  full_name   text not null,
  relation    text,                       -- e.g. "Groom", "Uncle"
  phone       text,                       -- for WhatsApp nudges (91XXXXXXXXXX)
  roles       text[] not null default '{viewer}',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- A "project" = one payment flow of the Foundation. Future flows add rows here.
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  title       text not null,
  subtitle    text,
  event_date  date,
  status      text not null default 'active' check (status in ('active','closed')),
  created_at  timestamptz not null default now()
);

create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null,
  budget      numeric(12,2) not null default 0,
  sort        int not null default 0,
  unique (project_id, name)
);

create table if not exists public.payees (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  upi_id      text,
  phone       text,
  bank_note   text,                       -- A/c + IFSC as free text if no UPI
  category    text,
  notes       text,
  verified    boolean not null default false,  -- UPI ID checked by an admin
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create sequence if not exists public.expense_serial_seq;

create table if not exists public.expenses (
  id               uuid primary key default gen_random_uuid(),
  serial           text unique,
  project_id       uuid not null references public.projects(id),
  expense_date     date not null default current_date,
  payee_id         uuid references public.payees(id),
  category         text,
  description      text not null,
  amount           numeric(12,2) not null check (amount > 0),   -- as submitted
  approved_amount  numeric(12,2),                                -- as approved (may differ)
  status           text not null default 'submitted'
                   check (status in ('submitted','query','approved','paid','rejected')),
  payer_id         uuid references public.profiles(id),
  approver_note    text,
  payment_mode     text check (payment_mode in ('upi','bank','cash')),
  payment_ref      text,                  -- UTR / UPI txn id
  paid_amount      numeric(12,2),
  paid_at          timestamptz,
  paid_by          uuid references public.profiles(id),
  submitted_by     uuid not null references public.profiles(id) default auth.uid(),
  approved_by      uuid references public.profiles(id),
  approved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists expenses_project_idx on public.expenses(project_id, expense_date desc);
create index if not exists expenses_status_idx  on public.expenses(status);

create table if not exists public.attachments (
  id           uuid primary key default gen_random_uuid(),
  expense_id   uuid not null references public.expenses(id) on delete cascade,
  kind         text not null check (kind in ('bill','receipt','other')),
  path         text not null,             -- storage path in bucket pof-docs
  file_name    text,
  mime         text,
  uploaded_by  uuid references public.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists attachments_expense_idx on public.attachments(expense_id);

create table if not exists public.activity (
  id          bigserial primary key,
  expense_id  uuid references public.expenses(id) on delete cascade,
  actor       uuid references public.profiles(id),
  action      text not null,
  details     jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists activity_expense_idx on public.activity(expense_id, created_at);

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public.has_role(r text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active and r = any(roles));
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active);
$$;

create or replace function public.log_activity(p_expense uuid, p_action text, p_details jsonb)
returns void language sql security definer set search_path = public as $$
  insert into activity(expense_id, actor, action, details) values (p_expense, auth.uid(), p_action, p_details);
$$;

-- Serial POF-0001 and submit log
create or replace function public.trg_expense_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.serial := 'POF-' || lpad(nextval('expense_serial_seq')::text, 4, '0');
  new.status := 'submitted';
  new.submitted_by := auth.uid();
  new.approved_amount := null; new.payer_id := null; new.paid_at := null; new.paid_amount := null;
  return new;
end $$;
drop trigger if exists expense_before_insert on public.expenses;
create trigger expense_before_insert before insert on public.expenses
  for each row execute function public.trg_expense_before_insert();

create or replace function public.trg_expense_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform log_activity(new.id, 'submitted', jsonb_build_object('amount', new.amount));
  return new;
end $$;
drop trigger if exists expense_after_insert on public.expenses;
create trigger expense_after_insert after insert on public.expenses
  for each row execute function public.trg_expense_after_insert();

-- ---------------------------------------------------------------------
-- Workflow RPCs (all status changes go through these)
-- ---------------------------------------------------------------------

-- Inputter edits own entry while Submitted / Query (goes back to Submitted)
create or replace function public.edit_expense(
  p_id uuid, p_date date, p_payee uuid, p_category text, p_description text, p_amount numeric)
returns void language plpgsql security definer set search_path = public as $$
declare e expenses;
begin
  select * into e from expenses where id = p_id for update;
  if e is null then raise exception 'Expense not found'; end if;
  if not (has_role('admin') or (e.submitted_by = auth.uid() and e.status in ('submitted','query'))) then
    raise exception 'You cannot edit this expense now';
  end if;
  if e.status in ('paid') then raise exception 'Paid expenses cannot be edited'; end if;
  update expenses set expense_date = p_date, payee_id = p_payee, category = p_category,
    description = p_description, amount = p_amount,
    status = case when status = 'query' then 'submitted' else status end,
    updated_at = now()
  where id = p_id;
  perform log_activity(p_id, 'edited', jsonb_build_object(
    'from', jsonb_build_object('amount', e.amount, 'description', e.description, 'category', e.category),
    'to',   jsonb_build_object('amount', p_amount, 'description', p_description, 'category', p_category)));
end $$;

-- Approver approves (optionally altering amount/category/payee) and assigns a payer.
-- Also used to re-assign payer / change amount on an Approved-but-unpaid expense.
create or replace function public.approve_expense(
  p_id uuid, p_amount numeric, p_payer uuid, p_category text, p_payee uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare e expenses;
begin
  if not has_role('approver') then raise exception 'Only approvers can approve'; end if;
  select * into e from expenses where id = p_id for update;
  if e.status not in ('submitted','query','approved') then
    raise exception 'Expense is %', e.status;
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;
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

create or replace function public.return_expense(p_id uuid, p_action text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare e expenses;
begin
  if not has_role('approver') then raise exception 'Only approvers can do this'; end if;
  if p_action not in ('query','rejected') then raise exception 'Bad action'; end if;
  select * into e from expenses where id = p_id for update;
  if e.status not in ('submitted','query','approved') then raise exception 'Expense is %', e.status; end if;
  update expenses set status = p_action, approver_note = p_note, approved_by = auth.uid(),
    payer_id = null, approved_amount = null, updated_at = now() where id = p_id;
  perform log_activity(p_id, p_action, jsonb_build_object('note', p_note));
end $$;

-- Payer records payment (UPI / bank / cash). Receipt is attached separately.
create or replace function public.mark_paid(
  p_id uuid, p_mode text, p_ref text, p_amount numeric, p_paid_at timestamptz)
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
    paid_by = auth.uid(), updated_at = now() where id = p_id;
  perform log_activity(p_id, 'paid', jsonb_build_object('mode', p_mode, 'ref', p_ref,
    'amount', coalesce(p_amount, e.approved_amount),
    'mismatch', coalesce(p_amount, e.approved_amount) <> e.approved_amount));
end $$;

-- Failed / returned payment: back to Approved so it can be paid again.
create or replace function public.revert_payment(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare e expenses;
begin
  select * into e from expenses where id = p_id for update;
  if e.status <> 'paid' then raise exception 'Expense is not paid'; end if;
  if not (e.paid_by = auth.uid() or e.payer_id = auth.uid() or has_role('admin')) then
    raise exception 'Not allowed';
  end if;
  update expenses set status = 'approved', payment_mode = null, payment_ref = null,
    paid_amount = null, paid_at = null, paid_by = null, updated_at = now() where id = p_id;
  perform log_activity(p_id, 'payment_reverted', jsonb_build_object('note', p_note, 'old_ref', e.payment_ref));
end $$;

-- ---------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------
alter table public.profiles    enable row level security;
alter table public.projects    enable row level security;
alter table public.categories  enable row level security;
alter table public.payees      enable row level security;
alter table public.expenses    enable row level security;
alter table public.attachments enable row level security;
alter table public.activity    enable row level security;

do $$ declare t text; begin
  foreach t in array array['profiles','projects','categories','payees','expenses','attachments','activity'] loop
    execute format('drop policy if exists "%1$s_read" on public.%1$s', t);
    execute format('create policy "%1$s_read" on public.%1$s for select to authenticated using (public.is_member())', t);
  end loop;
end $$;

-- profiles: written only by the server API (service role). Nothing else here.

drop policy if exists projects_admin on public.projects;
create policy projects_admin on public.projects for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

drop policy if exists categories_admin on public.categories;
create policy categories_admin on public.categories for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

drop policy if exists payees_insert on public.payees;
create policy payees_insert on public.payees for insert to authenticated
  with check (public.has_role('admin') or public.has_role('approver') or public.has_role('inputter') or public.has_role('payer'));
drop policy if exists payees_update on public.payees;
create policy payees_update on public.payees for update to authenticated
  using (public.has_role('admin') or public.has_role('approver'));
drop policy if exists payees_delete on public.payees;
create policy payees_delete on public.payees for delete to authenticated
  using (public.has_role('admin') and not exists (select 1 from public.expenses x where x.payee_id = payees.id));

drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses for insert to authenticated
  with check (public.has_role('inputter') or public.has_role('admin'));
drop policy if exists expenses_delete on public.expenses;
create policy expenses_delete on public.expenses for delete to authenticated
  using (public.has_role('admin') or (submitted_by = auth.uid() and status in ('submitted','query')));
-- no UPDATE policy: changes go through the RPCs above

drop policy if exists attachments_insert on public.attachments;
create policy attachments_insert on public.attachments for insert to authenticated
  with check (public.has_role('admin') or public.has_role('inputter')
              or public.has_role('payer') or public.has_role('approver'));
drop policy if exists attachments_delete on public.attachments;
create policy attachments_delete on public.attachments for delete to authenticated
  using (public.has_role('admin') or uploaded_by = auth.uid());

-- ---------------------------------------------------------------------
-- Storage: private bucket for bills & receipts
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('pof-docs', 'pof-docs', false)
  on conflict (id) do nothing;

drop policy if exists pof_docs_read on storage.objects;
create policy pof_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'pof-docs' and public.is_member());
drop policy if exists pof_docs_write on storage.objects;
create policy pof_docs_write on storage.objects for insert to authenticated
  with check (bucket_id = 'pof-docs' and public.is_member());
drop policy if exists pof_docs_delete on storage.objects;
create policy pof_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'pof-docs' and (public.has_role('admin') or owner = auth.uid()));

-- ---------------------------------------------------------------------
-- Realtime (live updates on every phone)
-- ---------------------------------------------------------------------
do $$ begin
  begin alter publication supabase_realtime add table public.expenses;    exception when others then null; end;
  begin alter publication supabase_realtime add table public.attachments; exception when others then null; end;
  begin alter publication supabase_realtime add table public.payees;      exception when others then null; end;
end $$;

-- ---------------------------------------------------------------------
-- Seed: first flow + starter categories (edit budgets in the app)
-- ---------------------------------------------------------------------
insert into public.projects (code, title, subtitle, event_date)
values ('bejoy-marriage', 'P O Foundation', 'Bejoy John - Marriage', '2026-11-14')
on conflict (code) do nothing;

insert into public.categories (project_id, name, sort)
select p.id, c.name, c.sort from public.projects p,
  (values ('Venue & Hall',1),('Catering',2),('Decoration & Flowers',3),('Clothing & Jewellery',4),
          ('Photography & Video',5),('Transport',6),('Church & Ceremony',7),('Printing & Invitations',8),
          ('Accommodation',9),('Gifts',10),('Miscellaneous',99)) as c(name, sort)
where p.code = 'bejoy-marriage'
on conflict do nothing;
