// Lecturer dashboard → Results tab: result sheets per course, mark entry, publishing.
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('token');
  const authHeaders = { 'Authorization': `Bearer ${token}` };

  let config = null;      // weights + grade scale
  let mySchool = null;
  let current = null;     // { sheet, students }
  const dirty = new Map(); // "studentId|component" -> value

  // ---------- helpers ----------
  const escapeHtml = v => String(v ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
  const fmt = n => (n === null || n === undefined ? '–' : (Math.round(n * 10) / 10).toString());

  function say(id, text, type) {
    const el = document.getElementById(id);
    el.textContent = text;
    el.className = `message show ${type}`;
  }
  const hush = id => { document.getElementById(id).className = 'message'; };

  async function api(url, options = {}) {
    const res = await fetch(url, { ...options, headers: { ...authHeaders, ...(options.headers || {}) } });
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    const body = isJson ? await res.json() : await res.text();
    if (!res.ok) throw new Error(typeof body === 'string' ? body : (body.message || 'Request failed.'));
    return body;
  }

  function defaultPeriod() {
    const d = new Date();
    return `${d.getFullYear()} Semester ${d.getMonth() < 6 ? 1 : 2}`;
  }

  // ---------- setup ----------
  document.addEventListener('lecturer:loaded', async (e) => {
    mySchool = e.detail.school || null;
    document.getElementById('res-no-school').hidden = Boolean(mySchool);
    document.getElementById('res-workspace').hidden = !mySchool;
    if (!mySchool) return;

    try {
      const [cfg, programmes] = await Promise.all([api('/api/results/config'), api('/api/programmes')]);
      config = cfg;
      const ca = config.components.filter(c => c.ca);
      const exam = config.components.filter(c => !c.ca);
      document.getElementById('res-weights').innerHTML =
        `Final result = <strong>CA ${ca.reduce((t, c) => t + c.weight, 0)}%</strong> (` +
        ca.map(c => `${escapeHtml(c.label)} ${c.weight}%`).join(', ') +
        `) + <strong>${exam.map(c => `${escapeHtml(c.label)} ${c.weight}%`).join(', ')}</strong>. ` +
        `Enter each mark out of 100. Pass mark: ${config.passMark}%.`;

      const school = programmes.schools.find(s => s.name === mySchool);
      document.getElementById('res-programme').innerHTML =
        `<option value="">All programmes in the ${escapeHtml(mySchool)}</option>` +
        (school ? school.programmes.map(p => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join('') : '');
      document.getElementById('res-period').value = defaultPeriod();

      loadSheets();
    } catch (err) {
      say('res-list-message', err.message, 'error');
    }
  });

  // ---------- create sheet ----------
  document.getElementById('res-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    hush('res-form-message');
    const course_name = document.getElementById('res-course').value.trim();
    const period = document.getElementById('res-period').value.trim();
    const programme = document.getElementById('res-programme').value;
    if (!course_name) return say('res-form-message', 'Enter the course or module name.', 'error');
    if (!period) return say('res-form-message', 'Enter the semester.', 'error');

    try {
      const body = await api('/api/results/sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course_name, period, programme })
      });
      say('res-form-message', body.message, 'success');
      document.getElementById('res-course').value = '';
      await loadSheets();
      openSheet(body.sheet_id);
    } catch (err) {
      say('res-form-message', err.message, 'error');
    }
  });

  // ---------- list ----------
  async function loadSheets() {
    try {
      const { sheets } = await api('/api/results/sheets');
      document.getElementById('res-empty').hidden = sheets.length > 0;
      document.getElementById('res-list').innerHTML = sheets.map(s => {
        const chips = config.components.map(c =>
          `<span class="pub-chip ${s.published.includes(c.key) ? 'on' : ''}" title="${s.published.includes(c.key) ? 'Published' : 'Not published'}">${escapeHtml(c.short)}</span>`
        ).join('');
        return `
          <article class="asg-card">
            <div class="asg-card-top">
              <span class="asg-no">${escapeHtml(s.period)}</span>
            </div>
            <h4>${escapeHtml(s.course_name)}</h4>
            <p class="asg-meta">${escapeHtml(s.programme || 'All programmes')}</p>
            <p class="asg-meta">${Number(s.students_with_marks)} of ${Number(s.student_count)} students have marks</p>
            <div class="pub-chips" aria-label="Published components">${chips}</div>
            <div class="asg-actions">
              <button type="button" class="btn-primary btn-small" data-open="${s.sheet_id}">Enter marks</button>
              <button type="button" class="btn-danger btn-small" data-del="${s.sheet_id}" data-title="${escapeHtml(s.course_name)} (${escapeHtml(s.period)})">Delete</button>
            </div>
          </article>`;
      }).join('');
    } catch (err) {
      say('res-list-message', err.message, 'error');
    }
  }

  document.getElementById('res-list').addEventListener('click', async (e) => {
    const open = e.target.closest('[data-open]');
    const del = e.target.closest('[data-del]');
    hush('res-list-message');
    if (open) return openSheet(open.dataset.open);
    if (del) {
      if (!confirm(`Delete the result sheet for ${del.dataset.title}? All marks on it will be lost.`)) return;
      try {
        say('res-list-message', await api(`/api/results/sheets/${del.dataset.del}`, { method: 'DELETE' }), 'success');
        if (current && String(current.sheet.sheet_id) === del.dataset.del) closeSheet();
        loadSheets();
      } catch (err) {
        say('res-list-message', err.message, 'error');
      }
    }
  });

  // ---------- one sheet ----------
  function closeSheet() {
    current = null;
    dirty.clear();
    document.getElementById('res-sheet').hidden = true;
  }

  async function openSheet(id) {
    if (dirty.size && !confirm('You have unsaved marks. Discard them?')) return;
    dirty.clear();
    updateDirty();
    hush('sheet-message');
    try {
      current = await api(`/api/results/sheets/${id}`);
      renderSheet();
      const panel = document.getElementById('res-sheet');
      panel.hidden = false;
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      say('res-list-message', err.message, 'error');
    }
  }

  function renderSheet() {
    const { sheet, students } = current;
    document.getElementById('sheet-title').textContent = `${sheet.course_name} · ${sheet.period}`;
    document.getElementById('sheet-meta').textContent =
      `${sheet.programme || 'All programmes'} · ${students.length} student${students.length === 1 ? '' : 's'}`;

    const ca = config.components.filter(c => c.ca);
    const caMax = ca.reduce((t, c) => t + c.weight, 0);

    // Header: component columns with a publish switch each
    document.querySelector('#sheet-table thead').innerHTML = `
      <tr>
        <th>Student</th>
        ${config.components.map(c => `
          <th class="num">
            <div>${escapeHtml(c.label)}</div>
            <small>/100 · ${c.weight}%</small>
            <label class="pub-toggle">
              <input type="checkbox" data-publish="${c.key}" ${sheet.published.includes(c.key) ? 'checked' : ''}>
              <span>${sheet.published.includes(c.key) ? 'Published' : 'Hidden'}</span>
            </label>
          </th>`).join('')}
        <th class="num">CA<br><small>/${caMax}</small></th>
        <th class="num">Total<br><small>/100</small></th>
        <th>Grade</th>
      </tr>`;

    document.getElementById('sheet-empty').hidden = students.length > 0;
    document.querySelector('#sheet-table tbody').innerHTML = students.map(s => `
      <tr data-student="${s.student_id}">
        <td><strong>${escapeHtml(s.name)}</strong><br><small>${escapeHtml(s.programme || '')}</small></td>
        ${config.components.map(c => `
          <td class="num">
            <input type="number" class="mark-input" min="0" max="100" step="0.5" inputmode="decimal"
                   data-component="${c.key}" value="${s.marks[c.key] ?? ''}" aria-label="${escapeHtml(c.label)} for ${escapeHtml(s.name)}">
          </td>`).join('')}
        <td class="num" data-out="ca"></td>
        <td class="num" data-out="total"></td>
        <td data-out="grade"></td>
      </tr>`).join('');

    students.forEach(s => updateRow(s.student_id));
  }

  function rowMarks(row) {
    const marks = {};
    row.querySelectorAll('.mark-input').forEach(inp => {
      if (inp.value !== '') marks[inp.dataset.component] = Number(inp.value);
    });
    return marks;
  }

  function updateRow(studentId) {
    const row = document.querySelector(`#sheet-table tr[data-student="${studentId}"]`);
    if (!row) return;
    const r = window.computeResult(rowMarks(row), config);
    row.querySelector('[data-out="ca"]').textContent = fmt(r.ca);
    row.querySelector('[data-out="total"]').textContent = r.complete ? fmt(r.total) : '–';
    row.querySelector('[data-out="grade"]').innerHTML = r.complete
      ? `<span class="badge ${r.passed ? 'badge-ok' : 'badge-danger'}">${escapeHtml(r.grade)}</span> <small>${escapeHtml(r.remark)}</small>`
      : '<small class="muted">Incomplete</small>';
  }

  function updateDirty() {
    document.getElementById('sheet-dirty').textContent = dirty.size ? `${dirty.size} unsaved change${dirty.size === 1 ? '' : 's'}` : '';
    document.getElementById('sheet-save').disabled = dirty.size === 0;
  }

  const table = document.getElementById('sheet-table');

  table.addEventListener('input', (e) => {
    const inp = e.target.closest('.mark-input');
    if (!inp) return;
    const studentId = inp.closest('tr').dataset.student;
    const v = inp.value;
    const bad = v !== '' && (Number(v) < 0 || Number(v) > 100 || !Number.isFinite(Number(v)));
    inp.classList.toggle('invalid', bad);
    dirty.set(`${studentId}|${inp.dataset.component}`, v);
    inp.classList.add('changed');
    updateRow(studentId);
    updateDirty();
  });

  // Enter moves down the column, like a spreadsheet
  table.addEventListener('keydown', (e) => {
    const inp = e.target.closest('.mark-input');
    if (!inp || e.key !== 'Enter') return;
    e.preventDefault();
    const nextRow = inp.closest('tr').nextElementSibling;
    const next = nextRow && nextRow.querySelector(`.mark-input[data-component="${inp.dataset.component}"]`);
    if (next) { next.focus(); next.select(); }
  });

  table.addEventListener('change', async (e) => {
    const box = e.target.closest('[data-publish]');
    if (!box) return;
    const comp = config.components.find(c => c.key === box.dataset.publish);
    if (box.checked && dirty.size) {
      box.checked = false;
      return say('sheet-message', 'Save your marks before publishing.', 'error');
    }
    if (box.checked && !confirm(`Publish ${comp.label} marks? Students will be able to see them.`)) {
      box.checked = false;
      return;
    }
    try {
      const text = await api(`/api/results/sheets/${current.sheet.sheet_id}/publish`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ component: comp.key, published: box.checked })
      });
      say('sheet-message', text, 'success');
      box.nextElementSibling.textContent = box.checked ? 'Published' : 'Hidden';
      current.sheet.published = box.checked
        ? [...current.sheet.published, comp.key]
        : current.sheet.published.filter(k => k !== comp.key);
      loadSheets();
    } catch (err) {
      box.checked = !box.checked;
      say('sheet-message', err.message, 'error');
    }
  });

  document.getElementById('sheet-save').addEventListener('click', async () => {
    hush('sheet-message');
    if (table.querySelector('.mark-input.invalid')) return say('sheet-message', 'Marks must be between 0 and 100.', 'error');

    const marks = [...dirty.entries()].map(([key, value]) => {
      const [student_id, component] = key.split('|');
      return { student_id: Number(student_id), component, mark: value === '' ? null : Number(value) };
    });

    const btn = document.getElementById('sheet-save');
    btn.disabled = true;
    btn.classList.add('loading');
    try {
      const text = await api(`/api/results/sheets/${current.sheet.sheet_id}/marks`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marks })
      });
      dirty.clear();
      table.querySelectorAll('.mark-input.changed').forEach(i => i.classList.remove('changed'));
      say('sheet-message', text, 'success');
      loadSheets();
    } catch (err) {
      say('sheet-message', err.message, 'error');
    } finally {
      btn.classList.remove('loading');
      updateDirty();
    }
  });

  document.getElementById('sheet-close').addEventListener('click', () => {
    if (dirty.size && !confirm('You have unsaved marks. Close anyway?')) return;
    closeSheet();
  });

  // ---------- CSV export (opens in Excel) ----------
  document.getElementById('sheet-csv').addEventListener('click', () => {
    const { sheet } = current;
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Student', 'Email', 'Programme', ...config.components.map(c => `${c.label} (/100)`), 'CA', 'Total', 'Grade', 'Remark'];
    const lines = [header.map(q).join(',')];
    current.students.forEach(s => {
      const row = document.querySelector(`#sheet-table tr[data-student="${s.student_id}"]`);
      const marks = row ? rowMarks(row) : s.marks;
      const r = window.computeResult(marks, config);
      lines.push([s.name, s.email, s.programme, ...config.components.map(c => marks[c.key] ?? ''),
        r.ca, r.complete ? r.total : '', r.grade || '', r.remark || ''].map(q).join(','));
    });
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${sheet.course_name} - ${sheet.period}.csv`.replace(/[\\/:*?"<>|]/g, '-');
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // Warn before leaving the page with unsaved marks
  window.addEventListener('beforeunload', (e) => {
    if (dirty.size) { e.preventDefault(); e.returnValue = ''; }
  });
});
