-- =====================================================================
-- P O Foundation — create / update family logins (run after 002_whatsapp.sql)
-- Safe to re-run: existing people are updated, not duplicated.
--
-- BEFORE RUNNING: replace each 6-digit PIN below. Each person signs in with
-- their username + PIN, and can change the PIN later in More → Change my PIN.
-- Mobile = full international number, digits only (91… India, 60… Malaysia).
-- Leave mobile as null to keep whatever is already saved.
-- For someone who ALREADY has a login (e.g. motty, sherine), 000000 means
-- "keep their current PIN". New logins must get a real PIN.
-- =====================================================================
do $$
declare
  r record;
  v_id uuid;
begin
  for r in
    select * from (values
      -- username,   full name,          mobile,          PIN,       roles
      ('motty',     'Motty Philip',      null,            '000000',  '{admin,approver,payer,inputter}'),
      ('sherine',   'Sherine Motty',     '919446051944',  '000000',  '{admin,approver,payer,inputter}'),
      ('pomathew',  'P.O. Mathew',       '919447137373',  '000000',  '{approver,payer}'),
      ('varughese', 'Varughese Koshy',   '60123123129',   '000000',  '{payer}'),
      ('saramma',   'Saramma Krishnan',  '60126852312',   '000000',  '{viewer}'),
      ('bejoy',     'Bejoy John',        '916282143314',  '000000',  '{inputter}')
    ) as t(username, full_name, mobile, pin, roles)
  loop
    if r.pin !~ '^\d{6}$' then raise exception 'PIN for % must be exactly 6 digits', r.username; end if;

    select id into v_id from auth.users where email = r.username || '@pof.app';

    if v_id is null then
      if r.pin = '000000' then raise exception 'Set a real PIN for % (new login) — 000000 is the placeholder', r.username; end if;
      v_id := gen_random_uuid();
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change,
        email_change_token_current, phone_change, phone_change_token, reauthentication_token)
      values (
        '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
        r.username || '@pof.app', crypt(r.pin, gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', r.full_name),
        now(), now(), '', '', '', '', '', '', '', '');
      insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), v_id, v_id::text, 'email',
        jsonb_build_object('sub', v_id::text, 'email', r.username || '@pof.app', 'email_verified', true),
        now(), now(), now());
    elsif r.pin <> '000000' then
      update auth.users set encrypted_password = crypt(r.pin, gen_salt('bf')), updated_at = now() where id = v_id;
    end if;

    insert into public.profiles (id, username, full_name, phone, roles, active, notify)
    values (v_id, r.username, r.full_name, r.mobile, r.roles::text[], true, true)
    on conflict (id) do update
      set full_name = excluded.full_name,
          phone     = coalesce(excluded.phone, public.profiles.phone),
          roles     = excluded.roles,
          active    = true;
  end loop;
end $$;

-- Bejoy as a payee too, so bills he pays out of pocket can be reimbursed to him by UPI
insert into public.payees (name, upi_id, phone, category, notes, verified)
select 'Bejoy John', 'bejoys0808-2@okicici', '916282143314', null, 'Groom — reimbursements', true
where not exists (select 1 from public.payees where upi_id = 'bejoys0808-2@okicici');

select username, full_name, '+' || phone as whatsapp, roles, notify
from public.profiles order by username;
