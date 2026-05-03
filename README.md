# SahlCash

Web app for retail shops to run **shifts**, track **wallets** (cash, POS, e-wallets, etc.), record **transactions** with **fees**, handle **petty cash / expenses**, **wallet recharges**, and **end-of-day reconciliation**. Built for **offline-first** queuing with IndexedDB sync when back online.

## Stack

- **Next.js** (App Router), **React**, **TypeScript**, **Tailwind CSS**
- **Firebase**: Auth, Firestore, Storage
- **next-intl**: English + Arabic (`localePrefix: always` → routes like `/en/dashboard`, `/ar/shift`)
- **Dexie** for pending writes offline

## Prerequisites

- Node.js **20+** (LTS recommended for tooling compatibility)
- A **Firebase** project with Authentication, Firestore, and Storage enabled

## Setup

1. Clone the repo and install dependencies:

   ```bash
   npm install
   ```

2. Copy environment variables and fill in values from the Firebase console (Project settings → Your apps → Web app):

   ```bash
   cp .env.example .env.local
   ```

   Required `NEXT_PUBLIC_*` keys are listed in `.env.example`.

3. Link the Firebase CLI to your project (once per machine) and deploy security rules + indexes:

   ```bash
   npx firebase-tools login
   # Create .firebaserc with your project id, or: firebase use --add
   npm run deploy:firebase
   npx firebase-tools deploy --only storage
   ```

   `npm run deploy:firebase` publishes **Firestore rules** and **indexes** (`firebase.json`). Deploy **Storage rules** with the command above (or add `storage` to the same deploy if you prefer one step).

4. In Firebase **Authentication** → **Settings** → **Authorized domains**, add your local and production hosts (e.g. `localhost`, `your-app.vercel.app`).

## Scripts

| Command | Description |
|--------|-------------|
| `npm run dev` | Dev server (Turbopack); open [http://localhost:3000](http://localhost:3000) — middleware sends you to `/en` or `/ar` |
| `npm run build` | Production build |
| `npm start` | Serve production build locally |
| `npm run lint` | ESLint |
| `npm run deploy:firebase` | Deploy Firestore rules + indexes via Firebase CLI |

## Deploy (production)

- **App**: Connect the repo to [Vercel](https://vercel.com) (or any Next.js host) and set the same `NEXT_PUBLIC_*` variables in the project settings.
- **Backend**: After changing `firestore.rules`, `firestore.indexes.json`, or `storage.rules`, redeploy with Firebase CLI as above (`firebase deploy --only firestore:rules,storage` covers transaction/expense photo paths).

### Offline queue (Dexie)

IndexedDB database `sahlCashDB` may upgrade to **version 3**: pending receipt blobs are migrated from `pendingReceipts` to `pendingAttachments` (same data; supports offline **transaction** photos as well as expense receipts). Existing queued writes on disk are preserved during upgrade.

## Project layout (high level)

- `app/[locale]/` — Pages (dashboard, shift workspace, wallets, reconciliation, analytics, auth, …)
- `components/` — UI (including `shift/shift-workspace.tsx`)
- `contexts/auth-context.tsx` — Store membership and Firebase auth
- `lib/firebase/` — Client SDK helpers, balance batches, seed data
- `lib/offline/` — IndexedDB sync for pending writes
- `types/firestore.ts` — Firestore document shapes
- `messages/en.json`, `messages/ar.json` — UI strings

Product scope and intent are summarized in `PRD.md`.

## Roles

- **Admin**: wallets, team, settings, reconciliation, analytics
- **Cashier**: shift operations, history (per your rules / gates in the app)

## License

Private / use per your organization’s terms.
