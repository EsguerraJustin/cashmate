/**
 * One-off recovery tool: sets a password (and optionally a new email) on an
 * existing Firebase Auth user WITHOUT changing the uid.
 *
 * Why this exists: this app keys all data off the auth uid
 * (`users/{uid}/categories`, `/goals`, `/settings/app`). Deleting the user in
 * the Firebase console and re-signing up issues a NEW uid, which orphans every
 * one of those documents. `auth.updateUser()` leaves the uid alone, so the data
 * stays exactly where it is.
 *
 * Usage:
 *   node scripts/reset-password.mjs <key.json> <email> <newPassword> [newEmail]
 *
 * The service account key must live OUTSIDE this repo. peso-wise-v3/.gitignore
 * has no pattern matching service-account JSON, so a copy left here would be
 * committed. Suggested location:
 *   C:\Users\Justin\.firebase\pesowise-sa.json
 *
 * Delete the key file once you are done.
 */
import { readFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const [keyPath, email, password, newEmail] = process.argv.slice(2);

if (!keyPath || !email || !password) {
  console.error(
    'Usage: node scripts/reset-password.mjs <key.json> <email> <newPassword> [newEmail]'
  );
  process.exit(1);
}

if (newEmail && newEmail.trim().toLowerCase() === email.trim().toLowerCase()) {
  console.error('Refusing to set the same email it already has. Omit newEmail.');
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
} catch (error) {
  console.error(`Could not read the key file at ${keyPath}`);
  console.error(`  ${error.message}`);
  console.error('Download it from Firebase console -> Project settings -> Service accounts.');
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
const auth = getAuth(app);

try {
  const user = await auth.getUserByEmail(email);

  const patch = { password };
  if (newEmail) {
    patch.email = newEmail.trim();
  }

  await auth.updateUser(user.uid, patch);

  console.log(`Updated ${email}`);
  if (newEmail) {
    console.log(`  email -> ${patch.email}`);
  }
  console.log(`  password -> (${password.length} chars, not shown)`);

  console.log('');
  console.log(`uid is UNCHANGED: ${user.uid}`);
  console.log('');
  console.log('Next: confirm the data is still there before logging in.');
  console.log(`  Firebase console -> Firestore -> users -> ${user.uid}`);
  console.log('  You want to see settings/app, categories/, goals/');
  console.log('');
  console.log(
    newEmail
      ? `Log in with ${patch.email} (NOT ${email}) — the old address no longer works.`
      : `Log in with ${email}.`
  );
} catch (error) {
  console.error('Failed:', error?.code ?? error?.message ?? error);
  if (error?.code === 'auth/user-not-found') {
    console.error('  No auth user has that email. Check for typos.');
  }
  if (error?.code === 'auth/invalid-email') {
    console.error('  That is not a valid email address.');
  }
  if (error?.code === 'auth/email-already-exists') {
    console.error('  That new email is already registered to another account.');
  }
  process.exit(1);
}
