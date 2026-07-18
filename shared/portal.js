import { initializeApp } from 'firebase/app';
import {
  getAuth, setPersistence, browserSessionPersistence,
  signInAnonymously, onAuthStateChanged, signOut,
} from 'firebase/auth';
import {
  getFirestore, doc, getDoc, setDoc, deleteDoc, serverTimestamp,
} from 'firebase/firestore';
import { connectFirestoreEmulator } from 'firebase/firestore';
import { connectAuthEmulator } from 'firebase/auth';
import { firebaseConfig } from './firebase-config.js';
import { el, escapeHtml } from './utils.js';

// Own, isolated Firebase app instance for this page — never shares state with the
// staff dashboard's persistent Auth session (shared/firebase.js). Session-only
// persistence means the student is signed out the moment the browser/tab closes;
// an explicit Logout button covers the "log out on click" half of the requirement.
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Local-only: point at the Firebase Emulator Suite instead of production when this
// page is served from localhost (see `firebase emulators:start`). Never triggers in
// the deployed build.
if (typeof location !== 'undefined' && location.hostname === 'localhost') {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, 'localhost', 8080);
}

// Profile photos are stored as a small base64 data: URI directly in Firestore, not
// Firebase Storage — this project is on the free Spark plan and Storage requires
// the paid Blaze plan. Resized/compressed client-side to stay well under
// Firestore's 1MiB document limit; firestore.rules enforces the size server-side.
const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // source file, before resizing
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTO_MAX_DIMENSION = 320;
const PHOTO_JPEG_QUALITY = 0.72;

function resizePhotoToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, PHOTO_MAX_DIMENSION / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/jpeg', PHOTO_JPEG_QUALITY));
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error('Could not read image')); };
    img.src = URL.createObjectURL(file);
  });
}

let currentCode = null;
let dashboardActive = false;

function renderDashboardSummary(profile) {
  el('portal-welcome-title').textContent = `Welcome, ${profile.name}${profile.grade ? ` (Grade ${profile.grade})` : ''}`;

  el('portal-sports').innerHTML = (profile.sports || []).map((s) => `
    <div class="mini-sport-card">
      <div class="mini-sport-name">${escapeHtml(s.sport)}</div>
      <div class="bar-bg"><div class="bar-fill" style="width:${s.pct}%"></div></div>
      <div class="pct">${s.present}/${s.total} weeks · ${s.pct}%</div>
    </div>
  `).join('') || '<div class="empty-state">Not registered for any sport.</div>';

  el('portal-fees').innerHTML = `
    <div class="fee-summary-pill ${Number(profile.totalDue || 0) > 0 ? 'due' : 'clear'}">Total Due: Rs. ${Number(profile.totalDue || 0).toLocaleString()}</div>
    <div class="fee-summary-pill paid">Total Paid: Rs. ${Number(profile.totalPaid || 0).toLocaleString()}</div>
  `;

  const records = profile.feeRecords || [];
  const feeTable = el('portal-fee-table');
  if (records.length === 0) {
    feeTable.classList.add('hidden');
  } else {
    feeTable.classList.remove('hidden');
    const sorted = [...records].sort((a, b) => (b.month || '').localeCompare(a.month || ''));
    el('portal-fee-body').innerHTML = sorted.map((r) => `
      <tr>
        <td>${escapeHtml(r.sport)}</td>
        <td>${escapeHtml(r.month)}</td>
        <td>Rs. ${Number(r.amount).toLocaleString()}</td>
        <td><span class="status-pill ${r.status}">${r.status === 'paid' ? 'Paid' : 'Due'}</span></td>
      </tr>
    `).join('');
  }

  const updatedAt = profile.updatedAt && profile.updatedAt.toDate ? profile.updatedAt.toDate() : null;
  el('portal-updated').textContent = updatedAt ? `Last updated: ${updatedAt.toLocaleDateString()}` : '';
}

async function loadEditableProfile(code) {
  const snap = await getDoc(doc(db, 'student_profiles', code));
  const data = snap.exists() ? snap.data() : {};
  el('portal-phone').value = data.phone || '';
  el('portal-emergency').value = data.emergencyContact || '';
  if (data.photoUrl) el('portal-avatar-preview').src = data.photoUrl;
}

async function enterDashboard(code, lookupProfile) {
  if (dashboardActive) return;
  dashboardActive = true;
  currentCode = code;
  renderDashboardSummary(lookupProfile);
  await loadEditableProfile(code);
  // Reveal only once both the summary and editable fields are populated, so the
  // dashboard never flashes with empty phone/emergency-contact inputs.
  el('portal-login-card').classList.add('hidden');
  el('portal-dashboard-card').classList.remove('hidden');
}

function backToLogin() {
  dashboardActive = false;
  currentCode = null;
  el('portal-dashboard-card').classList.add('hidden');
  el('portal-login-card').classList.remove('hidden');
  el('portal-login-form').reset();
}

// Restore the dashboard on reload within the same tab (session persistence keeps the
// anonymous auth user alive across reloads, cleared automatically on tab/browser close).
onAuthStateChanged(auth, async (user) => {
  if (!user || dashboardActive) return;
  try {
    const sessionSnap = await getDoc(doc(db, 'student_sessions', user.uid));
    if (!sessionSnap.exists()) return;
    const { studentCode, pin } = sessionSnap.data();
    const lookupSnap = await getDoc(doc(db, 'public_lookup', `${studentCode}::${pin}`));
    if (!lookupSnap.exists()) return;
    await enterDashboard(studentCode, lookupSnap.data());
  } catch (err) {
    // No valid session to restore — leave the login screen showing.
  }
});

el('portal-login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = el('portal-id').value.trim();
  const pin = el('portal-pin').value.trim();
  const errorEl = el('portal-login-error');
  errorEl.textContent = '';
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Logging in…';
  try {
    // Same public, unauthenticated read the existing /lookup page already does —
    // exact-match only, no enumeration possible (see firestore.rules).
    const lookupSnap = await getDoc(doc(db, 'public_lookup', `${code}::${pin}`));
    if (!lookupSnap.exists()) {
      errorEl.textContent = 'No match found. Check the Student ID and PIN and try again.';
      return;
    }
    if (!auth.currentUser) {
      await setPersistence(auth, browserSessionPersistence);
      await signInAnonymously(auth);
    }
    const uid = auth.currentUser.uid;
    // Security boundary is server-side: the create rule re-checks this exact
    // public_lookup doc exists before allowing the session to be written.
    await setDoc(doc(db, 'student_sessions', uid), { studentCode: code, pin, createdAt: serverTimestamp() });
    await enterDashboard(code, lookupSnap.data());
  } catch (err) {
    errorEl.textContent = 'Something went wrong. Please try again.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Log in';
  }
});

el('portal-profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = el('portal-profile-error');
  const successEl = el('portal-profile-success');
  errorEl.textContent = '';
  successEl.textContent = '';
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    await setDoc(doc(db, 'student_profiles', currentCode), {
      phone: el('portal-phone').value.trim(),
      emergencyContact: el('portal-emergency').value.trim(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    successEl.textContent = 'Saved.';
  } catch (err) {
    errorEl.textContent = 'Could not save. Please try again.';
  } finally {
    btn.disabled = false;
  }
});

el('portal-photo-upload-btn').addEventListener('click', async () => {
  const errorEl = el('portal-photo-error');
  const successEl = el('portal-photo-success');
  errorEl.textContent = '';
  successEl.textContent = '';
  const fileInput = el('portal-photo-input');
  const file = fileInput.files[0];
  if (!file) {
    errorEl.textContent = 'Choose a photo first.';
    return;
  }
  if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
    errorEl.textContent = 'Photo must be a JPEG, PNG, or WEBP image.';
    return;
  }
  if (file.size > MAX_PHOTO_BYTES) {
    errorEl.textContent = 'Photo must be smaller than 8MB.';
    return;
  }
  const btn = el('portal-photo-upload-btn');
  btn.disabled = true;
  btn.textContent = 'Uploading…';
  try {
    const photoUrl = await resizePhotoToDataUrl(file);
    await setDoc(doc(db, 'student_profiles', currentCode), {
      photoUrl,
      photoUpdatedAt: serverTimestamp(),
    }, { merge: true });
    el('portal-avatar-preview').src = photoUrl;
    fileInput.value = '';
    successEl.textContent = 'Photo updated.';
  } catch (err) {
    errorEl.textContent = 'Upload failed. Please try again.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Upload photo';
  }
});

el('portal-logout-btn').addEventListener('click', async () => {
  const uid = auth.currentUser && auth.currentUser.uid;
  try {
    if (uid) await deleteDoc(doc(db, 'student_sessions', uid));
  } catch (err) {
    // Ignore — signOut below still ends the session even if the delete failed.
  }
  await signOut(auth);
  backToLogin();
});
