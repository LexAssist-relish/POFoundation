# P O Foundation — Payments module
**First flow: Bejoy John - Marriage (14 Nov 2026)**

*P O = Pandampurath Oommen. P O Foundation is not yet a formal organisation; this app is its first module.*

Phone-first web app (installable PWA) for family-funded expenses:

```
Bejoy adds bill + photo  →  Approver approves (can alter amount) & picks payer
   →  Payer opens link → GPay pre-filled (payee, amount, narration)
   →  Payer shares GPay receipt to the app → expense marked Paid with receipt + UTR
```

## Roles (a person can have several)
| Role | Can do |
|---|---|
| Admin | Onboard users, payees, budgets, delete anything unpaid |
| Approver | Approve / alter amount / query / reject; choose who pays |
| Payer | Gets pay link (QR + GPay button), records payment & receipt |
| Expense input | Adds bills with invoice photos; edits while awaiting approval / query |
| Viewer | Sees everything, changes nothing |

Suggested setup: Motty = Admin+Approver+Payer · Sherine = Admin · P.O. Mathew = Approver+Payer · Bejoy = Expense input · Varughese = Payer · Saramma & others = Viewer.

## Features
- Dashboard: action cards ("1 to approve", "2 for you to pay"), committed vs budget, **who has paid how much**, spend by category, latest activity, days-to-go
- Daybook: day-wise list with filters (status / category / payer / search incl. UTR), attachments, CSV export
- Expense detail: bills, payment receipts, full history (who approved, original vs altered amount, who paid, UTR)
- UPI pay: QR (tap to save) + "Pay with GPay" deep link + copy UPI ID / amount; narration = `POF-0007 <description>`
- Receipt capture: share from GPay straight into the app (Android, installed app), or photo / upload
- Cash and bank-transfer payments supported; "Payment failed?" puts it back to Awaiting payment
- WhatsApp nudges: "Ask P.O. to approve", "Send pay link to Varughese", login details to new users
- Live updates across phones (Supabase Realtime); photos compressed before upload
- Payees: UPI ID validated; marked **unverified** until an admin/approver confirms it

## Setup (≈15 minutes)

### 1. Supabase
1. Create a new project (region: Mumbai).
2. SQL Editor → paste **`supabase/schema.sql`** → Run.
3. Authentication → Providers → Email: keep enabled, turn **off** "Confirm email".
4. Authentication → Users → **Add user**: email `motty@pof.app`, password = your 6-digit PIN, tick *Auto confirm*.
5. SQL Editor → create your admin profile:
   ```sql
   insert into public.profiles (id, username, full_name, relation, phone, roles)
   select id, 'motty', 'Motty Philip', null, '91XXXXXXXXXX', '{admin,approver,payer}'
   from auth.users where email = 'motty@pof.app';
   ```
   Everyone else (including Sherine) is onboarded from the app → **Users**.

### 2. Vercel
1. Push this folder to GitHub, import into Vercel (framework auto-detects Vite).
2. Environment variables:
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (Project Settings → API)
   - `SUPABASE_URL` (same URL) and `SUPABASE_SERVICE_ROLE_KEY` — **server only, never prefix with VITE_**
3. Deploy. `api/admin-users.js` handles onboarding/PIN resets (admins only, verified server-side).

### 3. Phones
Open the link in Chrome → ⋮ → **Add to Home screen**. After that, *P O Foundation* appears in GPay's **Share** sheet.
iPhone works for everything except share-to-app (use "Upload file").

## Notes & limits
- **GPay deep links:** for personal (non-merchant) UPI IDs, GPay sometimes declines a pre-filled link above ~₹2,000 "for security reasons". The QR is the fallback: tap it to save the image, then in GPay → Scan → gallery. Paying to the UPI ID directly always works.
- Logins are `username` + 6-digit PIN (stored as a hidden email `username@pof.app`; no emails are ever sent).
- Users with history are deactivated, not deleted, so the audit trail stays complete.
- All workflow changes run through database functions (`approve_expense`, `mark_paid`, …) with row-level security — the browser can't skip a step.

## Future P O Foundation flows
`projects` table holds one row per flow. The app currently opens `bejoy-marriage`; adding a project switcher is the next step when a second flow starts.

## Local
```
cp .env.example .env   # fill in
npm install && npm run dev
npm run build:demo     # click-through demo with sample data, no Supabase
```
