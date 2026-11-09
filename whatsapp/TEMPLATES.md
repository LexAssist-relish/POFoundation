# WhatsApp template — P O Foundation

The app sends **one** WhatsApp message: when a payment is made, everyone with alerts on
(except the person who paid) gets the payment plus the running list of all payments so far.
Everything else (bills to approve, payments to make, queries) shows inside the app.

## Create it in MSG91

**MSG91 → WhatsApp → Templates → Create template**, on integrated number **+91 62824 27364**

| Field | Value |
|---|---|
| Template name | `pof_payment_update` |
| Category | **Utility** |
| Language | **English** |
| Header / Footer / Buttons | none |

**Body** (copy exactly):

```
*P O Foundation* · {{1}}
Payment made: {{2}} to {{3}} for {{4}}, paid by {{5}}.

Payments so far ({{6}}), total {{7}}:
{{8}}

See every bill and receipt in the app: {{9}}
Thank you.
```

**Sample values** (MSG91/Meta ask for one per variable):

| Var | Sample |
|---|---|
| {{1}} | Bejoy John - Marriage |
| {{2}} | ₹40,000 |
| {{3}} | Lakshmi Florists |
| {{4}} | Stage flowers (POF-0003) |
| {{5}} | Varughese Koshy |
| {{6}} | 3 |
| {{7}} | ₹1,90,000 |
| {{8}} | 1. St. George Parish Hall ₹50,000 • 2. Kumarakom Caterers ₹1,00,000 • 3. Lakshmi Florists ₹40,000 |
| {{9}} | https://pofoundation.vercel.app/#/daybook |

## What a real message looks like

```
*P O Foundation* · Bejoy John - Marriage
Payment made: ₹3,200 to Taxi Stand for Airport pickup (POF-0012), paid by Varughese Koshy.

Payments so far (12), total ₹3,87,900:
1. St. George Parish Hall ₹50,000 • 2. Kumarakom Caterers ₹1,00,000 • 3. Lakshmi Florists ₹40,000 • … • 12. Taxi Stand ₹3,200

See every bill and receipt in the app: https://pofoundation.vercel.app/#/daybook
Thank you.
```

WhatsApp doesn't allow line breaks inside a variable, so the list is one line separated by " • ".
If it ever gets too long, the oldest payments are folded into "(+N earlier)"; the total always covers everything.

## After approval
Open the template's **code snippet** in MSG91:
- if its language code is `en_US` (not `en`), set `WHATSAPP_TEMPLATE_LANG=en_US` in Vercel;
- if it shows a `namespace` value, set `MSG91_WA_NAMESPACE` to it.

### If it's rejected
- "Too many variables for the length": add a plain sentence above "Thank you.", e.g.
  `This is an automated update from the family expense app.`
- Recategorised as Marketing: resubmit as Utility — it's a transaction update.
