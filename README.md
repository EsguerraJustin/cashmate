# CashMate

An Ionic + Angular personal budgeting app backed by Firebase (Auth + Firestore).

Track monthly income, expenses and savings goals across categories you define
yourself.

## Features

- Email/password auth with password-reset flow
- Per-month expense categories, each with its own budget limit
- Optional roll-over of unspent budget from the previous month
- Recurring expenses (monthly or weekly) auto-logged when due
- Savings goals with progress tracking
- Dashboard overview with budget/spent/remaining and a 6-month trend
- Search and filter categories by card colour

## Stack

- Angular 22, Ionic 9
- Firebase Auth + Cloud Firestore
- Vitest (unit tests), ESLint

## Getting started

```bash
npm install
npm start
```

The dev server runs on <http://localhost:8100>.

### Scripts

| Command | Purpose |
| --- | --- |
| `npm start` | Dev server with live reload |
| `npm run build` | Production build into `www/` |
| `npm test` | Unit tests (single run) |
| `npm run lint` | ESLint |
| `npm run reset-password` | Admin utility: set a user's password/email (see below) |
| `npm run cleanup-legacy-categories` | Admin utility: remove auto-seeded categories (see below) |

## Firebase config

Client config lives in `src/environments/`. The web API key is safe to commit —
Firebase web keys are public by design, and access is controlled by Firestore
security rules rather than by hiding the key.

Rules in `firestore.rules` scope every document to its owner:

```
match /users/{userId}/{document=**} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}
```

### Admin utilities

These two scripts use the Firebase Admin SDK and need a **service account key**,
which must stay outside the repository (`.gitignore` blocks the common
filenames). Download one from **Project settings → Service accounts**.

```bash
# Set a password, and optionally change the email, without changing the uid.
# Keeping the uid preserves everything under users/{uid}/.
npm run reset-password -- <key.json> <email> <newPassword> [newEmail]

# Remove categories that the old auto-seeder created. Dry run by default;
# pass --apply to actually delete. Anything you edited is preserved.
npm run cleanup-legacy-categories -- <key.json> <email> [--apply]
```

## Project layout

```
src/app/
  models/budget.model.ts        # domain types + period/rollover maths
  services/firestore-data.service.ts
  guards/auth.guard.ts
  pages/
    welcome/                    # login
    auth/                       # sign up
    forgot-password/            # request reset link
    reset-password/             # post-reset landing
    dashboard/                  # main budget view
    dashboard-overview/         # summary + charts
```

## Notes

- Categories are scoped to a period (`YYYY-MM`). Expenses are dated, and
  totals are computed per selected month.
- `rollLeftover` carries unspent budget forward. It looks up the same-named
  category in the previous month, since categories are period-scoped.
- Password reset relies on Firebase's hosted action widget
  (`handleCodeInApp` left at its default), then returns to `/reset-password`.
