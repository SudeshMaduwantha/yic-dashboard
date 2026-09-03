import { Chart, BarController, CategoryScale, LinearScale, BarElement } from 'chart.js';
import ExcelJS from 'exceljs';
import { el, escapeHtml, escapeAttr, formatMonthLabel, allMonthKeys, presentTotalForMonths, SPORT_LOGOS, KNOWN_SPORTS, ROLE_LABELS, WEEKS, confirmDialog, buildPublicProfileSnapshot } from './utils.js';
import { getCurrentRole, isCoach, isSuperAdmin, isAdministrator } from './role-state.js';
import {
  updateStudentInfo, renameStudentInFees, getStudentMeta, setStudentMeta, syncPublicProfile,
  setSportCoach, getAllStudentMeta, deleteStudent, removeStudentSport, deleteStaffAccount, mergeStudents,
} from './firebase.js';

function canManageStudents() { return isSuperAdmin() || isAdministrator(); }

Chart.register(BarController, CategoryScale, LinearScale, BarElement);

let attendanceChart = null;
let incomeChart = null;
let allStudents = [];
let allFees = [];
let feesLoaded = false; // stays false for roles (coach) that never receive fee data at all
let allCoaches = [];
let allStaff = [];
const filters = { sport: 'all', grade: 'all', month: 'all', search: '' };
const profileFilters = { sport: 'all', grade: 'all' };
let detailStudentQuery = null; // set by openStudentDetail() — what "View Attendance" searches for
// Which of the selected student's own sports the profile's fee table is narrowed
// to — separate from profileFilters.sport above, which only narrows the student
// picker. Reset to 'all' whenever the picked student changes.
let summarySport = 'all';

// Overview and the Attendance Table sub-tab each have their own copy of the
// sport/grade/month/search controls but share one `filters` state — this keeps
// both sets of inputs showing the same values no matter which one changed.
function syncFilterInputs() {
  el('sport-filter').value = filters.sport;
  el('att-table-filter-sport').value = filters.sport;
  el('grade-filter').value = filters.grade;
  el('att-table-filter-grade').value = filters.grade;
  el('month-filter').value = filters.month;
  el('att-table-filter-month').value = filters.month;
  el('search-input').value = filters.search;
  el('att-table-filter-search').value = filters.search;
  syncSportStripActive();
}

export function initDashboardUI() {
  el('sport-filter').addEventListener('change', (e) => { filters.sport = e.target.value; syncFilterInputs(); render(); });
  el('grade-filter').addEventListener('change', (e) => { filters.grade = e.target.value; syncFilterInputs(); render(); });
  el('month-filter').addEventListener('change', (e) => { filters.month = e.target.value; syncFilterInputs(); render(); });
  el('search-input').addEventListener('input', (e) => { filters.search = e.target.value.trim().toLowerCase(); syncFilterInputs(); render(); });

  el('att-table-filter-sport').addEventListener('change', (e) => { filters.sport = e.target.value; syncFilterInputs(); render(); });
  el('att-table-filter-grade').addEventListener('change', (e) => { filters.grade = e.target.value; syncFilterInputs(); render(); });
  el('att-table-filter-month').addEventListener('change', (e) => { filters.month = e.target.value; syncFilterInputs(); render(); });
  el('att-table-filter-search').addEventListener('input', (e) => { filters.search = e.target.value.trim().toLowerCase(); syncFilterInputs(); render(); });

  el('student-profile-filter-sport').addEventListener('change', (e) => { profileFilters.sport = e.target.value; renderProfileFilterStudents(); });
  el('student-profile-filter-grade').addEventListener('change', (e) => { profileFilters.grade = e.target.value; renderProfileFilterStudents(); });
  el('student-filter').addEventListener('change', () => { summarySport = 'all'; renderStudentSummary(); });
  el('student-manage-save').addEventListener('click', () => saveStudentChanges(false));
  el('student-manage-sync').addEventListener('click', () => saveStudentChanges(true));
  el('student-manage-delete').addEventListener('click', deleteCurrentStudent);
  el('export-ids-btn').addEventListener('click', exportStudentIdsAndPins);
  el('att-table-export-btn').addEventListener('click', exportAttendanceToExcel);
  el('student-detail-close').addEventListener('click', closeStudentDetail);
  el('student-detail-modal').addEventListener('click', (e) => {
    if (e.target.id === 'student-detail-modal') closeStudentDetail();
  });
  el('student-detail-view-attendance').addEventListener('click', () => {
    if (!detailStudentQuery) return;
    closeStudentDetail();
    filters.search = detailStudentQuery;
    syncFilterInputs();
    render();
    document.querySelector('.sidebar-subitem[data-tab="dashboard-attendance-table"]')?.click();
  });
}

function closeStudentDetail() {
  el('student-detail-modal').classList.add('hidden');
}

function openStudentDetail(name) {
  const registrations = allStudents.filter((s) => s.name === name);
  if (registrations.length === 0) return;
  const grade = registrations.find((s) => s.grade)?.grade;
  const studentCode = registrations.find((s) => s.studentCode)?.studentCode;
  const phone = registrations.find((s) => s.phone)?.phone;
  // Prefer the unique Student ID over the name so "View Attendance" can't pick
  // up an unrelated student who happens to share the same name.
  detailStudentQuery = (studentCode || name).toLowerCase();

  el('student-detail-name').textContent = name;
  el('student-detail-info').innerHTML = [
    studentCode ? `<div class="student-detail-row"><span class="label">Student ID</span> ${escapeHtml(studentCode)}</div>` : '',
    phone ? `<div class="student-detail-row"><span class="label">Mobile</span> ${escapeHtml(phone)}</div>` : '',
    grade ? `<div class="student-detail-row"><span class="label">Grade</span> ${escapeHtml(String(grade))}</div>` : '',
  ].filter(Boolean).join('') || '<div class="empty-state">No extra details on file.</div>';

  el('student-detail-sports').innerHTML = registrations.map((s) => {
    const pt = presentTotalForMonths(s.months, 'all');
    const pct = pt.total ? Math.round((pt.present / pt.total) * 100) : 0;
    return `
      <div class="mini-sport-card">
        <div class="mini-sport-name">${escapeHtml(s.sport)}</div>
        <div class="bar-bg"><div class="bar-fill" style="width:${pct}%"></div></div>
        <div class="pct">${pt.present}/${pt.total} weeks · ${pct}%</div>
      </div>
    `;
  }).join('') || '<div class="empty-state">Not registered for any sport.</div>';

  el('student-detail-modal').classList.remove('hidden');
}

async function deleteCurrentStudent() {
  const name = el('student-filter').value;
  if (!name) return;
  const registrations = allStudents.filter((s) => s.name === name);
  const studentCode = registrations.find((s) => s.studentCode)?.studentCode || '';
  const sportsList = registrations.map((s) => s.sport).join(', ');
  const confirmed = await confirmDialog(
    `Delete ${name} (${sportsList})?\n\nThis permanently removes their registration, attendance, and fee records. This cannot be undone.`,
    { title: 'Delete student?' },
  );
  if (!confirmed) return;

  const btn = el('student-manage-delete');
  const errorEl = el('student-manage-error');
  errorEl.textContent = '';
  btn.disabled = true;
  try {
    await deleteStudent(registrations.map((s) => s.id), studentCode);
    allStudents = allStudents.filter((s) => s.name !== name);
    el('student-filter').value = '';
    populateFilterOptions();
    renderStudentSummary();
    render();
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

// Clears every cached module-level value and hides every role-gated panel.
// Called on logout so that switching accounts in the same running window (common
// on a shared staff PC) can never leave a lower-privilege login looking at data
// left over from the previous, more-privileged session — e.g. a Coach seeing the
// Staff Accounts table because it was rendered for a Super Admin earlier and
// nothing since then re-hid it (its visibility only re-evaluates when new staff
// data arrives, which never happens for a Coach).
export function resetDashboardUI() {
  allStudents = [];
  allFees = [];
  feesLoaded = false;
  allCoaches = [];
  allStaff = [];
  filters.sport = 'all'; filters.grade = 'all'; filters.month = 'all'; filters.search = '';
  el('export-actions').classList.add('hidden');
  el('staff-panel').classList.add('hidden');
  el('student-summary-panel').classList.add('hidden');
  el('student-filter').value = '';
  el('coaches-table-body').innerHTML = '';
  render();
}

export function updateDashboardData(students) {
  allStudents = students;
  el('export-actions').classList.toggle('hidden', !canManageStudents());
  populateFilterOptions();
  render();
  renderStudentSummary();
  renderDuplicateStudents();
}

// Same name + same sport registered more than once is an accidental double
// registration, not a multi-sport student (who legitimately has one doc per
// sport). Groups them so an admin can pick which record to keep.
function findDuplicateStudentGroups() {
  const groups = new Map();
  allStudents.forEach((s) => {
    const key = `${s.name.trim().toLowerCase()}::${s.sport}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  });
  return [...groups.values()].filter((g) => g.length > 1);
}

function renderDuplicateStudents() {
  const panel = el('duplicate-students-panel');
  if (!canManageStudents()) { panel.classList.add('hidden'); return; }
  const groups = findDuplicateStudentGroups();
  if (groups.length === 0) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');

  el('duplicate-students-list').innerHTML = groups.map((group, gi) => `
    <div class="duplicate-group">
      <div class="duplicate-group-title">${escapeHtml(group[0].name)} — ${escapeHtml(group[0].sport)} (${group.length}×)</div>
      ${group.map((s, i) => {
        const pt = presentTotalForMonths(s.months, 'all');
        return `
        <label class="duplicate-candidate">
          <input type="radio" name="dup-keep-${gi}" value="${escapeAttr(s.id)}" ${i === 0 ? 'checked' : ''} />
          Keep this one — Grade ${escapeHtml(String(s.grade || '—'))}, ID ${escapeHtml(s.studentCode || '—')}, Phone ${escapeHtml(s.phone || '—')}, ${pt.present}/${pt.total} weeks marked
        </label>`;
      }).join('')}
      <div class="modal-actions" style="justify-content: flex-start;">
        <button type="button" class="connect-btn duplicate-merge-btn" data-group="${gi}">Merge duplicates</button>
        <span class="duplicate-merge-status" data-group="${gi}"></span>
      </div>
    </div>
  `).join('');

  el('duplicate-students-list').querySelectorAll('.duplicate-merge-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const gi = Number(btn.dataset.group);
      const group = groups[gi];
      const keeperId = document.querySelector(`input[name="dup-keep-${gi}"]:checked`).value;
      const keeper = group.find((s) => s.id === keeperId);
      const duplicates = group.filter((s) => s.id !== keeperId);
      const statusEl = document.querySelector(`.duplicate-merge-status[data-group="${gi}"]`);
      btn.disabled = true;
      statusEl.textContent = 'Merging…';
      try {
        // Attendance union — the keeper's own mark always wins if both have one
        // for the same month+week, the duplicate only fills gaps the keeper has.
        const mergedMonths = { ...keeper.months };
        duplicates.forEach((dup) => {
          Object.entries(dup.months || {}).forEach(([monthKey, weeks]) => {
            mergedMonths[monthKey] = { ...(weeks || {}), ...(mergedMonths[monthKey] || {}) };
          });
        });
        const keeperUpdates = {
          months: mergedMonths,
          grade: keeper.grade || duplicates.find((d) => d.grade)?.grade || null,
          studentCode: keeper.studentCode || duplicates.find((d) => d.studentCode)?.studentCode || null,
          phone: keeper.phone || duplicates.find((d) => d.phone)?.phone || null,
        };
        await mergeStudents(keeperId, duplicates.map((d) => d.id), keeperUpdates);
        statusEl.textContent = 'Merged.';
      } catch (err) {
        statusEl.textContent = err.message;
        btn.disabled = false;
      }
    });
  });
}

export function updateDashboardFees(fees) {
  allFees = fees;
  feesLoaded = true;
  renderStudentSummary();
  renderIncomeChart();
}

export function updateCoaches(coaches) {
  allCoaches = coaches;
  renderCoachesPanel();
}

export function updateStaffList(staff) {
  allStaff = staff;
  renderStaffPanel();
}

function renderStaffPanel() {
  const panel = el('staff-panel');
  if (!isSuperAdmin()) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');

  const myUid = getCurrentRole()?.uid;
  const sorted = [...allStaff].sort((a, b) => (a.email || '').localeCompare(b.email || ''));
  el('staff-table-body').innerHTML = sorted.map((s, i) => {
    const sports = s.role === 'coach' ? (s.sports || []).join(', ') || '—' : '—';
    const isSelf = s.uid === myUid;
    return `
      <tr data-uid="${escapeAttr(s.uid)}">
        <td>${i + 1}</td>
        <td>${escapeHtml(s.email || '—')}</td>
        <td>${escapeHtml(ROLE_LABELS[s.role] || s.role)}</td>
        <td>${escapeHtml(sports)}</td>
        <td>${isSelf ? '' : '<button type="button" class="delete-btn staff-delete-btn">Delete</button>'}</td>
      </tr>
    `;
  }).join('');

  el('staff-table-body').querySelectorAll('.staff-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('tr');
      const uid = row.dataset.uid;
      const staffMember = allStaff.find((s) => s.uid === uid);
      const confirmed = await confirmDialog(
        `Delete staff account "${staffMember?.email}"?\n\nThey'll immediately lose access to the app. This cannot be undone from here.`,
        { title: 'Delete staff account?' },
      );
      if (!confirmed) return;
      btn.disabled = true;
      el('staff-panel-error').textContent = '';
      try {
        await deleteStaffAccount(uid);
      } catch (err) {
        el('staff-panel-error').textContent = err.message;
        btn.disabled = false;
      }
    });
  });
}

function renderCoachesPanel() {
  const sports = isCoach() ? getCurrentRole().sports : KNOWN_SPORTS;
  const canEdit = isSuperAdmin();
  el('coaches-table-body').innerHTML = sports.map((sport, i) => {
    const coach = allCoaches.find((c) => c.sport === sport) || {};
    if (canEdit) {
      return `
        <tr data-sport="${escapeAttr(sport)}">
          <td>${i + 1}</td>
          <td>${escapeHtml(sport)}</td>
          <td><input class="coach-input coach-email" type="email" value="${escapeAttr(coach.email || '')}" placeholder="—" /></td>
          <td><input class="coach-input coach-name" type="text" value="${escapeAttr(coach.name || '')}" placeholder="—" /></td>
          <td><input class="coach-input coach-phone" type="tel" value="${escapeAttr(coach.phone || '')}" placeholder="—" /></td>
          <td><button type="button" class="connect-btn coach-save-btn">Save</button></td>
        </tr>
      `;
    }
    return `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(sport)}</td>
        <td>${escapeHtml(coach.email || '—')}</td>
        <td>${escapeHtml(coach.name || '—')}</td>
        <td>${escapeHtml(coach.phone || '—')}</td>
        <td></td>
      </tr>
    `;
  }).join('');

  if (canEdit) {
    el('coaches-table-body').querySelectorAll('.coach-save-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('tr');
        const sport = row.dataset.sport;
        const name = row.querySelector('.coach-name').value.trim();
        const phone = row.querySelector('.coach-phone').value.trim();
        const email = row.querySelector('.coach-email').value.trim();
        btn.disabled = true;
        btn.textContent = 'Saving…';
        try {
          await setSportCoach(sport, { name, phone, email });
          btn.textContent = 'Saved ✓';
          setTimeout(() => { btn.textContent = 'Save'; }, 1500);
        } finally {
          btn.disabled = false;
        }
      });
    });
  }
}

function populateFilterOptions() {
  const sports = [...new Set(allStudents.map((s) => s.sport))].sort();
  const grades = [...new Set(allStudents.map((s) => s.grade).filter(Boolean))].sort();
  const months = allMonthKeys(allStudents);

  syncSelectOptions(el('sport-filter'), sports, 'All sports', (s) => s);
  syncSelectOptions(el('grade-filter'), grades, 'All grades', (g) => `Grade ${g}`);
  syncSelectOptions(el('month-filter'), months, 'All months', formatMonthLabel);
  syncSelectOptions(el('att-table-filter-sport'), sports, 'All sports', (s) => s);
  syncSelectOptions(el('att-table-filter-grade'), grades, 'All grades', (g) => `Grade ${g}`);
  syncSelectOptions(el('att-table-filter-month'), months, 'All months', formatMonthLabel);
  syncFilterInputs();

  syncSelectOptions(el('student-profile-filter-sport'), sports, 'All sports', (s) => s);
  syncSelectOptions(el('student-profile-filter-grade'), grades, 'All grades', (g) => `Grade ${g}`);
  profileFilters.sport = el('student-profile-filter-sport').value;
  profileFilters.grade = el('student-profile-filter-grade').value;
  renderProfileFilterStudents();

  // Coaches only ever see their own sport(s); everyone else sees all known sports,
  // even ones with zero students registered yet.
  renderSportStrip(isCoach() ? getCurrentRole().sports : KNOWN_SPORTS);
}

// Narrows the Student Profile picker to students matching the sport/grade
// filters above it — same shape as ui-fees.js's renderFeeFilterStudents().
function renderProfileFilterStudents() {
  const students = allStudents
    .filter((s) => profileFilters.sport === 'all' || s.sport === profileFilters.sport)
    .filter((s) => profileFilters.grade === 'all' || String(s.grade) === profileFilters.grade);
  const names = [...new Set(students.map((s) => s.name))].sort();

  const studentSelect = el('student-filter');
  const prevStudent = studentSelect.value;
  studentSelect.innerHTML = '<option value="">Pick a student…</option>' +
    names.map((n) => `<option value="${escapeAttr(n)}">${escapeHtml(n)}</option>`).join('');
  studentSelect.value = names.includes(prevStudent) ? prevStudent : '';
  renderStudentSummary();
}

function renderStudentSummary() {
  const name = el('student-filter').value;
  const panel = el('student-summary-panel');
  el('student-manage-status').textContent = '';
  el('student-manage-error').textContent = '';
  if (!name) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');

  const registrations = allStudents.filter((s) => s.name === name);
  const grade = registrations.find((s) => s.grade)?.grade;
  const studentCode = registrations.find((s) => s.studentCode)?.studentCode || '';
  const phone = registrations.find((s) => s.phone)?.phone || '';
  el('student-summary-title').textContent = `${name}${grade ? ` · Grade ${grade}` : ''}${studentCode ? ` · ${studentCode}` : ''}`;
  el('student-summary-contact').innerHTML = phone
    ? `<svg class="btn-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.36 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg> ${escapeHtml(phone)}`
    : '';

  // Reset the sport narrowing if it no longer matches one of this student's
  // registrations (e.g. stale selection left over from a previously viewed student).
  if (summarySport !== 'all' && !registrations.some((s) => s.sport === summarySport)) summarySport = 'all';

  const allChip = registrations.length > 1
    ? `<div class="mini-sport-card selectable all-sports${summarySport === 'all' ? ' active' : ''}" data-sport="all">
        <div class="mini-sport-name">All sports</div>
      </div>`
    : '';
  // Removing a sport only makes sense when there's another one left — a
  // single-sport student dropping their only sport is "Delete this student"
  // instead, which also cleans up their Student ID/PIN meta doc.
  const canRemoveSport = canManageStudents() && registrations.length > 1;
  el('student-summary-sports').innerHTML = allChip + (registrations.map((s) => {
    const pt = presentTotalForMonths(s.months, 'all');
    const pct = pt.total ? Math.round((pt.present / pt.total) * 100) : 0;
    const active = summarySport === s.sport ? ' active' : '';
    return `
      <div class="mini-sport-card selectable${active}" data-sport="${escapeAttr(s.sport)}">
        <div class="mini-sport-name">${escapeHtml(s.sport)}${canRemoveSport ? `<button type="button" class="mini-sport-remove-btn" data-remove-id="${escapeAttr(s.id)}" data-remove-sport="${escapeAttr(s.sport)}" title="Remove from ${escapeAttr(s.sport)}">✕</button>` : ''}</div>
        <div class="bar-bg"><div class="bar-fill" style="width:${pct}%"></div></div>
        <div class="pct">${pt.present}/${pt.total} weeks · ${pct}%</div>
      </div>
    `;
  }).join('') || '<div class="empty-state">Not registered for any sport.</div>');

  el('student-summary-sports').querySelectorAll('.mini-sport-card.selectable').forEach((card) => {
    card.addEventListener('click', () => { summarySport = card.dataset.sport; renderStudentSummary(); });
  });

  el('student-summary-sports').querySelectorAll('.mini-sport-remove-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.removeId;
      const sport = btn.dataset.removeSport;
      const confirmed = await confirmDialog(
        `Remove ${name} from ${sport}?\n\nThis deletes their ${sport} registration, attendance, and fee records for that sport only — their other sports are unaffected.`,
        { title: 'Remove from sport?' },
      );
      if (!confirmed) return;
      btn.disabled = true;
      try {
        await removeStudentSport(id);
        allStudents = allStudents.filter((s) => s.id !== id);
        if (summarySport === sport) summarySport = 'all';
        renderStudentSummary();
        populateFilterOptions();
        render();
      } catch (err) {
        el('student-manage-error').textContent = err.message;
        btn.disabled = false;
      }
    });
  });

  const manageSection = el('student-manage-section');
  manageSection.classList.toggle('hidden', !canManageStudents());
  if (canManageStudents()) {
    el('student-manage-name').value = name;
    el('student-manage-grade').value = grade || '';
    el('student-manage-phone').value = phone;
    el('student-manage-id').value = studentCode;
    el('student-manage-pin').value = '';
    if (studentCode) {
      getStudentMeta(studentCode).then((meta) => {
        // Only apply if the student filter hasn't changed while this was in flight.
        if (el('student-filter').value === name && meta && meta.pin) el('student-manage-pin').value = meta.pin;
      });
    }
  }

  if (!feesLoaded) {
    // Fees data unavailable for this role — skip the section entirely.
    el('student-summary-fees').innerHTML = '';
    el('student-summary-fee-table').classList.add('hidden');
    return;
  }
  const records = allFees.filter((f) => f.studentName === name && (summarySport === 'all' || f.sport === summarySport));
  const showAmounts = !isCoach();

  // Coaches only ever see paid/unpaid status, never amounts — same rule the
  // Attendance tab's fee pill already follows, so no Total Due/Paid pills either.
  if (showAmounts) {
    const totalDue = records.filter((f) => f.status === 'due').reduce((sum, f) => sum + Number(f.amount || 0), 0);
    const totalPaid = records.filter((f) => f.status === 'paid').reduce((sum, f) => sum + Number(f.amount || 0), 0);
    el('student-summary-fees').innerHTML = `
      <div class="fee-summary-pill ${totalDue > 0 ? 'due' : 'clear'}">Total Due: Rs. ${totalDue.toLocaleString()}</div>
      <div class="fee-summary-pill paid">Total Paid: Rs. ${totalPaid.toLocaleString()}</div>
    `;
  } else {
    el('student-summary-fees').innerHTML = '';
  }

  el('student-summary-fee-head').innerHTML = showAmounts
    ? '<tr><th>Sport</th><th>Month</th><th>Amount</th><th>Status</th></tr>'
    : '<tr><th>Sport</th><th>Month</th><th>Status</th></tr>';

  const feeTable = el('student-summary-fee-table');
  if (records.length === 0) {
    feeTable.classList.add('hidden');
  } else {
    feeTable.classList.remove('hidden');
    const sorted = [...records].sort((a, b) => (b.month || '').localeCompare(a.month || ''));
    el('student-summary-fee-body').innerHTML = sorted.map((r) => `
      <tr>
        <td>${escapeHtml(r.sport)}</td>
        <td>${escapeHtml(r.month)}</td>
        ${showAmounts ? `<td>Rs. ${Number(r.amount).toLocaleString()}</td>` : ''}
        <td><span class="status-pill ${r.status}">${r.status === 'paid' ? 'Paid' : 'Due'}</span></td>
      </tr>
    `).join('');
  }
}

async function saveStudentChanges(alsoSync) {
  const originalName = el('student-filter').value;
  if (!originalName) return;
  const newName = el('student-manage-name').value.trim();
  const newGrade = el('student-manage-grade').value.trim();
  const newPhone = el('student-manage-phone').value.trim();
  const code = el('student-manage-id').value.trim();
  const pin = el('student-manage-pin').value.trim();
  const statusEl = el('student-manage-status');
  const errorEl = el('student-manage-error');
  statusEl.textContent = '';
  errorEl.textContent = '';
  if (!newName) { errorEl.textContent = 'Name can\'t be empty.'; return; }
  if (!code) { errorEl.textContent = 'Enter a Student ID first.'; return; }

  const registrations = allStudents.filter((s) => s.name === originalName);
  const saveBtn = el('student-manage-save');
  const syncBtn = el('student-manage-sync');
  saveBtn.disabled = true;
  syncBtn.disabled = true;
  try {
    const ids = registrations.map((s) => s.id);
    await updateStudentInfo(ids, { name: newName, grade: newGrade, studentCode: code, phone: newPhone });
    if (newName !== originalName) await renameStudentInFees(ids, newName);
    if (pin) await setStudentMeta(code, { pin, name: newName });

    // Reflect the change immediately rather than waiting on the next snapshot round-trip.
    registrations.forEach((s) => {
      s.name = newName; s.grade = newGrade || null; s.studentCode = code || null; s.phone = newPhone || null;
    });
    if (newName !== originalName) {
      const sel = el('student-filter');
      if (![...sel.options].some((o) => o.value === newName)) {
        const opt = document.createElement('option');
        opt.value = newName;
        opt.textContent = newName;
        sel.appendChild(opt);
      }
      sel.value = newName;
    }
    statusEl.textContent = 'Saved.';

    if (alsoSync) {
      if (!pin) { errorEl.textContent = 'Set a PIN before syncing.'; return; }
      const { sports, feeRecords } = buildPublicProfileSnapshot(newName, allStudents, allFees);
      await syncPublicProfile(code, { name: newName, grade: newGrade || null, sports, feeRecords });
      statusEl.textContent = `Synced — parents can look up "${newName}" with ID ${code} and their PIN.`;
    }
    renderStudentSummary();
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    saveBtn.disabled = false;
    syncBtn.disabled = false;
  }
}

async function exportStudentIdsAndPins() {
  const btn = el('export-ids-btn');
  const statusEl = el('export-ids-status');
  btn.disabled = true;
  statusEl.textContent = 'Gathering…';
  try {
    const meta = await getAllStudentMeta();
    if (meta.length === 0) {
      statusEl.textContent = 'No students have a Student ID + PIN set yet.';
      return;
    }
    const gradeByName = new Map(allStudents.map((s) => [s.name, s.grade]));
    const sorted = [...meta].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const lines = [
      'YIC Sport School — Student Login IDs & PINs',
      `Generated: ${new Date().toLocaleString()}`,
      '',
      ...sorted.map((m) => {
        const grade = gradeByName.get(m.name);
        return `${m.name}${grade ? ` (Grade ${grade})` : ''} — ID: ${m.studentCode} — PIN: ${m.pin}`;
      }),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `student-ids-pins-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    statusEl.textContent = `Saved ${sorted.length} student(s) to your Downloads folder.`;
  } catch (err) {
    statusEl.textContent = `Export failed: ${err.message}`;
  } finally {
    btn.disabled = false;
    setTimeout(() => { statusEl.textContent = ''; }, 5000);
  }
}

function renderSportStrip(sports) {
  const allBadge = `
    <div class="sport-badge all-badge${filters.sport === 'all' ? ' active' : ''}" data-sport="all">
      <div class="sport-badge-label">All Sports</div>
    </div>`;
  const badges = sports.map((sport) => {
    const logo = SPORT_LOGOS[sport];
    const active = filters.sport === sport ? ' active' : '';
    return logo
      ? `<div class="sport-badge${active}" data-sport="${escapeAttr(sport)}"><img src="${logo}" alt="${escapeAttr(sport)} logo" /></div>`
      : `<div class="sport-badge${active}" data-sport="${escapeAttr(sport)}"><div class="sport-badge-label">${escapeHtml(sport)}</div></div>`;
  }).join('');

  el('sport-strip').innerHTML = allBadge + badges;
  el('sport-strip').querySelectorAll('.sport-badge').forEach((badge) => {
    badge.addEventListener('click', () => {
      filters.sport = badge.dataset.sport;
      el('sport-filter').value = filters.sport;
      render();
      syncSportStripActive();
    });
  });
}

function syncSportStripActive() {
  el('sport-strip').querySelectorAll('.sport-badge').forEach((b) => {
    b.classList.toggle('active', b.dataset.sport === filters.sport);
  });
}

function syncSelectOptions(selectEl, values, allLabel, labelFn) {
  const prev = selectEl.value || 'all';
  selectEl.innerHTML = `<option value="all">${allLabel}</option>` +
    values.map((v) => `<option value="${escapeAttr(v)}">${escapeHtml(labelFn(v))}</option>`).join('');
  selectEl.value = values.includes(prev) ? prev : 'all';
}

function getFlatRoster() {
  return allStudents
    .filter((s) => filters.sport === 'all' || s.sport === filters.sport)
    .filter((s) => filters.grade === 'all' || String(s.grade) === filters.grade)
    .filter((s) => !filters.search
      || s.name.toLowerCase().includes(filters.search)
      || (s.studentCode || '').toLowerCase().includes(filters.search))
    .map((s) => ({ ...s, ...presentTotalForMonths(s.months, filters.month) }));
}

function render() {
  renderStats();
  renderRoster();
  renderAttendanceTable();
  renderChart();
  renderIncomeChart();
}

function renderStats() {
  const roster = getFlatRoster();
  const totalPresent = roster.reduce((sum, r) => sum + r.present, 0);
  const totalMarked = roster.reduce((sum, r) => sum + r.total, 0);
  const avgAttendance = totalMarked ? Math.round((totalPresent / totalMarked) * 100) : 0;
  const perfectAttendance = roster.filter((r) => r.total > 0 && r.present === r.total).length;

  // roster has one row per sport-registration, so a student playing two sports is
  // counted twice in roster.length. This collapses those to a head-count of
  // distinct people — keyed on Student ID where set, name otherwise — matching
  // whatever sport/grade/search filters are currently applied.
  const individualStudents = new Set(
    roster.map((r) => (r.studentCode ? `id:${r.studentCode}` : `name:${r.name.toLowerCase()}`)),
  ).size;

  const stats = [
    { label: 'Individual students', value: individualStudents },
    { label: 'Registrations shown', value: roster.length },
    { label: 'Sports', value: new Set(allStudents.map((s) => s.sport)).size },
    { label: 'Avg. attendance', value: `${avgAttendance}%` },
    { label: 'Perfect attendance', value: perfectAttendance },
  ];
  el('stats-grid').innerHTML = stats.map((s) => `
    <div class="stat-card"><div class="value">${s.value}</div><div class="label">${s.label}</div></div>
  `).join('');
}

function renderRoster() {
  const roster = getFlatRoster();
  const container = el('roster-cards');
  if (roster.length === 0) {
    container.innerHTML = '<div class="empty-state">No students match the current filters.</div>';
    return;
  }
  container.innerHTML = roster.map((r) => {
    const pct = r.total ? Math.round((r.present / r.total) * 100) : 0;
    return `
      <div class="roster-card" data-name="${escapeAttr(r.name)}">
        <div class="name">${escapeHtml(r.name)}${r.studentCode ? ` <span class="student-code-tag">${escapeHtml(r.studentCode)}</span>` : ''}</div>
        <div class="meta">Grade ${escapeHtml(String(r.grade || '—'))} · ${escapeHtml(r.sport)}</div>
        <div class="bar-bg"><div class="bar-fill" style="width:${pct}%"></div></div>
        <div class="pct">${r.present}/${r.total} weeks · ${pct}%</div>
      </div>
    `;
  }).join('');
  container.querySelectorAll('.roster-card').forEach((card) => {
    card.addEventListener('click', () => openStudentDetail(card.dataset.name));
  });
}

// '5th' only exists in a month's data when that sport's class day actually
// happened a 5th time that month — show the column only then, so ordinary
// 4-week months don't carry a permanently empty 5th column.
function weeksForMonth(roster, monthKey) {
  const hasFifth = roster.some((r) => ((r.months || {})[monthKey] || {})['5th'] !== undefined);
  return hasFifth ? WEEKS : WEEKS.slice(0, 4);
}

function renderAttendanceTable() {
  const roster = getFlatRoster();
  const head = el('attendance-table-head');
  const body = el('attendance-table-body');
  el('att-table-total-count').textContent = `Total students: ${roster.length}`;

  if (filters.month === 'all') {
    const months = allMonthKeys(allStudents);
    head.innerHTML = `<tr><th>No.</th><th>Student ID</th><th>Name</th><th>Grade</th><th>Sport</th>${months.map((m) => `<th>${escapeHtml(formatMonthLabel(m))}</th>`).join('')}<th>Overall</th></tr>`;
    if (roster.length === 0) {
      body.innerHTML = `<tr><td colspan="${6 + months.length}" class="empty-state">No students match the current filters.</td></tr>`;
      return;
    }
    body.innerHTML = roster.map((r, i) => {
      const cells = months.map((m) => {
        const pt = presentTotalForMonths(r.months, m);
        return `<td>${pt.total ? `${pt.present}/${pt.total}` : '—'}</td>`;
      }).join('');
      return `<tr><td>${i + 1}</td><td>${escapeHtml(r.studentCode || '—')}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(String(r.grade || '—'))}</td><td>${escapeHtml(r.sport)}</td>${cells}<td>${r.present}/${r.total}</td></tr>`;
    }).join('');
    return;
  }

  const weeksToShow = weeksForMonth(roster, filters.month);
  head.innerHTML = `<tr><th>No.</th><th>Student ID</th><th>Name</th><th>Grade</th><th>Sport</th>${weeksToShow.map((w) => `<th>${w} Week</th>`).join('')}<th>Present / Total</th></tr>`;
  if (roster.length === 0) {
    body.innerHTML = `<tr><td colspan="${6 + weeksToShow.length}" class="empty-state">No students match the current filters.</td></tr>`;
    return;
  }
  body.innerHTML = roster.map((r, i) => {
    const weeks = (r.months || {})[filters.month] || {};
    const weekCells = weeksToShow.map((w) => {
      const v = weeks[w];
      const cls = v === true ? 'present' : v === false ? 'absent' : 'unmarked';
      const symbol = v === true ? '✓' : v === false ? '✕' : '–';
      return `<td><span class="mark ${cls}">${symbol}</span></td>`;
    }).join('');
    return `<tr><td>${i + 1}</td><td>${escapeHtml(r.studentCode || '—')}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(String(r.grade || '—'))}</td><td>${escapeHtml(r.sport)}</td>${weekCells}<td>${r.present}/${r.total}</td></tr>`;
  }).join('');
}

// Mirrors renderAttendanceTable()'s two layouts, over whatever getFlatRoster()
// currently returns — so the export always matches the sport/grade/month/search
// filters applied on screen.
async function exportAttendanceToExcel() {
  const btn = el('att-table-export-btn');
  const label = el('att-table-export-btn-label');
  btn.disabled = true;
  label.textContent = 'Exporting…';
  try {
    const roster = getFlatRoster();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Attendance');

    if (filters.month === 'all') {
      const months = allMonthKeys(allStudents);
      sheet.columns = [
        { header: 'No.', key: 'no', width: 6 },
        { header: 'Student ID', key: 'studentCode', width: 14 },
        { header: 'Name', key: 'name', width: 28 },
        { header: 'Grade', key: 'grade', width: 10 },
        { header: 'Sport', key: 'sport', width: 18 },
        ...months.map((m) => ({ header: formatMonthLabel(m), key: m, width: 12 })),
        { header: 'Overall', key: 'overall', width: 12 },
      ];
      sheet.getRow(1).font = { bold: true };
      roster.forEach((r, i) => {
        const row = {
          no: i + 1, studentCode: r.studentCode || '', name: r.name, grade: r.grade || '', sport: r.sport,
          overall: `${r.present}/${r.total}`,
        };
        months.forEach((m) => {
          const pt = presentTotalForMonths(r.months, m);
          row[m] = pt.total ? `${pt.present}/${pt.total}` : '—';
        });
        sheet.addRow(row);
      });
    } else {
      const weeksToShow = weeksForMonth(roster, filters.month);
      sheet.columns = [
        { header: 'No.', key: 'no', width: 6 },
        { header: 'Student ID', key: 'studentCode', width: 14 },
        { header: 'Name', key: 'name', width: 28 },
        { header: 'Grade', key: 'grade', width: 10 },
        { header: 'Sport', key: 'sport', width: 18 },
        ...weeksToShow.map((w) => ({ header: `${w} Week`, key: w, width: 10 })),
        { header: 'Present / Total', key: 'overall', width: 14 },
      ];
      sheet.getRow(1).font = { bold: true };
      roster.forEach((r, i) => {
        const weeks = (r.months || {})[filters.month] || {};
        const symbol = (v) => (v === true ? 'Present' : v === false ? 'Absent' : '—');
        const row = {
          no: i + 1, studentCode: r.studentCode || '', name: r.name, grade: r.grade || '', sport: r.sport,
          overall: `${r.present}/${r.total}`,
        };
        weeksToShow.forEach((w) => { row[w] = symbol(weeks[w]); });
        sheet.addRow(row);
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } finally {
    btn.disabled = false;
    label.textContent = 'Export to Excel';
  }
}

function renderChart() {
  const sports = [...new Set(allStudents.map((s) => s.sport))].sort();
  const labels = [];
  const data = [];
  sports.forEach((sport) => {
    let present = 0, total = 0;
    allStudents.filter((s) => s.sport === sport).forEach((s) => {
      const pt = presentTotalForMonths(s.months, filters.month);
      present += pt.present;
      total += pt.total;
    });
    labels.push(sport);
    data.push(total ? Math.round((present / total) * 100) : 0);
  });

  const ctx = el('attendance-chart').getContext('2d');
  if (attendanceChart) attendanceChart.destroy();
  attendanceChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Attendance %', data, backgroundColor: '#f5941f', borderRadius: 6 }] },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, max: 100, ticks: { color: '#8b93a7' }, grid: { color: '#272c3a' } },
        x: { ticks: { color: '#8b93a7' }, grid: { display: false } },
      },
    },
  });
}

// Coaches never see money (same rule as the fee amounts hidden throughout the
// Student Profile / Attendance-mark fee pills) — the whole panel is gated off.
function renderIncomeChart() {
  const panel = el('income-chart-panel');
  if (isCoach()) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');

  const months = [...new Set(allFees.map((f) => f.month))].filter(Boolean).sort();
  const data = months.map((m) => allFees
    .filter((f) => f.month === m && f.status === 'paid')
    .reduce((sum, f) => sum + (Number(f.amount) || 0), 0));
  const labels = months.map(formatMonthLabel);

  const ctx = el('income-chart').getContext('2d');
  if (incomeChart) incomeChart.destroy();
  incomeChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Income (Rs.)', data, backgroundColor: '#22c58b', borderRadius: 6, maxBarThickness: 56 }] },
    options: {
      responsive: true,
      // This panel is full-width (unlike the paired attendance chart, which sits
      // in a two-column grid) — without this, Chart.js's default aspectRatio of 2
      // computes height from that full width, rendering a wildly oversized chart.
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx2) => `Rs. ${ctx2.parsed.y.toLocaleString()}` } },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { color: '#8b93a7', callback: (v) => `Rs. ${Number(v).toLocaleString()}` },
          grid: { color: '#272c3a' },
        },
        x: { ticks: { color: '#8b93a7' }, grid: { display: false } },
      },
    },
  });
}
