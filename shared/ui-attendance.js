import { el, escapeHtml, escapeAttr, KNOWN_SPORTS, WEEKS, currentMonthKey } from './utils.js';
import { addStudent, saveAttendanceBatch } from './firebase.js';
import { getCurrentRole, isCoach } from './role-state.js';

let allStudents = [];
let allFees = [];
let feesAvailable = false; // only true once fee data has actually been wired up for this role
let regSports = [];
// studentId -> value (true/false/null) for the currently-open month+week, not yet saved.
let pending = new Map();

export function initAttendanceUI() {
  el('att-month').value = currentMonthKey();

  el('att-sport').addEventListener('change', renderList);
  el('att-month').addEventListener('change', renderList);
  el('att-week').addEventListener('change', renderList);

  el('att-save-btn').addEventListener('click', savePending);

  el('reg-name').addEventListener('input', () => {
    // If this name already has a Student ID/phone from another sport registration, reuse it,
    // and show which sports they're already registered in.
    const name = el('reg-name').value.trim();
    const existing = allStudents.find((s) => s.name === name && (s.studentCode || s.phone));
    if (existing) {
      if (!el('reg-student-id').value.trim() && existing.studentCode) el('reg-student-id').value = existing.studentCode;
      if (!el('reg-phone').value.trim() && existing.phone) el('reg-phone').value = existing.phone;
    }
    renderRegSportChecks(name);
  });

  el('reg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = el('reg-name').value.trim();
    const grade = el('reg-grade').value.trim();
    const studentCode = el('reg-student-id').value.trim();
    const phone = el('reg-phone').value.trim();
    const sportsToAdd = [...el('reg-sport-checks').querySelectorAll('input:checked:not(:disabled)')].map((c) => c.value);
    if (!name || sportsToAdd.length === 0) return;
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      for (const sport of sportsToAdd) {
        await addStudent({ name, grade, sport, studentCode, phone });
      }
      e.target.reset();
      renderRegSportChecks('');
    } finally {
      btn.disabled = false;
    }
  });

  el('add-sport-student').addEventListener('change', () => renderAddSportChecks(el('add-sport-student').value));

  el('add-sport-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = el('add-sport-student').value;
    const sportsToAdd = [...el('add-sport-checks').querySelectorAll('input:checked')].map((c) => c.value);
    if (!name || sportsToAdd.length === 0) return;
    const existing = allStudents.find((s) => s.name === name) || {};
    const { grade, studentCode, phone } = existing;
    const btn = el('add-sport-submit');
    btn.disabled = true;
    try {
      for (const sport of sportsToAdd) {
        await addStudent({ name, grade, sport, studentCode, phone });
      }
      el('add-sport-student').value = '';
      renderAddSportChecks('');
    } finally {
      btn.disabled = false;
    }
  });
}

export function updateAttendanceData(students) {
  allStudents = students;
  const role = getCurrentRole();
  // Coaches are locked to their assigned sport(s) — they never see or touch other sports.
  regSports = isCoach() ? role.sports : [...new Set([...KNOWN_SPORTS, ...students.map((s) => s.sport)])];

  const sportSelect = el('att-sport');
  const prevSport = sportSelect.value;
  sportSelect.innerHTML = regSports.map((s) => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('');
  sportSelect.value = regSports.includes(prevSport) ? prevSport : regSports[0];
  // Only lock the dropdown when there's genuinely nothing to switch between.
  sportSelect.disabled = regSports.length <= 1;

  renderRegSportChecks(el('reg-name').value.trim());

  const names = [...new Set(students.map((s) => s.name))].sort((a, b) => a.localeCompare(b));
  const studentSelect = el('add-sport-student');
  const prevName = studentSelect.value;
  studentSelect.innerHTML = '<option value="">Pick a student…</option>' +
    names.map((n) => `<option value="${escapeAttr(n)}">${escapeHtml(n)}</option>`).join('');
  studentSelect.value = names.includes(prevName) ? prevName : '';
  renderAddSportChecks(studentSelect.value);

  renderList();
}

export function updateAttendanceFees(fees) {
  allFees = fees;
  feesAvailable = true;
  renderList();
}

function renderRegSportChecks(name) {
  const already = new Set(allStudents.filter((s) => s.name === name).map((s) => s.sport));
  el('reg-sport-checks').innerHTML = regSports.map((sport) => {
    const isAlready = already.has(sport);
    const checked = isAlready;
    return `
      <label class="reg-sport-check${isAlready ? ' already' : ''}">
        <input type="checkbox" value="${escapeAttr(sport)}" ${checked ? 'checked' : ''} ${isAlready ? 'disabled' : ''} />
        ${escapeHtml(sport)}${isAlready ? ' (already)' : ''}
      </label>
    `;
  }).join('');
}

// Only offers sports this student isn't already registered in — the whole
// point of this section is adding to an existing student, never duplicating.
function renderAddSportChecks(name) {
  const wrap = el('add-sport-checks');
  const btn = el('add-sport-submit');
  if (!name) {
    wrap.innerHTML = '<div class="empty-state">Pick a student first.</div>';
    btn.disabled = true;
    return;
  }
  const already = new Set(allStudents.filter((s) => s.name === name).map((s) => s.sport));
  const available = regSports.filter((sport) => !already.has(sport));
  if (available.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Already registered for every available sport.</div>';
    btn.disabled = true;
    return;
  }
  btn.disabled = false;
  wrap.innerHTML = available.map((sport) => `
    <label class="reg-sport-check">
      <input type="checkbox" value="${escapeAttr(sport)}" />
      ${escapeHtml(sport)}
    </label>
  `).join('');
}

function renderList() {
  const sport = el('att-sport').value;
  const list = el('att-list');
  pending = new Map();

  const students = allStudents.filter((s) => s.sport === sport).sort((a, b) => a.name.localeCompare(b.name));
  if (students.length === 0) {
    list.innerHTML = '<div class="empty-state">No students registered for this sport yet — add one above.</div>';
    el('att-save-btn').disabled = true;
    return;
  }
  el('att-save-btn').disabled = false;

  const monthKey = el('att-month').value || currentMonthKey();
  const week = el('att-week').value;

  list.innerHTML = students.map((s) => {
    const saved = ((s.months || {})[monthKey] || {})[week];
    const state = saved === true ? 'present' : saved === false ? 'absent' : 'unmarked';
    const feePill = feesAvailable ? feeStatusPill(s, monthKey) : '';
    return `
      <div class="att-row" data-id="${escapeAttr(s.id)}">
        <div class="att-row-name">${escapeHtml(s.name)}<span class="att-row-grade">Grade ${escapeHtml(String(s.grade || '—'))}</span></div>
        <div class="att-row-right">
          ${feePill}
          <button type="button" class="att-toggle ${state}" data-state="${state}">${labelFor(state)}</button>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.att-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = nextState(btn.dataset.state);
      btn.dataset.state = next;
      btn.className = `att-toggle ${next}`;
      btn.textContent = labelFor(next);
      const id = btn.closest('.att-row').dataset.id;
      pending.set(id, next === 'unmarked' ? null : next === 'present');
    });
  });
}

// Coaches (and this view generally) only ever see paid/unpaid — never the amount.
function feeStatusPill(student, monthKey) {
  const record = allFees.find((f) => f.studentId === student.id && f.month === monthKey);
  if (!record) return '<span class="status-pill unknown">No fee record</span>';
  return record.status === 'paid'
    ? '<span class="status-pill paid">Paid</span>'
    : '<span class="status-pill due">Unpaid</span>';
}

function nextState(state) {
  if (state === 'unmarked') return 'present';
  if (state === 'present') return 'absent';
  return 'unmarked';
}
function labelFor(state) {
  if (state === 'present') return '✓ Present';
  if (state === 'absent') return '✕ Absent';
  return '– Unmarked';
}

async function savePending() {
  if (pending.size === 0) return;
  const monthKey = el('att-month').value || currentMonthKey();
  const week = el('att-week').value;
  const changes = [...pending.entries()].map(([studentId, value]) => ({ studentId, monthKey, week, value }));

  const btn = el('att-save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    await saveAttendanceBatch(changes);
    pending = new Map();
    el('att-status').textContent = `Saved ${changes.length} mark(s).`;
    setTimeout(() => { el('att-status').textContent = ''; }, 3000);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Attendance';
  }
}
