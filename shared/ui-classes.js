import { el, escapeHtml, escapeAttr, confirmDialog, promptDialog, parseGrade, sortGrades, gradeLabel } from './utils.js';
import { updateStudentsFields } from './firebase.js';

// Grades and classes aren't a separate collection — they live on each student
// doc as `grade` ("4") and `className` ("B"). So every operation here is a
// bulk field update across the docs involved, and a class exists for as long
// as at least one student is in it. (One person = several docs, one per sport;
// every edit is applied to all of them so they stay in step.)

const NO_CLASS = '__none__';
const ALL_CLASSES = '__all__';
const STANDARD_GRADES = Array.from({ length: 13 }, (_, i) => String(i + 1));

let allStudents = [];
// Classes created with "Create class" that don't have any students yet — kept
// only in memory until the first student is added, since an empty class has
// nothing to be stored on.
const draftClasses = new Set(); // "grade|class"
// grade: null until first render picks one; '' means the "No grade" bucket.
const view = { grade: null, className: ALL_CLASSES, search: '' };
const selected = new Set(); // person names ticked in the students table

const gradeOf = (s) => String(s.grade ?? '').trim();
const classOf = (s) => String(s.className ?? '').trim();

export function initClassesUI() {
  el('grade-cleanup-all').addEventListener('change', (e) => {
    el('grade-cleanup-body').querySelectorAll('input[type="checkbox"]').forEach((c) => { c.checked = e.target.checked; });
  });
  el('grade-cleanup-apply').addEventListener('click', applyCleanup);

  el('class-create-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const grade = el('class-create-grade').value;
    const className = el('class-create-name').value.trim().toUpperCase();
    if (!grade || !className) return;
    if (!classesInGrade(grade).includes(className)) draftClasses.add(`${grade}|${className}`);
    el('class-create-name').value = '';
    openClass(grade, className);
  });

  el('class-grade-grid').addEventListener('click', onGridClick);

  el('class-view-grade').addEventListener('change', (e) => { view.grade = e.target.value; view.className = ALL_CLASSES; selected.clear(); render(); });
  el('class-view-class').addEventListener('change', (e) => { view.className = e.target.value; selected.clear(); render(); });
  el('class-view-search').addEventListener('input', (e) => { view.search = e.target.value.trim().toLowerCase(); renderStudents(); });

  el('class-select-all').addEventListener('change', (e) => {
    visiblePeople().forEach((p) => (e.target.checked ? selected.add(p.name) : selected.delete(p.name)));
    renderStudents();
  });
  el('class-students-body').addEventListener('change', (e) => {
    if (!e.target.matches('input[data-name]')) return;
    if (e.target.checked) selected.add(e.target.dataset.name); else selected.delete(e.target.dataset.name);
    updateActionState();
  });

  el('class-move-grade').addEventListener('change', renderMoveClassOptions);
  el('class-move-btn').addEventListener('click', moveSelected);
  el('class-remove-btn').addEventListener('click', removeSelectedFromClass);
  el('class-add-btn').addEventListener('click', addStudentHere);
  el('class-rename-btn').addEventListener('click', () => renameClass(view.grade, view.className));
  el('class-delete-btn').addEventListener('click', () => deleteClass(view.grade, view.className));
}

export function updateClassesData(students) {
  allStudents = students;
  // A draft class becomes real once someone's in it.
  draftClasses.forEach((key) => {
    const [g, c] = key.split('|');
    if (allStudents.some((s) => gradeOf(s) === g && classOf(s) === c)) draftClasses.delete(key);
  });
  render();
}

// ---------------- Data helpers ----------------

// One entry per person (name), merging their per-sport docs.
function people() {
  const map = new Map();
  allStudents.forEach((s) => {
    let p = map.get(s.name);
    if (!p) {
      p = { name: s.name, ids: [], sports: [], grade: '', className: '', studentCode: '' };
      map.set(s.name, p);
    }
    p.ids.push(s.id);
    p.sports.push(s.sport);
    if (!p.grade && gradeOf(s)) { p.grade = gradeOf(s); p.className = classOf(s); }
    if (!p.studentCode && s.studentCode) p.studentCode = s.studentCode;
  });
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function allGrades() {
  return sortGrades([...allStudents.map(gradeOf).filter(Boolean), ...[...draftClasses].map((k) => k.split('|')[0])]);
}

function classesInGrade(grade) {
  return sortGrades([
    ...allStudents.filter((s) => gradeOf(s) === grade).map(classOf).filter(Boolean),
    ...[...draftClasses].filter((k) => k.startsWith(`${grade}|`)).map((k) => k.split('|')[1]),
  ]);
}

function docIds(predicate) {
  return allStudents.filter(predicate).map((s) => s.id);
}

function idsOfPeople(names) {
  return allStudents.filter((s) => names.has(s.name)).map((s) => s.id);
}

function visiblePeople() {
  return people()
    .filter((p) => p.grade === view.grade)
    .filter((p) => view.className === ALL_CLASSES
      || (view.className === NO_CLASS ? !p.className : p.className === view.className))
    .filter((p) => !view.search
      || p.name.toLowerCase().includes(view.search)
      || (p.studentCode || '').toLowerCase().includes(view.search));
}

// Raw grade values that parse to something different, grouped by what they'd become.
function cleanupSuggestions() {
  const groups = new Map();
  allStudents.forEach((s) => {
    const raw = gradeOf(s);
    if (!raw) return;
    const parsed = parseGrade(raw);
    const toClass = parsed.className || classOf(s);
    if (parsed.grade === raw && toClass === classOf(s)) return;
    const key = `${raw}|${classOf(s)}`;
    if (!groups.has(key)) {
      groups.set(key, { from: classOf(s) ? `${raw} (class ${classOf(s)})` : raw, grade: parsed.grade, className: toClass, ids: [], names: new Set() });
    }
    const g = groups.get(key);
    g.ids.push(s.id);
    g.names.add(s.name);
  });
  return [...groups.values()].sort((a, b) => a.from.localeCompare(b.from, undefined, { numeric: true }));
}

// ---------------- Rendering ----------------

function render() {
  const grades = allGrades();
  if (view.grade && !grades.includes(view.grade)) { view.grade = ''; view.className = ALL_CLASSES; }
  if (view.grade && ![ALL_CLASSES, NO_CLASS].includes(view.className) && !classesInGrade(view.grade).includes(view.className)) {
    view.className = ALL_CLASSES;
  }
  renderCleanup();
  renderGrid(grades);
  renderViewSelectors(grades);
  renderStudents();
  renderMoveTargets(grades);
}

function renderCleanup() {
  const suggestions = cleanupSuggestions();
  el('grade-cleanup-panel').classList.toggle('hidden', suggestions.length === 0);
  el('grade-cleanup-body').innerHTML = suggestions.map((g, i) => `
    <tr>
      <td><input type="checkbox" data-i="${i}" checked /></td>
      <td>${escapeHtml(g.from)}</td>
      <td>Grade ${escapeHtml(g.grade)}${g.className ? `, class ${escapeHtml(g.className)}` : ''}</td>
      <td>${g.names.size}</td>
    </tr>
  `).join('');
}

function renderGrid(grades) {
  const everyone = people();
  const noGrade = everyone.filter((p) => !p.grade);
  const cards = grades.map((grade) => {
    const inGrade = everyone.filter((p) => p.grade === grade);
    const chips = classesInGrade(grade).map((c) => {
      const n = inGrade.filter((p) => p.className === c).length;
      return `<button type="button" class="class-chip" data-open-grade="${escapeAttr(grade)}" data-open-class="${escapeAttr(c)}">Class ${escapeHtml(c)} <b>${n}</b></button>`;
    });
    const unassigned = inGrade.filter((p) => !p.className).length;
    if (unassigned) chips.push(`<button type="button" class="class-chip muted" data-open-grade="${escapeAttr(grade)}" data-open-class="${NO_CLASS}">No class <b>${unassigned}</b></button>`);
    return `
      <div class="class-grade-card">
        <div class="class-grade-head">
          <button type="button" class="class-grade-title" data-open-grade="${escapeAttr(grade)}" data-open-class="${ALL_CLASSES}">Grade ${escapeHtml(grade)}</button>
          <span class="class-grade-count">${inGrade.length} student${inGrade.length === 1 ? '' : 's'}</span>
        </div>
        <div class="class-chips">${chips.join('') || '<span class="class-grade-count">No students yet</span>'}</div>
        <div class="class-grade-actions">
          <button type="button" class="connect-btn" data-rename-grade="${escapeAttr(grade)}">Rename / merge</button>
          <button type="button" class="danger-btn" data-delete-grade="${escapeAttr(grade)}">Delete</button>
        </div>
      </div>
    `;
  });
  if (noGrade.length) {
    cards.push(`
      <div class="class-grade-card muted">
        <div class="class-grade-head">
          <button type="button" class="class-grade-title" data-open-grade="" data-open-class="${ALL_CLASSES}">No grade</button>
          <span class="class-grade-count">${noGrade.length} student${noGrade.length === 1 ? '' : 's'}</span>
        </div>
        <div class="class-chips"><span class="class-grade-count">Open to move them into a grade.</span></div>
      </div>
    `);
  }
  el('class-grade-grid').innerHTML = cards.join('') || '<div class="empty-state">No students registered yet.</div>';

  const createGrade = el('class-create-grade');
  const prev = createGrade.value;
  const options = sortGrades([...STANDARD_GRADES, ...grades]);
  createGrade.innerHTML = options.map((g) => `<option value="${escapeAttr(g)}">Grade ${escapeHtml(g)}</option>`).join('');
  createGrade.value = options.includes(prev) ? prev : options[0];
}

function renderViewSelectors(grades) {
  const gradeSel = el('class-view-grade');
  const hasNoGrade = people().some((p) => !p.grade);
  gradeSel.innerHTML = grades.map((g) => `<option value="${escapeAttr(g)}">Grade ${escapeHtml(g)}</option>`).join('')
    + (hasNoGrade ? '<option value="">No grade</option>' : '');
  if (view.grade === null || (!view.grade && !hasNoGrade)) view.grade = grades[0] ?? '';
  gradeSel.value = view.grade;

  const classSel = el('class-view-class');
  const classes = view.grade ? classesInGrade(view.grade) : [];
  classSel.innerHTML = `<option value="${ALL_CLASSES}">All classes</option>`
    + classes.map((c) => `<option value="${escapeAttr(c)}">Class ${escapeHtml(c)}</option>`).join('')
    + `<option value="${NO_CLASS}">No class</option>`;
  classSel.value = view.className;
  classSel.disabled = !view.grade;

  const specific = view.grade && ![ALL_CLASSES, NO_CLASS].includes(view.className);
  el('class-rename-btn').classList.toggle('hidden', !specific);
  el('class-delete-btn').classList.toggle('hidden', !specific);
  el('class-remove-btn').classList.toggle('hidden', !specific);
  el('class-students-title').textContent = !view.grade ? 'Students with no grade'
    : view.className === ALL_CLASSES ? `Grade ${view.grade} — all students`
      : view.className === NO_CLASS ? `Grade ${view.grade} — no class`
        : `Grade ${view.grade} — class ${view.className}`;
}

function renderStudents() {
  const list = visiblePeople();
  const names = new Set(list.map((p) => p.name));
  [...selected].forEach((n) => { if (!names.has(n)) selected.delete(n); });

  el('class-students-body').innerHTML = list.length ? list.map((p) => `
    <tr>
      <td><input type="checkbox" data-name="${escapeAttr(p.name)}" ${selected.has(p.name) ? 'checked' : ''} /></td>
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(p.studentCode || '—')}</td>
      <td>${escapeHtml(gradeLabel(p))}</td>
      <td>${escapeHtml(p.sports.join(', '))}</td>
    </tr>
  `).join('') : '<tr><td colspan="5" class="empty-state">No students here yet — add some below.</td></tr>';
  el('class-select-all').checked = list.length > 0 && list.every((p) => selected.has(p.name));

  // "Add a student here": everyone who isn't already in this exact grade/class.
  const here = new Set(people()
    .filter((p) => p.grade === view.grade && (view.className === ALL_CLASSES || (view.className === NO_CLASS ? !p.className : p.className === view.className)))
    .map((p) => p.name));
  const addSel = el('class-add-student');
  addSel.innerHTML = '<option value="">Pick a student…</option>' + people().filter((p) => !here.has(p.name)).map((p) => (
    `<option value="${escapeAttr(p.name)}">${escapeHtml(p.name)}${p.grade ? ` (Grade ${escapeHtml(gradeLabel(p))})` : ''}</option>`
  )).join('');
  el('class-add-btn').closest('.fee-form').classList.toggle('hidden', !view.grade);

  updateActionState();
}

function renderMoveTargets(grades) {
  const sel = el('class-move-grade');
  const prev = sel.value;
  const options = sortGrades([...STANDARD_GRADES, ...grades]);
  sel.innerHTML = options.map((g) => `<option value="${escapeAttr(g)}">Grade ${escapeHtml(g)}</option>`).join('');
  sel.value = options.includes(prev) ? prev : (view.grade || options[0]);
  renderMoveClassOptions();
}

function renderMoveClassOptions() {
  el('class-move-class-options').innerHTML = classesInGrade(el('class-move-grade').value)
    .map((c) => `<option value="${escapeAttr(c)}"></option>`).join('');
}

function updateActionState() {
  const none = selected.size === 0;
  el('class-move-btn').disabled = none;
  el('class-remove-btn').disabled = none;
  el('class-move-btn').textContent = none ? 'Move' : `Move ${selected.size}`;
}

function openClass(grade, className) {
  view.grade = grade;
  view.className = className;
  view.search = '';
  el('class-view-search').value = '';
  selected.clear();
  render();
  el('class-students-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------------- Actions ----------------

function setStatus(msg, isError = false) {
  el('class-students-status').textContent = isError ? '' : msg;
  el('class-students-error').textContent = isError ? msg : '';
  el('class-grid-error').textContent = '';
}

async function run(label, fn) {
  setStatus(`${label}…`);
  try {
    await fn();
    setStatus(`${label} — done.`);
    setTimeout(() => { if (el('class-students-status').textContent.endsWith('done.')) setStatus(''); }, 4000);
  } catch (err) {
    console.error(err);
    setStatus(err.message, true);
  }
}

function onGridClick(e) {
  const open = e.target.closest('[data-open-grade]');
  if (open) { openClass(open.dataset.openGrade, open.dataset.openClass); return; }
  const rename = e.target.closest('[data-rename-grade]');
  if (rename) { renameGrade(rename.dataset.renameGrade); return; }
  const del = e.target.closest('[data-delete-grade]');
  if (del) deleteGrade(del.dataset.deleteGrade);
}

async function applyCleanup() {
  const suggestions = cleanupSuggestions();
  const picked = [...el('grade-cleanup-body').querySelectorAll('input[data-i]:checked')].map((c) => suggestions[Number(c.dataset.i)]);
  if (!picked.length) return;
  const btn = el('grade-cleanup-apply');
  btn.disabled = true;
  el('grade-cleanup-status').textContent = 'Fixing…';
  try {
    for (const g of picked) await updateStudentsFields(g.ids, { grade: g.grade, className: g.className || null });
    el('grade-cleanup-status').textContent = `Fixed ${picked.length} grade value(s).`;
  } catch (err) {
    el('grade-cleanup-status').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

async function renameGrade(grade) {
  const input = await promptDialog(`New name for Grade ${grade}. Use an existing grade to merge the two.`, { title: 'Rename grade', value: grade });
  if (input === null) return;
  const { grade: target } = parseGrade(input);
  if (!target || target === grade) return;
  if (allGrades().includes(target)) {
    const ok = await confirmDialog(`Grade ${target} already exists. Move every Grade ${grade} student into Grade ${target}? Their classes are kept.`, { title: 'Merge grades', okLabel: 'Merge' });
    if (!ok) return;
  }
  moveDrafts((g) => (g === grade ? target : g));
  await run(`Renaming Grade ${grade} to ${target}`, () => updateStudentsFields(docIds((s) => gradeOf(s) === grade), { grade: target }));
  if (view.grade === grade) view.grade = target;
  render();
}

async function deleteGrade(grade) {
  const n = people().filter((p) => p.grade === grade).length;
  const ok = await confirmDialog(`Remove Grade ${grade}? ${n} student(s) will be left with no grade or class. The students themselves, their attendance and fees are NOT deleted.`, { title: 'Delete grade', okLabel: 'Delete grade' });
  if (!ok) return;
  draftClasses.forEach((k) => { if (k.startsWith(`${grade}|`)) draftClasses.delete(k); });
  await run(`Deleting Grade ${grade}`, () => updateStudentsFields(docIds((s) => gradeOf(s) === grade), { grade: null, className: null }));
}

async function renameClass(grade, className) {
  const input = await promptDialog(`New name for Grade ${grade} class ${className}. Use an existing class to merge the two.`, { title: 'Rename class', value: className });
  if (input === null) return;
  const target = input.trim().toUpperCase();
  if (!target || target === className) return;
  if (classesInGrade(grade).includes(target)) {
    const ok = await confirmDialog(`Class ${target} already exists in Grade ${grade}. Move everyone from class ${className} into class ${target}?`, { title: 'Merge classes', okLabel: 'Merge' });
    if (!ok) return;
  }
  if (draftClasses.delete(`${grade}|${className}`)) draftClasses.add(`${grade}|${target}`);
  await run(`Renaming class ${className} to ${target}`, () => updateStudentsFields(docIds((s) => gradeOf(s) === grade && classOf(s) === className), { className: target }));
  view.className = target;
  render();
}

async function deleteClass(grade, className) {
  const ids = docIds((s) => gradeOf(s) === grade && classOf(s) === className);
  if (ids.length) {
    const ok = await confirmDialog(`Delete Grade ${grade} class ${className}? Its students stay in Grade ${grade} with no class. Nobody is deleted.`, { title: 'Delete class', okLabel: 'Delete class' });
    if (!ok) return;
  }
  draftClasses.delete(`${grade}|${className}`);
  view.className = ALL_CLASSES;
  if (ids.length) await run(`Deleting class ${className}`, () => updateStudentsFields(ids, { className: null }));
  render();
}

async function moveSelected() {
  if (!selected.size) return;
  const grade = el('class-move-grade').value;
  const className = el('class-move-class').value.trim().toUpperCase();
  const names = new Set(selected);
  await run(`Moving ${names.size} student(s) to Grade ${grade}${className ? ` class ${className}` : ''}`,
    () => updateStudentsFields(idsOfPeople(names), { grade, className: className || null }));
  selected.clear();
  el('class-move-class').value = '';
}

async function removeSelectedFromClass() {
  if (!selected.size) return;
  const names = new Set(selected);
  await run(`Removing ${names.size} student(s) from class ${view.className}`, () => updateStudentsFields(idsOfPeople(names), { className: null }));
  selected.clear();
}

async function addStudentHere() {
  const name = el('class-add-student').value;
  if (!name || !view.grade) return;
  const className = [ALL_CLASSES, NO_CLASS].includes(view.className) ? null : view.className;
  const where = `Grade ${view.grade}${className ? ` class ${className}` : ''}`;
  await run(`Adding ${name} to ${where}`, () => {
    // "All classes" view only sets the grade and leaves their class as-is if it already belongs to this grade.
    const fields = view.className === ALL_CLASSES ? { grade: view.grade } : { grade: view.grade, className };
    const person = people().find((p) => p.name === name);
    if (view.className === ALL_CLASSES && person && person.grade !== view.grade) fields.className = null;
    return updateStudentsFields(idsOfPeople(new Set([name])), fields);
  });
  el('class-add-student').value = '';
}

function moveDrafts(mapGrade) {
  [...draftClasses].forEach((k) => {
    const [g, c] = k.split('|');
    const ng = mapGrade(g);
    if (ng !== g) { draftClasses.delete(k); draftClasses.add(`${ng}|${c}`); }
  });
}
