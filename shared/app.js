import { el } from './utils.js';
import { watchStudents, watchFees, watchSportCoaches, importStudent } from './firebase.js';
import { initLoginUI } from './ui-login.js';
import { initDashboardUI, updateDashboardData, updateDashboardFees, updateCoaches } from './ui-dashboard.js';
import { initAttendanceUI, updateAttendanceData, updateAttendanceFees } from './ui-attendance.js';
import { initFeesUI, updateFeesStudentData, updateFeesData } from './ui-fees.js';

let unsubStudents = null;
let unsubFees = null;
let unsubCoaches = null;
let latestStudents = [];

// ---------------- Tabs ----------------
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    el(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// Tabs/buttons each role is allowed to see. Super Admin sees everything.
const TAB_ACCESS = {
  super_admin: ['dashboard', 'attendance', 'fees'],
  administrator: ['dashboard', 'fees'],
  coach: ['dashboard', 'attendance'],
};

function applyRoleUI(role) {
  const allowedTabs = TAB_ACCESS[role.role] || [];

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    const allowed = allowedTabs.includes(btn.dataset.tab);
    btn.classList.toggle('hidden', !allowed);
  });
  // If the currently active tab isn't allowed for this role, jump to the first allowed one.
  const activeBtn = document.querySelector('.tab-btn.active');
  if (!activeBtn || !allowedTabs.includes(activeBtn.dataset.tab)) {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    const firstBtn = document.querySelector(`.tab-btn[data-tab="${allowedTabs[0]}"]`);
    if (firstBtn) {
      firstBtn.classList.add('active');
      el(`tab-${allowedTabs[0]}`).classList.add('active');
    }
  }

  el('add-staff-btn').classList.toggle('hidden', role.role !== 'super_admin');
  if (typeof window.api !== 'undefined') {
    el('import-excel-btn').classList.toggle('hidden', role.role !== 'super_admin');
  }
}

initLoginUI({
  onLogin: (user, role) => {
    applyRoleUI(role);
    const sportScope = role.role === 'coach' ? role.sports : undefined;
    unsubStudents = watchStudents((students) => {
      latestStudents = students;
      updateDashboardData(students);
      updateAttendanceData(students);
      updateFeesStudentData(students);
    }, sportScope);
    if (role.role === 'super_admin' || role.role === 'administrator') {
      unsubFees = watchFees((fees) => { updateFeesData(fees); updateDashboardFees(fees); updateAttendanceFees(fees); });
    } else if (role.role === 'coach') {
      // Coaches only get paid/unpaid status for their own sport(s) — never the amount,
      // and never routed to the Fees Ledger / Dashboard fee views (they don't have access to those).
      unsubFees = watchFees((fees) => updateAttendanceFees(fees), role.sports);
    }
    unsubCoaches = watchSportCoaches((coaches) => updateCoaches(coaches));
  },
  onLogout: () => {
    if (unsubStudents) unsubStudents();
    if (unsubFees) unsubFees();
    if (unsubCoaches) unsubCoaches();
    unsubStudents = null;
    unsubFees = null;
    unsubCoaches = null;
    latestStudents = [];
  },
});

initDashboardUI();
initAttendanceUI();
initFeesUI();

// ---------------- Desktop-only: one-time Excel import ----------------
// Note: window.prompt()/alert() aren't reliably supported in Electron's renderer,
// so this uses a real form (import-year-modal) instead of a JS prompt dialog.
const isElectron = typeof window.api !== 'undefined';
if (isElectron) {
  const MONTH_NUMBERS = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 };
  let pendingParsedData = null;

  el('import-excel-btn').classList.remove('hidden');

  el('import-excel-btn').addEventListener('click', async () => {
    const btn = el('import-excel-btn');
    btn.disabled = true;
    btn.textContent = 'Opening file…';
    try {
      const parsed = await window.api.chooseAndParseExcel();
      if (!parsed) return;
      pendingParsedData = parsed;
      el('import-year').value = String(new Date().getFullYear());
      el('import-error').textContent = '';
      el('import-status').textContent = '';
      el('import-year-modal').classList.remove('hidden');
    } catch (err) {
      el('import-error').textContent = err.message;
      el('import-year-modal').classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = '📥 Import from Excel';
    }
  });

  el('import-year-cancel').addEventListener('click', () => {
    pendingParsedData = null;
    el('import-year-modal').classList.add('hidden');
  });

  el('import-year-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!pendingParsedData) { el('import-year-modal').classList.add('hidden'); return; }
    const year = parseInt(el('import-year').value, 10);
    if (!year) return;

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    el('import-error').textContent = '';

    let count = 0;
    const failures = [];
    const total = Object.values(pendingParsedData).reduce((sum, arr) => sum + arr.length, 0);

    for (const [sport, students] of Object.entries(pendingParsedData)) {
      for (const s of students) {
        try {
          const months = {};
          (s.months || []).forEach((m) => {
            const num = MONTH_NUMBERS[m.name];
            if (!num) return;
            const key = `${year}-${String(num).padStart(2, '0')}`;
            const weeks = {};
            m.weeks.forEach((w) => { if (w.marked) weeks[w.label] = w.present; });
            if (Object.keys(weeks).length) months[key] = weeks;
          });
          await importStudent({ name: s.name, grade: s.grade, sport, months });
          count++;
        } catch (err) {
          console.error('Import failed for', s.name, sport, err);
          failures.push(`${s.name} (${sport}): ${err.message}`);
        }
        el('import-status').textContent = `Imported ${count}/${total}${failures.length ? `, ${failures.length} failed` : ''}…`;
      }
    }

    pendingParsedData = null;
    submitBtn.disabled = false;

    if (failures.length === 0) {
      el('import-status').textContent = `Done — imported ${count} of ${total} student record(s).`;
      setTimeout(() => el('import-year-modal').classList.add('hidden'), 1500);
    } else {
      el('import-status').textContent = `Imported ${count} of ${total}. ${failures.length} failed — see below.`;
      el('import-error').textContent = failures.slice(0, 5).join(' | ') + (failures.length > 5 ? ` (+${failures.length - 5} more)` : '');
    }
  });
}
