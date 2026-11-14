# My Finance

A fast, installable web app for tracking expenses, income, budgets and net worth. It replaces the
"My Finance" Notion workspace and keeps the same model and rules, but opens instantly on a phone and
works offline.

## What it does

| In Notion | In the app |
| --- | --- |
| **Today**: This Month Plan, quick actions, transactions, net worth & balances, to-do | **Today** tab. Plan card (① Income ② Spending ③ Budget left ④ Saved ⑤ Unallocated), quick actions, your most frequent expenses as one-tap chips, Past week / Moves / Owed to me / ⚠️ Fix lists, balances, to-dos |
| **Expense**: monthly budget per category, this month's transactions | **Expense** tab, for any month. Spent vs limit per category, search, all expenses |
| **Income**: monthly target per category, card payments / transfers / reimbursements with the Issue column | **Income** tab, for any month. Received vs target, filtered lists with issue flags |
| **Assets**, **Liabilities**, categories, net worth | **Accounts** tab. Net worth, composition by category, each account's balance and full activity |
| **Settings**: categories, limits, targets, payment methods | **More** › Budget & categories, Payment methods |
| Financial Checkup | **More** › Financial checkup |
| To Do Tracker | **More** › To do |
| "Monthly subscription" template with Repeat | **More** › Recurring entries |
| Start here ("How I log things") | **More** › How I log things |

Logging works the way it did in Notion:

- **Expense**: amount, name, category, what you paid with. Optional: Don't include, My share / Split
  with (split bills), Spread over N months, Target asset (buying investments).
- **Income**, **Transfer**, **Pay card**, **Repaid** (repayment or refund linked to its bill) are all
  income rows with the matching category type, exactly like the Notion setup.
- Spent uses *my cost*: your share of each bill, less any refund, spread at 1/N per month, with
  Don't include, uncategorised and future-dated rows left out. Only income-type categories count as
  Received. Balances are `opening + value added − value taken + paid in − paid out`.

## Why it is fast

The whole dataset is kept on the device (IndexedDB) and every number is computed there, so screens
render without waiting for the network. A service worker keeps the app itself on the device, so it
opens instantly, even offline. New entries are saved locally first and synced to the server in the
background; entries made offline are queued and sent when you are back online.

## Setup

Requirements: Node 20+ and a Postgres database (for example [Neon](https://neon.tech)).

```bash
npm install
cp .env.example .env.local   # then fill in DATABASE_URL
npm run dev
```

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. Tables are created automatically on first use. |
| `APP_PASSWORD` | The password that unlocks the app. Required in production. Leave unset in local development to skip sign-in. |
| `SESSION_SECRET` | Optional. Signs the session cookie; by default a key derived from `APP_PASSWORD` is used, so changing the password signs every device out. |

### Deploy to Vercel

1. Create a Postgres database (Neon) and copy its **pooled** connection string.
2. Import this repository in Vercel.
3. Add the environment variables `DATABASE_URL` and `APP_PASSWORD` (use a long passphrase: it is the
   only thing protecting your data).
4. Deploy. `vercel.json` runs the functions in Singapore (`sin1`); change the region there if your
   database lives elsewhere.

### Install on your phone

Open the deployed URL, sign in, then:

- **iPhone (Safari)**: Share › Add to Home Screen.
- **Android (Chrome)**: menu › Add to Home screen / Install app. Long-pressing the icon also offers
  *Add expense* and *Add income* shortcuts.

## Bringing your data over from Notion

**More › Import, backup & preferences › Import from Notion** copies everything: account categories,
accounts, payment methods, expense and income categories (with limits and targets), the savings
target, all expenses and income, and to-dos.

1. In Notion: Settings › Connections › Develop or manage integrations › new **internal**
   integration (read access is enough). Copy its secret.
2. Open the **My Finance** page › ••• › Connections › add the integration. Connect only this page,
   not older copies of the workspace: the import finds the databases by name and stops if it sees
   two with the same name.
3. Paste the secret into the import screen.

The secret is used for that import only and is never stored. Nothing in Notion is changed.

Rows keep their Notion ids, so the import can be repeated: existing rows are updated, new ones are
added, and transactions deleted in Notion are removed. That makes it safe to keep logging in Notion
and re-import until you switch over. Entries logged in the app are never touched by an import.

After importing, compare the balances on the Accounts tab with Notion. If a liability is off by
twice its opening balance, flip the sign of that account's opening balance (in the app, a negative
balance on a liability means money owed).

**More › Import, backup & preferences** also downloads a JSON backup of everything and restores
from one.

## Development

```bash
npm run typecheck
npm test                                   # unit tests
TEST_DATABASE_URL=postgres://… npm test    # also runs the Postgres + import tests (wipes that database)
npm run build
```

```
app/                 Next.js app: the page shell and the API routes
  api/sync           push local changes and pull remote ones (one request)
  api/import/notion  step-by-step import from Notion
  api/login, logout  password session
components/          screens, the entry form and other sheets
lib/schema.ts        the data model: drives the Postgres tables, validation and types
lib/finance.ts       every calculation, as pure functions
lib/store.ts         local-first store: cache, outbox, sync
lib/server/          database, sync, auth and the Notion importer
public/sw.js         service worker (app shell cache)
tests/               unit and integration tests
legacy/splitwiser/   the previous Streamlit expense-splitting app, kept for reference
```

### How sync works

Every row has a client-generated id and the server stamps each write with an increasing revision.
`POST /api/sync` takes the client's last revision and its queued changes, applies the changes
(last write wins per row), and returns every row that changed since that revision, including
deletions. The client applies the response on top of its cache and re-applies anything still
queued.
