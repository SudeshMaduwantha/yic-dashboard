export const WEEKS = ['1st', '2nd', '3rd', '4th'];

export const KNOWN_SPORTS = ['Karate', 'Kabaddi', 'Netball & Basketball', 'Chess', 'Athletic'];

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

export function allMonthKeys(students) {
  const keys = new Set();
  students.forEach((s) => Object.keys(s.months || {}).forEach((k) => keys.add(k)));
  return [...keys].sort();
}
