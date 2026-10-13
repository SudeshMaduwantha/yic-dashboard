// Turns a <select> into a type-to-search combobox. The original <select> stays in
// the DOM (hidden) as the source of truth, so existing code that reads/writes
// select.value, rebuilds its innerHTML, toggles .disabled, or listens for 'change'
// keeps working untouched — this only layers a text input + filtered list on top.
const valueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');

export function makeSearchable(select) {
  const wrap = document.createElement('div');
  wrap.className = 'ss-wrap';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'ss-input';
  input.autocomplete = 'off';
  if (select.id) input.id = `${select.id}-search`;
  const list = document.createElement('div');
  list.className = 'ss-list hidden';
  wrap.append(input, list);
  select.after(wrap);
  select.classList.add('hidden');
  // Clicking the field's <label> should focus the visible input, not the hidden select.
  const label = select.id && document.querySelector(`label[for="${select.id}"]`);
  if (label) label.htmlFor = input.id;

  let active = -1;
  let shown = [];

  const options = () => [...select.options].filter((o) => o.value !== '');
  const placeholderText = () => (select.options[0] && select.options[0].value === '' ? select.options[0].textContent : 'Search…');

  function syncDisplay() {
    const opt = select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;
    input.value = opt && opt.value !== '' ? opt.textContent : '';
    input.placeholder = placeholderText();
    input.disabled = select.disabled;
  }

  function choose(value) {
    const changed = valueDesc.get.call(select) !== value;
    valueDesc.set.call(select, value);
    syncDisplay();
    close();
    if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function renderList() {
    const q = input.value.trim().toLowerCase();
    shown = options().filter((o) => !o.disabled && o.textContent.toLowerCase().includes(q));
    active = shown.length ? 0 : -1;
    list.innerHTML = '';
    if (!shown.length) {
      const empty = document.createElement('div');
      empty.className = 'ss-empty';
      empty.textContent = 'No matches';
      list.append(empty);
    }
    shown.forEach((o, i) => {
      const item = document.createElement('div');
      item.className = `ss-item${i === active ? ' active' : ''}`;
      item.textContent = o.textContent;
      // mousedown (not click) so it fires before the input's blur closes the list.
      item.addEventListener('mousedown', (e) => { e.preventDefault(); choose(o.value); });
      list.append(item);
    });
    list.classList.remove('hidden');
  }

  function highlight(i) {
    const items = list.querySelectorAll('.ss-item');
    if (!items.length) return;
    active = (i + items.length) % items.length;
    items.forEach((it, k) => it.classList.toggle('active', k === active));
    items[active].scrollIntoView({ block: 'nearest' });
  }

  function close() { list.classList.add('hidden'); }

  input.addEventListener('focus', () => { input.select(); renderList(); });
  input.addEventListener('input', renderList);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (list.classList.contains('hidden')) renderList(); else highlight(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(active - 1); }
    else if (e.key === 'Enter') { if (!list.classList.contains('hidden')) { e.preventDefault(); if (shown[active]) choose(shown[active].value); } }
    else if (e.key === 'Escape') { syncDisplay(); close(); }
  });
  input.addEventListener('blur', () => {
    // Clearing the box deselects; any other half-typed text snaps back to the current choice.
    if (!input.value.trim() && valueDesc.get.call(select) !== '' && select.options[0] && select.options[0].value === '' && !select.options[0].disabled) choose('');
    else { syncDisplay(); close(); }
  });

  // Programmatic `select.value = x` doesn't fire any event, so intercept it on this instance.
  Object.defineProperty(select, 'value', {
    configurable: true,
    get() { return valueDesc.get.call(this); },
    set(v) { valueDesc.set.call(this, v); syncDisplay(); },
  });
  new MutationObserver(syncDisplay).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  select.addEventListener('change', syncDisplay);
  if (select.form) select.form.addEventListener('reset', () => setTimeout(syncDisplay));

  syncDisplay();
}
