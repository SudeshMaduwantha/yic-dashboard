import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { firebaseConfig } from './firebase-config.js';

// Deliberately minimal — no Firebase Auth here. This page is public and
// unauthenticated by design; access is gated entirely by knowing the exact
// Student ID + PIN pair (see firestore.rules: public_lookup allows get, never list).
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const el = (id) => document.getElementById(id);
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

el('lookup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = el('lookup-id').value.trim();
  const pin = el('lookup-pin').value.trim();
  const errorEl = el('lookup-error');
  errorEl.textContent = '';
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Looking up…';
  try {
    const key = `${code}::${pin}`;
    const snap = await getDoc(doc(db, 'public_lookup', key));
    if (!snap.exists()) {
      errorEl.textContent = 'No match found. Check the Student ID and PIN and try again.';
      return;
    }
    renderResult(snap.data());
  } catch (err) {
    errorEl.textContent = 'Something went wrong. Please try again.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Look up';
  }
});

el('lookup-back-btn').addEventListener('click', () => {
  el('lookup-result-card').classList.add('hidden');
  el('lookup-form-card').classList.remove('hidden');
  el('lookup-form').reset();
});

function renderResult(profile) {
  el('lookup-form-card').classList.add('hidden');
  el('lookup-result-card').classList.remove('hidden');
  el('lookup-result-title').textContent = `${profile.name}${profile.grade ? ` · Grade ${profile.grade}` : ''}`;

  el('lookup-result-sports').innerHTML = (profile.sports || []).map((s) => `
    <div class="mini-sport-card">
      <div class="mini-sport-name">${escapeHtml(s.sport)}</div>
      <div class="bar-bg"><div class="bar-fill" style="width:${s.pct}%"></div></div>
      <div class="pct">${s.present}/${s.total} weeks · ${s.pct}%</div>
    </div>
  `).join('') || '<div class="empty-state">Not registered for any sport.</div>';

  el('lookup-result-fees').innerHTML = `
    <div class="fee-summary-pill ${Number(profile.totalDue || 0) > 0 ? 'due' : 'clear'}">Total Due: Rs. ${Number(profile.totalDue || 0).toLocaleString()}</div>
    <div class="fee-summary-pill paid">Total Paid: Rs. ${Number(profile.totalPaid || 0).toLocaleString()}</div>
  `;

  const records = profile.feeRecords || [];
  const feeTable = el('lookup-result-fee-table');
  if (records.length === 0) {
    feeTable.classList.add('hidden');
  } else {
    feeTable.classList.remove('hidden');
    const sorted = [...records].sort((a, b) => (b.month || '').localeCompare(a.month || ''));
    el('lookup-result-fee-body').innerHTML = sorted.map((r) => `
      <tr>
        <td>${escapeHtml(r.sport)}</td>
        <td>${escapeHtml(r.month)}</td>
        <td>Rs. ${Number(r.amount).toLocaleString()}</td>
        <td><span class="status-pill ${r.status}">${r.status === 'paid' ? 'Paid' : 'Due'}</span></td>
      </tr>
    `).join('');
  }

  const updatedAt = profile.updatedAt && profile.updatedAt.toDate ? profile.updatedAt.toDate() : null;
  el('lookup-result-updated').textContent = updatedAt ? `Last updated: ${updatedAt.toLocaleDateString()}` : '';
}
