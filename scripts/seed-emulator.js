// Seeds a disposable test student into the running Firestore emulator so the
// Student Portal flow can be verified end-to-end without touching real data.
// Uses the Admin SDK (bypasses security rules by design) against the emulator.
// Usage: node scripts/seed-emulator.js  (run only while `firebase emulators:start` is up)
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';

const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp({ projectId: 'yic-sport-school' });
const db = getFirestore();

const CODE = 'TEST001';
const PIN = '1234';

async function seed() {
  await db.doc(`student_meta/${CODE}`).set({ studentCode: CODE, pin: PIN, name: 'Test Student' });
  await db.doc(`public_lookup/${CODE}::${PIN}`).set({
    studentCode: CODE,
    name: 'Test Student',
    grade: '5',
    sports: [{ sport: 'Karate', present: 3, total: 4, pct: 75 }],
    feeRecords: [{ sport: 'Karate', month: '2026-06', amount: 1500, status: 'paid' }],
    totalDue: 0,
    totalPaid: 1500,
    updatedAt: new Date(),
  });
  console.log(`Seeded test student: ID=${CODE} PIN=${PIN}`);
  process.exit(0);
}

seed().catch((err) => { console.error(err); process.exit(1); });
