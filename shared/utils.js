// Most months have 4 occurrences of a given weekday, but some have 5 (e.g. 5
// Saturdays) — '5th' is a real, if less common, key in a month's weeks object.
export const WEEKS = ['1st', '2nd', '3rd', '4th', '5th'];

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

// Splits a free-typed grade into grade + class: "01" -> 1, "1 B" -> 1/B, "4+A" -> 4/A,
// "Grade 7" -> 7. Anything that doesn't look like a number + optional letter(s)
// is kept as-is (no class) rather than guessed at.
export function parseGrade(raw) {
  const text = String(raw ?? '').trim();
  const match = text.match(/^(?:grade\s*)?0*(\d{1,2})\s*[+\-/.]?\s*([A-Za-z]{1,2})?$/i);
  if (!match) return { grade: text, className: '' };
  return { grade: match[1], className: (match[2] || '').toUpperCase() };
}

// Numeric-aware so "10" sorts after "9", not after "1".
export function sortGrades(grades) {
  return [...new Set(grades.map((g) => String(g)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

// What a table cell shows for a student's grade: "4", or "4 B" once they're in a class.
export function gradeLabel(s) {
  if (!s.grade) return '—';
  return s.className ? `${s.grade} ${s.className}` : String(s.grade);
}

// Themed one-field text prompt (window.prompt() isn't supported in Electron's renderer).
// Resolves to the trimmed text, or null if cancelled.
export function promptDialog(message, { title = 'Enter a value', okLabel = 'Save', value = '' } = {}) {
  return new Promise((resolve) => {
    const modal = el('prompt-modal');
    const form = el('prompt-form');
    const input = el('prompt-input');
    el('prompt-title').textContent = title;
    el('prompt-message').textContent = message;
    el('prompt-ok').textContent = okLabel;
    input.value = value;
    modal.classList.remove('hidden');
    input.focus();
    input.select();

    const cleanup = (result) => {
      modal.classList.add('hidden');
      form.removeEventListener('submit', onSubmit);
      el('prompt-cancel').removeEventListener('click', onCancel);
      modal.removeEventListener('click', onOverlay);
      resolve(result);
    };
    const onSubmit = (e) => { e.preventDefault(); cleanup(input.value.trim()); };
    const onCancel = () => cleanup(null);
    const onOverlay = (e) => { if (e.target === modal) cleanup(null); };
    form.addEventListener('submit', onSubmit);
    el('prompt-cancel').addEventListener('click', onCancel);
    modal.addEventListener('click', onOverlay);
  });
}

export function allMonthKeys(students) {
  const keys = new Set();
  students.forEach((s) => Object.keys(s.months || {}).forEach((k) => keys.add(k)));
  return [...keys].sort();
}
