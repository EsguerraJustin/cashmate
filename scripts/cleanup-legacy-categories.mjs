/**
 * One-time cleanup: remove the categories that the old auto-seeder wrote at
 * sign-up. Those 12 were never chosen by the user — they were injected with
 * hardcoded peso limits, which is why every account started with a Grocery
 * and a Rent the owner never asked for.
 *
 * A category is only a candidate when ALL of these hold:
 *   1. Its name matches one of the original seed names (case-insensitive)
 *   2. Its amountLimit is still EXACTLY the seeded value (you edited it -> keep)
 *   3. Its tone is still the seeded tone (you recoloured it -> keep)
 *   4. It has no logged expenses (you used it -> keep)
 *   5. It has no dueDay/dueDate set (you configured it -> keep)
 *
 * The three checks above 2-5 are what make this safe: if you renamed,
 * re-priced, recoloured, used, or dated any of them, it survives. Only
 * untouched auto-seeded leftovers are removed.
 *
 * Usage:
 *   node scripts/cleanup-legacy-categories.mjs <key.json> <email> [--apply]
 *
 * Dry-run by default. Nothing is deleted without --apply.
 */
import { readFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const [keyPath, email, ...flags] = process.argv.slice(2);
const apply = flags.includes('--apply');

if (!keyPath || !email) {
  console.error(
    'Usage: node scripts/cleanup-legacy-categories.mjs <key.json> <email> [--apply]'
  );
  process.exit(1);
}

/** The original STARTER_CATEGORIES, verbatim. */
const SEED = [
  { name: 'Grocery', tone: 'shopping', amountLimit: 8000 },
  { name: 'Food', tone: 'shopping', amountLimit: 4000 },
  { name: 'Transport', tone: 'transport', amountLimit: 3000 },
  { name: 'Shopping', tone: 'shopping', amountLimit: 3000 },
  { name: 'Emergency', tone: 'emergency', amountLimit: 2000 },
  { name: 'Rent', tone: 'bills', amountLimit: 10000 },
  { name: 'Electricity', tone: 'bills', amountLimit: 3000 },
  { name: 'Water', tone: 'bills', amountLimit: 1000 },
  { name: 'Internet', tone: 'bills', amountLimit: 1500 },
  { name: 'Phone', tone: 'bills', amountLimit: 1000 },
  { name: 'Subscriptions', tone: 'bills', amountLimit: 1000 },
  { name: 'Insurance', tone: 'bills', amountLimit: 2000 },
];

const byName = new Map(
  SEED.map((s) => [s.name.trim().toLowerCase(), s])
);

let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
} catch (error) {
  console.error(`Could not read the key file at ${keyPath}`);
  console.error(`  ${error.message}`);
  process.exit(1);
}

if (!serviceAccount.project_id || !serviceAccount.private_key) {
  console.error('That file is not a Firebase service account key.');
  process.exit(1);
}

const app = initializeApp({
  credential: cert(serviceAccount),
  projectId: serviceAccount.project_id,
});
const db = getFirestore(app);

try {
  const user = await getAuth(app).getUserByEmail(email);
  const colRef = db.collection(`users/${user.uid}/categories`);
  const snap = await colRef.get();

  if (snap.empty) {
    console.log(`No categories found for ${email}. Nothing to do.`);
    process.exit(0);
  }

  const doomed = [];
  const kept = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const name = String(data?.name ?? '').trim();
    const seed = byName.get(name.toLowerCase());

    if (!seed) {
      kept.push({ doc, name, reason: 'not an auto-seeded name' });
      continue;
    }

    const limit = Number(data?.amountLimit ?? 0);
    if (limit !== seed.amountLimit) {
      kept.push({
        doc,
        name,
        reason: `limit edited (${limit} vs seeded ${seed.amountLimit})`,
      });
      continue;
    }

    if (String(data?.tone ?? '') !== seed.tone) {
      kept.push({ doc, name, reason: 'colour changed' });
      continue;
    }

    const expenses = Array.isArray(data?.expenses) ? data.expenses : [];
    if (expenses.length > 0) {
      kept.push({
        doc,
        name,
        reason: `has ${expenses.length} logged expense(s)`,
      });
      continue;
    }

    if (data?.dueDay || data?.dueDate) {
      kept.push({ doc, name, reason: 'has a due date set' });
      continue;
    }

    doomed.push({ doc, name });
  }

  console.log(`Account: ${email}`);
  console.log(`uid:     ${user.uid}`);
  console.log('');
  console.log(`Total categories: ${snap.size}`);
  console.log(`Would remove:     ${doomed.length}`);
  console.log(`Would keep:       ${kept.length}`);
  console.log('');

  if (doomed.length > 0) {
    console.log('REMOVE:');
    for (const item of doomed) {
      console.log(`  - ${item.name}  (${item.doc.id})`);
    }
    console.log('');
  }

  if (kept.length > 0) {
    console.log('KEEP:');
    for (const item of kept) {
      console.log(`  - ${item.name}  — ${item.reason}`);
    }
    console.log('');
  }

  if (!apply) {
    console.log('Dry run. Re-run with --apply to actually delete.');
    process.exit(0);
  }

  if (doomed.length === 0) {
    console.log('Nothing to delete.');
    process.exit(0);
  }

  const batch = db.batch();
  for (const item of doomed) {
    batch.delete(item.doc.ref);
  }
  await batch.commit();

  console.log(`Deleted ${doomed.length} untouched auto-seeded categor${doomed.length === 1 ? 'y' : 'ies'}.`);
  console.log('');
  console.log('Also check: any Recurring Expense rules pointing at a removed');
  console.log('category are now orphaned. Open the dashboard and review those.');
} catch (error) {
  console.error('Failed:', error?.code ?? error?.message ?? error);
  process.exit(1);
}
