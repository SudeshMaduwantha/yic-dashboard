export const WEEKS = ['1st', '2nd', '3rd', '4th'];

export const KNOWN_SPORTS = ['Karate', 'Kabaddi', 'Netball & Basketball', 'Chess', 'Athletic'];

export const ROLE_LABELS = { super_admin: 'Super Admin', administrator: 'Administrator', coach: 'Coach' };

export const SPORT_LOGOS = {
  Karate: 'assets/logos/karate.jpeg',
  Kabaddi: 'assets/logos/kabaddi.jpeg',
  'Netball & Basketball': 'assets/logos/netball-basketball.jpeg',
  Chess: 'assets/logos/chess.jpeg',
  Athletic: 'assets/logos/athletic.jpeg',
};

export const el = (id) => document.getElementById(id);

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export const escapeAttr = escapeHtml;

// monthKey is "YYYY-MM" (from <input type="month">). Format for display, e.g. "May 2026".
export function formatMonthLabel(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return monthKey;
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function presentTotalForMonths(months, monthKey) {
  if (monthKey === 'all') {
    let present = 0, total = 0;
    for (const weeks of Object.values(months || {})) {
      for (const v of Object.values(weeks || {})) {
        if (v === true) { present++; total++; }
        else if (v === false) { total++; }
      }
    }
    return { present, total };
  }
  const weeks = (months || {})[monthKey] || {};
  let present = 0, total = 0;
  for (const v of Object.values(weeks)) {
    if (v === true) { present++; total++; }
    else if (v === false) { total++; }
  }
  return { present, total };
}

// Inclusive list of "YYYY-MM" keys between fromKey and toKey (or just [fromKey] if
// toKey is empty/before fromKey — e.g. a single-month payment).
export function monthRange(fromKey, toKey) {
  if (!toKey || toKey <= fromKey) return [fromKey];
  const [fy, fm] = fromKey.split('-').map(Number);
  const [ty, tm] = toKey.split('-').map(Number);
  const keys = [];
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    keys.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return keys;
}

// Themed replacement for window.confirm() — the native OS dialog can't be
// restyled to match the app's dark theme, so this reuses the app's own
// modal-overlay markup (#confirm-modal in index.html) instead.
export function confirmDialog(message, { title = 'Are you sure?', okLabel = 'Delete' } = {}) {
  return new Promise((resolve) => {
    const modal = el('confirm-modal');
    const okBtn = el('confirm-ok');
    const cancelBtn = el('confirm-cancel');
    el('confirm-title').textContent = title;
    el('confirm-message').textContent = message;
    okBtn.textContent = okLabel;
    modal.classList.remove('hidden');

    const cleanup = (result) => {
      modal.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onOverlay);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onOverlay = (e) => { if (e.target === modal) cleanup(false); };
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    modal.addEventListener('click', onOverlay);
  });
}

// Builds the exact payload syncPublicProfile() needs for one person, from the
// same allStudents/allFees shape every caller (Student Profile's manual sync,
// the Fees Ledger's auto-sync, and its bulk "Sync to Web") already has in hand.
export function buildPublicProfileSnapshot(name, allStudents, allFees) {
  const registrations = allStudents.filter((s) => s.name === name);
  const grade = registrations.find((s) => s.grade)?.grade || null;
  const sports = registrations.map((s) => {
    const pt = presentTotalForMonths(s.months, 'all');
    return { sport: s.sport, present: pt.present, total: pt.total, pct: pt.total ? Math.round((pt.present / pt.total) * 100) : 0 };
  });
  const feeRecords = allFees.filter((f) => f.studentName === name)
    .map((f) => ({ sport: f.sport, month: f.month, amount: f.amount, status: f.status }));
  return { grade, sports, feeRecords };
}

export function allMonthKeys(students) {
  const keys = new Set();
  students.forEach((s) => Object.keys(s.months || {}).forEach((k) => keys.add(k)));
  return [...keys].sort();
}
