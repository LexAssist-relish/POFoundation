-- =====================================================================
-- P O Foundation — WhatsApp alerts (run AFTER schema.sql). Safe to re-run.
-- =====================================================================

-- Per-person on/off switch for WhatsApp alerts
alter table public.profiles add column if not exists notify boolean not null default true;

-- One row per WhatsApp message attempted. activity_id + recipient is unique,
-- so the same step never messages the same person twice.
create table if not exists public.notifications (
  id           bigserial primary key,
  expense_id   uuid references public.expenses(id) on delete cascade,
  activity_id  bigint references public.activity(id) on delete cascade,
  event        text not null,
  recipient    uuid references public.profiles(id),
  phone        text,
  template     text,
  status       text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  wa_message_id text,
  error        text,
  created_at   timestamptz not null default now(),
  unique (activity_id, recipient)
);
create index if not exists notifications_created_idx on public.notifications(created_at desc);

alter table public.notifications enable row level security;
drop policy if exists notifications_admin_read on public.notifications;
create policy notifications_admin_read on public.notifications for select to authenticated
  using (public.has_role('admin'));
-- written only by the server (service role)
