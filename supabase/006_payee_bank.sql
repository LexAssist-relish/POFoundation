-- =====================================================================
-- P O Foundation — bank account details on payees. Safe to re-run.
-- =====================================================================
alter table public.payees add column if not exists account_name text;
alter table public.payees add column if not exists account_no   text;
alter table public.payees add column if not exists ifsc         text;
alter table public.payees add column if not exists bank_name    text;

alter table public.payees drop constraint if exists payees_ifsc_format;
alter table public.payees add constraint payees_ifsc_format
  check (ifsc is null or ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$');

select count(*) as payees, count(account_no) as with_bank_details from public.payees;
