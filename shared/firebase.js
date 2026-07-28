import { initializeApp, deleteApp } from 'firebase/app';
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword,
} from 'firebase/auth';
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, setDoc, getDoc,
  onSnapshot, query, where, serverTimestamp, deleteField, writeBatch, getDocs,
} from 'firebase/firestore';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export function login(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}
export function logout() {
  return signOut(auth);
}
export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

// Creates a new staff login without disturbing the current session — the normal
// createUserWithEmailAndPassword call would otherwise sign the caller out and into
// the new account, so this runs it against a throwaway secondary app instance.
// role: 'super_admin' | 'administrator' | 'coach'; sports (array) is only meaningful for 'coach'.
export async function createStaffAccount(email, password, role, sports) {
  const secondaryApp = initializeApp(firebaseConfig, `secondary-${Date.now()}`);
  const secondaryAuth = getAuth(secondaryApp);
  let newUid;
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    newUid = cred.user.uid;
  } finally {
    await signOut(secondaryAuth).catch(() => {});
    await deleteApp(secondaryApp);
  }
  // Written with the caller's (Super Admin's) own auth session, since only they
  // are allowed to create other users' role documents.
  await setDoc(doc(db, 'users', newUid), {
    email, role, sports: role === 'coach' ? sports : null, createdAt: serverTimestamp(),
  });
}

// ---------------- Staff accounts ----------------
export function watchStaff(callback) {
  return onSnapshot(collection(db, 'users'), (snap) => {
    callback(snap.docs.map((d) => ({ uid: d.id, ...d.data() })));
  });
}

// Removes the staff member's role document, which revokes all app access under
// the Firestore rules (every rule checks this doc). The underlying Firebase Auth
// account itself isn't deleted — that requires the Admin SDK/Blaze plan, which
// this project doesn't have — but without a role doc they can sign in and do
// nothing. Delete the Auth account too from Firebase Console if the email needs
// to be freed up for reuse.
export function deleteStaffAccount(uid) {
  return deleteDoc(doc(db, 'users', uid));
}

// ---------------- Roles ----------------
export async function getMyRole() {
  if (!auth.currentUser) return null;
  const snap = await getDoc(doc(db, 'users', auth.currentUser.uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  // Normalize old accounts (single "sport" string, from before a coach could have
  // more than one) onto the same "sports" array shape the rest of the app expects.
  if (!data.sports && data.sport) data.sports = [data.sport];
  return data;
}

// One-time bootstrap: the very first person to sign in claims Super Admin for themselves.
// Blocked by Firestore rules the instant any Super Admin has ever been claimed.
export async function claimSuperAdmin() {
  const uid = auth.currentUser.uid;
  const batch = writeBatch(db);
  batch.set(doc(db, 'users', uid), {
    email: auth.currentUser.email, role: 'super_admin', sports: null, createdAt: serverTimestamp(),
  });
  batch.set(doc(db, 'meta', 'access'), { superAdminClaimed: true }, { merge: true });
  await batch.commit();
}

// ---------------- Students ----------------
// sportFilter scopes the query to one or more sports — required for coach logins,
// since Firestore rules can only verify a coach's read against a matching where() clause.
export function watchStudents(callback, sportFilter) {
  const ref = sportFilter && sportFilter.length
    ? query(collection(db, 'students'), where('sport', 'in', sportFilter))
    : collection(db, 'students');
  return onSnapshot(ref, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export function addStudent({ name, grade, sport, studentCode, phone }) {
  return addDoc(collection(db, 'students'), {
    name, grade, sport, studentCode: studentCode || null, phone: phone || null, months: {}, createdAt: serverTimestamp(),
  });
}

export function setStudentCode(docId, studentCode) {
  return updateDoc(doc(db, 'students', docId), { studentCode: studentCode || null });
}

// Applies a name/grade/ID correction across every sport-registration doc that
// belongs to the same person (one Firestore doc per name+sport, so a person
// playing two sports needs the edit applied to both).
export async function updateStudentInfo(studentIds, { name, grade, studentCode, phone }) {
  const batch = writeBatch(db);
  studentIds.forEach((id) => {
    batch.update(doc(db, 'students', id), {
      name, grade: grade || null, studentCode: studentCode || null, phone: phone || null,
    });
  });
  await batch.commit();
}

// If a student's name changed, their historical fee records (which store a
// denormalized studentName for display) need to follow, or they'd stop showing
// up under the new name in the Student Profile / fees table.
export async function renameStudentInFees(studentIds, newName) {
  const snaps = await Promise.all(
    studentIds.map((id) => getDocs(query(collection(db, 'fees'), where('studentId', '==', id)))),
  );
  const batch = writeBatch(db);
  let count = 0;
  snaps.forEach((snap) => snap.forEach((feeDoc) => {
    batch.update(feeDoc.ref, { studentName: newName });
    count++;
  }));
  if (count) await batch.commit();
}

export function setAttendanceMark(studentId, monthKey, week, value) {
  const ref = doc(db, 'students', studentId);
  const path = `months.${monthKey}.${week}`;
  return updateDoc(ref, { [path]: value === null ? deleteField() : value });
}

export async function saveAttendanceBatch(changes) {
  // changes: [{ studentId, monthKey, week, value }]
  const batch = writeBatch(db);
  changes.forEach(({ studentId, monthKey, week, value }) => {
    const ref = doc(db, 'students', studentId);
    const path = `months.${monthKey}.${week}`;
    batch.update(ref, { [path]: value === null ? deleteField() : value });
  });
  return batch.commit();
}

// Removes every sport-registration doc for one person plus everything that hangs
// off them (fee records, the Student ID->PIN meta doc, and any public lookup
// snapshot) so a deleted student doesn't leave orphaned rows behind.
export async function deleteStudent(studentIds, studentCode) {
  const batch = writeBatch(db);
  studentIds.forEach((id) => batch.delete(doc(db, 'students', id)));

  const feeSnaps = await Promise.all(
    studentIds.map((id) => getDocs(query(collection(db, 'fees'), where('studentId', '==', id)))),
  );
  feeSnaps.forEach((snap) => snap.forEach((feeDoc) => batch.delete(feeDoc.ref)));

  if (studentCode) {
    const meta = await getStudentMeta(studentCode);
    if (meta && meta.pin) batch.delete(doc(db, 'public_lookup', publicLookupKey(studentCode, meta.pin)));
    batch.delete(doc(db, 'student_meta', studentCode));
  }

  await batch.commit();
}

export async function importStudent({ name, grade, sport, months }) {
  // Used by the one-time Excel import: merge into an existing student (same name+sport) or create new.
  const q = query(collection(db, 'students'), where('name', '==', name), where('sport', '==', sport));
  const existing = await getDocs(q);
  if (!existing.empty) {
    const ref = existing.docs[0].ref;
    const current = existing.docs[0].data();
    return updateDoc(ref, { grade, months: { ...(current.months || {}), ...months } });
  }
  return addDoc(collection(db, 'students'), { name, grade, sport, months, createdAt: serverTimestamp() });
}

// ---------------- Fees ----------------
// sportFilter scopes the query to one or more sports — same reason as watchStudents.
export function watchFees(callback, sportFilter) {
  const ref = sportFilter && sportFilter.length
    ? query(collection(db, 'fees'), where('sport', 'in', sportFilter))
    : collection(db, 'fees');
  return onSnapshot(ref, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}
export function addFee(record) {
  return addDoc(collection(db, 'fees'), { ...record, createdAt: serverTimestamp() });
}
export function updateFee(id, changes) {
  return updateDoc(doc(db, 'fees', id), changes);
}
export function deleteFee(id) {
  return deleteDoc(doc(db, 'fees', id));
}

// ---------------- Sport coaches ----------------
export function watchSportCoaches(callback) {
  return onSnapshot(collection(db, 'sport_coaches'), (snap) => {
    callback(snap.docs.map((d) => ({ sport: d.id, ...d.data() })));
  });
}

export function setSportCoach(sport, { name, phone, email }) {
  return setDoc(doc(db, 'sport_coaches', sport), { name: name || null, phone: phone || null, email: email || null }, { merge: true });
}

// ---------------- Sport fees (standard monthly amount per sport) ----------------
export function watchSportFees(callback) {
  return onSnapshot(collection(db, 'sport_fees'), (snap) => {
    callback(snap.docs.map((d) => ({ sport: d.id, ...d.data() })));
  });
}

export function setSportFee(sport, amount) {
  return setDoc(doc(db, 'sport_fees', sport), { amount: Number(amount) || 0 }, { merge: true });
}

// ---------------- Student meta (Student ID -> PIN) + public lookup ----------------
export async function getStudentMeta(studentCode) {
  const snap = await getDoc(doc(db, 'student_meta', studentCode));
  return snap.exists() ? snap.data() : null;
}

export function setStudentMeta(studentCode, { pin, name }) {
  return setDoc(doc(db, 'student_meta', studentCode), { studentCode, pin, name }, { merge: true });
}

export async function getAllStudentMeta() {
  const snap = await getDocs(collection(db, 'student_meta'));
  return snap.docs.map((d) => d.data());
}

function publicLookupKey(studentCode, pin) {
  return `${studentCode}::${pin}`;
}

// Denormalizes a full profile snapshot for the given studentCode into public_lookup,
// keyed by studentCode+pin so a public, unauthenticated exact-ID get() can fetch it
// without ever being able to list/browse the collection.
export async function syncPublicProfile(studentCode, { name, grade, sports, feeRecords }) {
  const meta = await getStudentMeta(studentCode);
  if (!meta || !meta.pin) throw new Error('Set a PIN for this student before syncing.');

  const totalDue = feeRecords.filter((f) => f.status === 'due').reduce((sum, f) => sum + Number(f.amount || 0), 0);
  const totalPaid = feeRecords.filter((f) => f.status === 'paid').reduce((sum, f) => sum + Number(f.amount || 0), 0);

  const key = publicLookupKey(studentCode, meta.pin);
  await setDoc(doc(db, 'public_lookup', key), {
    studentCode, name, grade: grade || null, sports, feeRecords, totalDue, totalPaid,
    updatedAt: serverTimestamp(),
  });
  return key;
}
