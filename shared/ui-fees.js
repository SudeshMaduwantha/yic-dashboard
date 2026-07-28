import ExcelJS from 'exceljs';
import { el, escapeHtml, escapeAttr, KNOWN_SPORTS, monthRange, currentMonthKey, buildPublicProfileSnapshot, presentTotalForMonths } from './utils.js';
import {
  addFee, updateFee, deleteFee, getStudentMeta, getAllStudentMeta, syncPublicProfile, setSportFee,
} from './firebase.js';
import { isSuperAdmin, isAdministrator } from './role-state.js';

let allStudents = [];
let allFees = [];
let editingId = null;
let currentRows = []; // whatever's currently on screen after filters — what Export sends
const filters = {
  sport: 'all', student: 'all', status: 'all', monthFrom: '', monthTo: '',
};

let sportFeeAmounts = {}; // { [sport]: amount } — standard monthly fee, set on the Sport Fees panel

let currentReportRows = []; // Collection Report's current filtered/grouped rows — what its Export sends
const reportFilters = { sport: 'all' };

let lastBulkAddIds = []; // doc IDs from the most recent bulkAddDueForSport() run — what "Undo last add" removes

function canManageFees() { return isSuperAdmin() || isAdministrator(); }

// Best-effort — never lets a sync hiccup surface as an error on top of a
// successful fee save. Silently no-ops for students who don't have a Student
// ID + PIN set up for the parent portal yet (most won't).
async function autoSyncPublicProfile(studentName) {
  const student = allStudents.find((s) => s.name === studentName);
  const code = student?.studentCode;
  if (!code) return;
  try {
    const meta = await getStudentMeta(code);
    if (!meta || !meta.pin) return;
    const { grade, sports, feeRecords } = buildPublicProfileSnapshot(studentName, allStudents, allFees);
    await syncPublicProfile(code, { name: studentName, grade, sports, feeRecords });
  } catch (err) {
    console.error('Auto-sync failed for', studentName, err);
  }
}

export function initFeesUI() {
  el('fee-student').addEventListener('change', renderFeeSportChecks);

  el('fee-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const studentName = el('fee-student').value;
    if (!studentName) return;
    const status = el('fee-status').value;
    const months = monthRange(el('fee-month').value, el('fee-month-to').value);
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      if (editingId) {
        const amount = Number(el('fee-edit-amount').value);
        await updateFee(editingId, { amount, status, month: el('fee-month').value });
      } else {
        // One fee record per checked sport per month — a multi-sport student
        // getting several records in one submit is the whole point of this form.
        const picks = [...el('fee-sport-checks').querySelectorAll('.fee-sport-check-row')]
          .map((row) => ({
            checkbox: row.querySelector('.fee-sport-check-box'),
            amountInput: row.querySelector('.fee-sport-check-amount'),
          }))
          .filter((p) => p.checkbox.checked)
          .map((p) => ({ sport: p.checkbox.dataset.sport, studentId: p.checkbox.dataset.studentId, amount: Number(p.amountInput.value) || 0 }));
        for (const pick of picks) {
          for (const month of months) {
            await addFee({ studentId: pick.studentId, studentName, sport: pick.sport, amount: pick.amount, status, month });
          }
        }
      }
      cancelEditFee();
      populateFeeStudentSelect();
      autoSyncPublicProfile(studentName);
    } finally {
      btn.disabled = false;
    }
  });

  el('fee-form-cancel').addEventListener('click', cancelEditFee);

  el('fee-status').addEventListener('change', updateStatusSelectColor);
  updateStatusSelectColor();

  el('fee-same-amount-toggle').addEventListener('change', (e) => {
    const on = e.target.checked;
    el('fee-same-amount-group').classList.toggle('hidden', !on);
    el('fee-sport-checks').querySelectorAll('.fee-sport-check-amount').forEach((input) => { input.disabled = on; });
    if (on) applySameAmountToAll();
    updateTotalCollectable();
  });
  el('fee-same-amount').addEventListener('input', () => {
    applySameAmountToAll();
    updateTotalCollectable();
  });

  el('fee-filter-sport').addEventListener('change', (e) => { filters.sport = e.target.value; renderFeeFilterStudents(); renderFeesTable(); });
  el('fee-filter-student').addEventListener('change', (e) => { filters.student = e.target.value; renderFeesTable(); });
  el('fee-filter-status').addEventListener('change', (e) => { filters.status = e.target.value; renderFeesTable(); });
  el('fee-filter-month-from').addEventListener('change', (e) => { filters.monthFrom = e.target.value; renderFeesTable(); });
  el('fee-filter-month-to').addEventListener('change', (e) => { filters.monthTo = e.target.value; renderFeesTable(); });

  el('fees-export-btn').addEventListener('click', exportFeesToExcel);
  el('fees-print-btn').addEventListener('click', () => window.print());
  el('fees-sync-web-btn').addEventListener('click', syncAllToWeb);

  // Bulk Add — Due for a whole sport.
  el('bulk-due-month').value = currentMonthKey();
  el('bulk-due-sport').addEventListener('change', () => {
    el('bulk-due-amount').value = sportFeeAmounts[el('bulk-due-sport').value] ?? '';
  });
  el('bulk-due-btn').addEventListener('click', bulkAddDueForSport);
  el('bulk-due-undo-btn').addEventListener('click', undoLastBulkAdd);

  // Collection Report — defaults to "this month" so the tab is useful with zero setup.
  const nowKey = currentMonthKey();
  el('report-month-from').value = nowKey;
  el('report-month-to').value = nowKey;
  el('report-month-from').addEventListener('change', renderCollectionReport);
  el('report-month-to').addEventListener('change', renderCollectionReport);
  el('report-filter-sport').addEventListener('change', (e) => { reportFilters.sport = e.target.value; renderCollectionReport(); });
  el('report-export-btn').addEventListener('click', exportReportToExcel);
}

// Generates a Due record for every student in one sport at once — the start-of-month
// billing run, instead of adding each student one at a time. Skips anyone who
// already has a record for that sport+month so re-running it is always safe.
async function bulkAddDueForSport() {
  const sport = el('bulk-due-sport').value;
  const amount = Number(el('bulk-due-amount').value) || 0;
  const months = monthRange(el('bulk-due-month').value, el('bulk-due-month-to').value);
  const statusEl = el('bulk-due-status');
  if (!sport || !el('bulk-due-month').value) {
    statusEl.textContent = 'Pick a sport and a month first.';
    return;
  }
  const registrations = allStudents.filter((s) => s.sport === sport);
  if (registrations.length === 0) {
    statusEl.textContent = `No students registered for ${sport} yet.`;
    return;
  }
  const btn = el('bulk-due-btn');
  const undoBtn = el('bulk-due-undo-btn');
  btn.disabled = true;
  undoBtn.classList.add('hidden');
  statusEl.textContent = 'Adding…';
  let added = 0, skipped = 0;
  const addedIds = [];
  try {
    for (const student of registrations) {
      for (const month of months) {
        const exists = allFees.some((f) => f.studentId === student.id && f.sport === sport && f.month === month);
        if (exists) { skipped++; continue; }
        const ref = await addFee({ studentId: student.id, studentName: student.name, sport, amount, status: 'due', month });
        addedIds.push(ref.id);
        added++;
      }
    }
    statusEl.textContent = `Added ${added} due record(s)${skipped ? `, skipped ${skipped} already recorded` : ''}.`;
    lastBulkAddIds = addedIds;
    undoBtn.classList.toggle('hidden', addedIds.length === 0);
    const names = [...new Set(registrations.map((s) => s.name))];
    names.forEach((name) => autoSyncPublicProfile(name));
  } finally {
    btn.disabled = false;
  }
}

// Removes exactly the records the last bulkAddDueForSport() run created — leaves
// anything it skipped (because a record already existed) untouched. Picking a
// too-wide month range and only noticing after clicking "Add Due records" is the
// whole reason this exists.
async function undoLastBulkAdd() {
  if (lastBulkAddIds.length === 0) return;
  const ids = lastBulkAddIds;
  const statusEl = el('bulk-due-status');
  const undoBtn = el('bulk-due-undo-btn');
  undoBtn.disabled = true;
  statusEl.textContent = `Undoing ${ids.length} record(s)…`;
  try {
    await Promise.all(ids.map((id) => deleteFee(id)));
    statusEl.textContent = `Undone — removed ${ids.length} due record(s).`;
    lastBulkAddIds = [];
    undoBtn.classList.add('hidden');
  } finally {
    undoBtn.disabled = false;
  }
}

// Catches up every student's public parent-lookup profile in one go — for drift
// that predates auto-sync, or just peace of mind after a bulk editing session.
async function syncAllToWeb() {
  const btn = el('fees-sync-web-btn');
  const label = el('fees-sync-web-btn-label');
  const statusEl = el('fees-sync-web-status');
  btn.disabled = true;
  try {
    const meta = await getAllStudentMeta();
    if (meta.length === 0) {
      statusEl.textContent = 'No students have a Student ID + PIN set yet.';
      return;
    }
    let count = 0;
    for (const m of meta) {
      label.textContent = `Syncing ${count + 1}/${meta.length}…`;
      const { grade, sports, feeRecords } = buildPublicProfileSnapshot(m.name, allStudents, allFees);
      try {
        await syncPublicProfile(m.studentCode, { name: m.name, grade, sports, feeRecords });
        count++;
      } catch (err) {
        console.error('Sync to Web failed for', m.name, err);
      }
    }
    statusEl.textContent = `Synced ${count} of ${meta.length} student(s).`;
  } finally {
    btn.disabled = false;
    label.textContent = 'Sync to Web';
    setTimeout(() => { statusEl.textContent = ''; }, 6000);
  }
}

async function exportFeesToExcel() {
  const btn = el('fees-export-btn');
  const label = el('fees-export-btn-label');
  btn.disabled = true;
  label.textContent = 'Exporting…';
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Fee records');
    sheet.columns = [
      { header: 'No.', key: 'no', width: 6 },
      { header: 'Student ID', key: 'studentCode', width: 14 },
      { header: 'Name', key: 'name', width: 28 },
      { header: 'Sport', key: 'sport', width: 22 },
      { header: 'Month', key: 'month', width: 12 },
      { header: 'Amount (Rs.)', key: 'amount', width: 14 },
      { header: 'Status', key: 'status', width: 10 },
    ];
    sheet.getRow(1).font = { bold: true };
    currentRows.forEach((r, i) => {
      const student = allStudents.find((s) => s.id === r.studentId);
      sheet.addRow({
        no: i + 1, studentCode: student?.studentCode || '', name: r.studentName, sport: r.sport, month: r.month,
        amount: Number(r.amount) || 0, status: r.status === 'paid' ? 'Paid' : 'Due',
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fee-records-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } finally {
    btn.disabled = false;
    label.textContent = 'Export to Excel';
  }
}

// Red for Due, green for Paid — mirrors the status pills so the choice reads
// at a glance instead of needing to read the word.
function updateStatusSelectColor() {
  const sel = el('fee-status');
  sel.classList.toggle('status-select-due', sel.value === 'due');
  sel.classList.toggle('status-select-paid', sel.value === 'paid');
}

function cancelEditFee() {
  editingId = null;
  el('fee-form').reset();
  el('fee-form-submit').textContent = 'Add records';
  el('fee-form-cancel').classList.add('hidden');
  el('fee-student').disabled = false;
  el('fee-month-to').disabled = false;
  el('fee-month-to').closest('.filter-group').classList.remove('hidden');
  el('fee-edit-sport-group').classList.add('hidden');
  el('fee-edit-amount-group').classList.add('hidden');
  updateStatusSelectColor();
  renderFeeSportChecks();
}

function startEditFee(record) {
  // Add Record and Ledger are separate sidebar sub-tabs now — jump to Add
  // Record first, otherwise the edit form fills in on a hidden tab and
  // nothing visibly happens.
  document.querySelector('.sidebar-subitem[data-tab="fees-add"]')?.click();
  editingId = record.id;
  el('fee-student').value = record.studentName;
  el('fee-student').disabled = true;
  el('fee-sport-checks-wrap').classList.add('hidden');
  el('fee-edit-sport-group').classList.remove('hidden');
  el('fee-edit-sport-label').textContent = record.sport;
  el('fee-edit-amount-group').classList.remove('hidden');
  el('fee-edit-amount').value = record.amount;
  el('fee-month').value = record.month;
  el('fee-status').value = record.status;
  updateStatusSelectColor();
  el('fee-form-submit').textContent = 'Update record';
  el('fee-form-cancel').classList.remove('hidden');
  // Editing always targets one existing record — the multi-month range only applies when adding new ones.
  el('fee-month-to').value = '';
  el('fee-month-to').disabled = true;
  el('fee-month-to').closest('.filter-group').classList.add('hidden');
  el('fee-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Every sport this student is registered for, each pre-filled (editable) with
// that sport's configured monthly fee — checked by default so the "total
// collectable" reflects everything they owe across all their sports at once.
function renderFeeSportChecks() {
  if (editingId) return;
  const name = el('fee-student').value;
  const registrations = allStudents.filter((s) => s.name === name);
  const wrap = el('fee-sport-checks-wrap');
  // Fresh student, fresh "same amount" state — the toggle from a previous student shouldn't linger.
  el('fee-same-amount-toggle').checked = false;
  el('fee-same-amount-group').classList.add('hidden');
  el('fee-same-amount').value = '';
  if (!name || registrations.length === 0) {
    wrap.classList.add('hidden');
    el('fee-sport-checks').innerHTML = '';
    el('fee-total-collectable').textContent = '';
    return;
  }
  wrap.classList.remove('hidden');
  el('fee-sport-checks').innerHTML = registrations.map((s) => `
    <label class="fee-sport-check-row">
      <input type="checkbox" class="fee-sport-check-box" data-sport="${escapeAttr(s.sport)}" data-student-id="${escapeAttr(s.id)}" checked />
      <span class="fee-sport-check-name">${escapeHtml(s.sport)}</span>
      <input type="number" min="0" step="1" class="fee-sport-check-amount" value="${sportFeeAmounts[s.sport] ?? ''}" placeholder="Amount" />
    </label>
  `).join('');
  el('fee-sport-checks').querySelectorAll('.fee-sport-check-box, .fee-sport-check-amount').forEach((input) => {
    input.addEventListener('input', updateTotalCollectable);
  });
  updateTotalCollectable();
}

// While "same amount for all sports" is on, every sport's amount field is
// locked to this one value — the whole point is one number instead of tuning
// each sport individually.
function applySameAmountToAll() {
  const value = el('fee-same-amount').value;
  el('fee-sport-checks').querySelectorAll('.fee-sport-check-amount').forEach((input) => { input.value = value; });
}

function updateTotalCollectable() {
  const total = [...el('fee-sport-checks').querySelectorAll('.fee-sport-check-row')]
    .filter((row) => row.querySelector('.fee-sport-check-box').checked)
    .reduce((sum, row) => sum + (Number(row.querySelector('.fee-sport-check-amount').value) || 0), 0);
  el('fee-total-collectable').textContent = `Total collectable: Rs. ${total.toLocaleString()}`;
}

function renderSportFeesPanel() {
  const canEdit = isSuperAdmin();
  el('sport-fees-table-body').innerHTML = KNOWN_SPORTS.map((sport, i) => {
    const amount = sportFeeAmounts[sport];
    if (canEdit) {
      return `
        <tr data-sport="${escapeAttr(sport)}">
          <td>${i + 1}</td>
          <td>${escapeHtml(sport)}</td>
          <td><input class="sport-fee-input" type="number" min="0" step="1" value="${amount ?? ''}" placeholder="—" /></td>
          <td><button type="button" class="connect-btn sport-fee-save-btn">Save</button></td>
        </tr>
      `;
    }
    return `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(sport)}</td>
        <td>${amount != null ? `Rs. ${Number(amount).toLocaleString()}` : '—'}</td>
        <td></td>
      </tr>
    `;
  }).join('');

  if (canEdit) {
    el('sport-fees-table-body').querySelectorAll('.sport-fee-save-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('tr');
        const sport = row.dataset.sport;
        const amount = row.querySelector('.sport-fee-input').value;
        btn.disabled = true;
        btn.textContent = 'Saving…';
        try {
          await setSportFee(sport, amount);
          btn.textContent = 'Saved ✓';
          setTimeout(() => { btn.textContent = 'Save'; }, 1500);
        } finally {
          btn.disabled = false;
        }
      });
    });
  }
}

export function updateSportFees(fees) {
  sportFeeAmounts = {};
  fees.forEach((f) => { sportFeeAmounts[f.sport] = f.amount; });
  renderSportFeesPanel();
  renderFeeSportChecks();
  const bulkSport = el('bulk-due-sport').value;
  if (bulkSport) el('bulk-due-amount').value = sportFeeAmounts[bulkSport] ?? '';
}

export function updateFeesStudentData(students) {
  allStudents = students;
  el('fees-form-panel').classList.toggle('hidden', !canManageFees());
  const sports = [...new Set([...KNOWN_SPORTS, ...students.map((s) => s.sport)])];

  populateFeeStudentSelect();
  if (!editingId) renderFeeSportChecks();

  const bulkSportSelect = el('bulk-due-sport');
  const prevBulkSport = bulkSportSelect.value;
  bulkSportSelect.innerHTML = sports.map((s) => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('');
  if (sports.includes(prevBulkSport)) bulkSportSelect.value = prevBulkSport;
  if (!el('bulk-due-amount').value) el('bulk-due-amount').value = sportFeeAmounts[bulkSportSelect.value] ?? '';

  const filterSportSelect = el('fee-filter-sport');
  const prevFilterSport = filterSportSelect.value || 'all';
  filterSportSelect.innerHTML = '<option value="all">All sports</option>' +
    sports.map((s) => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('');
  filterSportSelect.value = sports.includes(prevFilterSport) ? prevFilterSport : 'all';
  filters.sport = filterSportSelect.value;
  renderFeeFilterStudents();

  const reportSportSelect = el('report-filter-sport');
  const prevReportSport = reportSportSelect.value || 'all';
  reportSportSelect.innerHTML = '<option value="all">All sports</option>' +
    sports.map((s) => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('');
  reportSportSelect.value = sports.includes(prevReportSport) ? prevReportSport : 'all';
  reportFilters.sport = reportSportSelect.value;
  renderCollectionReport();
}

function populateFeeStudentSelect() {
  const prev = el('fee-student').value;
  const names = [...new Set(allStudents.map((s) => s.name))].sort((a, b) => a.localeCompare(b));
  el('fee-student').innerHTML = names.length
    ? '<option value="" disabled>Pick a student…</option>' + names.map((n) => `<option value="${escapeAttr(n)}">${escapeHtml(n)}</option>`).join('')
    : '<option value="" disabled selected>No students registered yet</option>';
  if (names.includes(prev)) el('fee-student').value = prev;
}

function renderFeeFilterStudents() {
  const sport = filters.sport;
  const students = (sport === 'all' ? allStudents : allStudents.filter((s) => s.sport === sport))
    .sort((a, b) => a.name.localeCompare(b.name));
  const select = el('fee-filter-student');
  const prev = select.value || 'all';
  select.innerHTML = '<option value="all">All students</option>' +
    students.map((s) => `<option value="${escapeAttr(s.id)}">${escapeHtml(s.name)}</option>`).join('');
  select.value = students.some((s) => s.id === prev) ? prev : 'all';
  filters.student = select.value;
}

export function updateFeesData(fees) {
  allFees = fees;
  renderFeesTable();
  renderCollectionReport();
}

function renderFeesTable() {
  const body = el('fees-table-body');
  const head = el('fees-table-head');
  const showSport = filters.sport === 'all';

  // Grouped by student (then newest month first within each) so the same
  // student's records sit together and No./Student ID/Name can be merged with
  // rowspan below instead of repeating on every line.
  const months = filters.monthFrom ? monthRange(filters.monthFrom, filters.monthTo) : null;
  const rows = allFees
    .filter((r) => filters.sport === 'all' || r.sport === filters.sport)
    .filter((r) => filters.student === 'all' || r.studentId === filters.student)
    .filter((r) => filters.status === 'all' || r.status === filters.status)
    .filter((r) => !months || months.includes(r.month))
    .sort((a, b) => a.studentName.localeCompare(b.studentName) || (b.month || '').localeCompare(a.month || ''));
  currentRows = rows;

  const totalDue = rows.filter((r) => r.status === 'due').reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const totalPaid = rows.filter((r) => r.status === 'paid').reduce((sum, r) => sum + Number(r.amount || 0), 0);
  el('fees-stats').innerHTML = `
    <div class="stat-card"><div class="value" style="color:var(--danger)">Rs. ${totalDue.toLocaleString()}</div><div class="label">Total due</div></div>
    <div class="stat-card"><div class="value" style="color:var(--accent-2)">Rs. ${totalPaid.toLocaleString()}</div><div class="label">Total income collected</div></div>
    <div class="stat-card"><div class="value">${rows.length}</div><div class="label">Records shown</div></div>
  `;

  const colCount = 7 + (showSport ? 1 : 0);
  head.innerHTML = `
    <tr>
      <th>No.</th><th>Student ID</th><th>Name</th>${showSport ? '<th>Sport</th>' : ''}<th>Month</th><th>Attendance</th><th>Amount</th><th>Status</th><th></th>
    </tr>
  `;

  if (rows.length === 0) {
    body.innerHTML = `<tr><td colspan="${colCount}" class="empty-state">No fee records match.</td></tr>`;
    return;
  }
  const canEdit = canManageFees();
  const groupSizes = new Map();
  rows.forEach((r) => groupSizes.set(r.studentName, (groupSizes.get(r.studentName) || 0) + 1));

  let studentNo = 0;
  let lastName = null;
  body.innerHTML = rows.map((r) => {
    const isNewGroup = r.studentName !== lastName;
    lastName = r.studentName;
    const student = allStudents.find((s) => s.id === r.studentId);
    let leadCells = '';
    if (isNewGroup) {
      studentNo++;
      const span = groupSizes.get(r.studentName);
      leadCells = `
        <td rowspan="${span}">${studentNo}</td>
        <td rowspan="${span}">${escapeHtml(student?.studentCode || '—')}</td>
        <td rowspan="${span}">${escapeHtml(r.studentName)}</td>
      `;
    }
    const pt = presentTotalForMonths(student?.months, r.month);
    return `
      <tr>
        ${leadCells}
        ${showSport ? `<td>${escapeHtml(r.sport)}</td>` : ''}
        <td>${escapeHtml(r.month)}</td>
        <td>${pt.total ? `${pt.present}/${pt.total}` : '—'}</td>
        <td>Rs. ${Number(r.amount).toLocaleString()}</td>
        <td><span class="status-pill ${r.status}">${r.status === 'paid' ? 'Paid' : 'Due'}</span></td>
        <td>${canEdit ? `${r.status === 'due' ? `<button class="mark-paid-btn" data-id="${escapeAttr(r.id)}">Mark Paid</button> ` : ''}<button class="edit-btn" data-id="${escapeAttr(r.id)}">Edit</button>` : ''}</td>
      </tr>
    `;
  }).join('');

  body.querySelectorAll('.mark-paid-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const record = rows.find((r) => r.id === btn.dataset.id);
      if (!record) return;
      btn.disabled = true;
      await updateFee(record.id, { amount: record.amount, status: 'paid', month: record.month });
      autoSyncPublicProfile(record.studentName);
    });
  });

  body.querySelectorAll('.edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const record = rows.find((r) => r.id === btn.dataset.id);
      if (record) startEditFee(record);
    });
  });
}

// "From that month through to now" collection summary — one row per student
// (aggregated, not itemized; the itemized view already exists in the Ledger above).
function renderCollectionReport() {
  const from = el('report-month-from')?.value;
  const to = el('report-month-to')?.value;
  const body = el('report-table-body');
  if (!from || !body) return;
  const months = monthRange(from, to);

  const rows = allFees
    .filter((r) => months.includes(r.month))
    .filter((r) => reportFilters.sport === 'all' || r.sport === reportFilters.sport);

  const byStudent = new Map();
  rows.forEach((r) => {
    if (!byStudent.has(r.studentId)) {
      const student = allStudents.find((s) => s.id === r.studentId);
      byStudent.set(r.studentId, {
        name: r.studentName, studentCode: student?.studentCode || '', sports: new Set(), paid: 0, due: 0,
      });
    }
    const entry = byStudent.get(r.studentId);
    entry.sports.add(r.sport);
    if (r.status === 'paid') entry.paid += Number(r.amount) || 0;
    else entry.due += Number(r.amount) || 0;
  });

  const entries = [...byStudent.values()].sort((a, b) => a.name.localeCompare(b.name));
  currentReportRows = entries;

  const totalPending = entries.reduce((sum, e) => sum + e.due, 0);
  const totalCollected = entries.reduce((sum, e) => sum + e.paid, 0);
  el('report-stats').innerHTML = `
    <div class="stat-card"><div class="value">${entries.length}</div><div class="label">Total students</div></div>
    <div class="stat-card"><div class="value" style="color:var(--danger)">Rs. ${totalPending.toLocaleString()}</div><div class="label">Payment pending total</div></div>
    <div class="stat-card"><div class="value" style="color:var(--accent-2)">Rs. ${totalCollected.toLocaleString()}</div><div class="label">Payment collected total</div></div>
  `;

  if (entries.length === 0) {
    body.innerHTML = '<tr><td colspan="6" class="empty-state">No fee records in this range.</td></tr>';
    return;
  }
  body.innerHTML = entries.map((e, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(e.name)}</td>
      <td>${escapeHtml(e.studentCode || '—')}</td>
      <td>${escapeHtml([...e.sports].join(', '))}</td>
      <td style="color:var(--accent-2)">Rs. ${e.paid.toLocaleString()}</td>
      <td style="color:var(--danger)">Rs. ${e.due.toLocaleString()}</td>
    </tr>
  `).join('');
}

async function exportReportToExcel() {
  const btn = el('report-export-btn');
  const label = el('report-export-btn-label');
  btn.disabled = true;
  label.textContent = 'Exporting…';
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Collection report');
    sheet.columns = [
      { header: 'Name', key: 'name', width: 28 },
      { header: 'Student ID', key: 'studentCode', width: 16 },
      { header: 'Sport(s)', key: 'sports', width: 26 },
      { header: 'Paid (Rs.)', key: 'paid', width: 14 },
      { header: 'Due (Rs.)', key: 'due', width: 14 },
    ];
    sheet.getRow(1).font = { bold: true };
    currentReportRows.forEach((e) => {
      sheet.addRow({ name: e.name, studentCode: e.studentCode, sports: [...e.sports].join(', '), paid: e.paid, due: e.due });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `collection-report-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } finally {
    btn.disabled = false;
    label.textContent = 'Export to Excel';
  }
}
