// Staff dashboard → Exams: set up exam sessions and their timetables (Registrar, Dean (Academic),
// Administrator). The clearance board below it lives in exam-clearance.js.
document.addEventListener('staff:loaded', async () => {
  if (!document.getElementById('tab-exams')) return;
  const S = window.Staff;
  const esc = S.escapeHtml;
  const manager = ['administrator', 'registrar', 'dean_academic'].includes(S.role);
  const box = document.getElementById('ex-manage');
  if (!manager) { box.remove(); return; }
  box.hidden = false;

  let data = { schools: [] };
  try { data = await S.programmes(); } catch (e) { /* selects stay empty */ }
  let sessions = [];

  const SEMESTERS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  const $ = id => document.getElementById(id);

  // School -> programme -> semester pickers (used by both the module list and the timetable form)
  function wirePickers(prefix, onChange) {
    const schoolSel = $(`${prefix}-school`), progSel = $(`${prefix}-programme`), semSel = $(`${prefix}-semester`);
    schoolSel.innerHTML = '<option value="">Choose school</option>' +
      data.schools.map(s => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('');
    function fillProgrammes() {
      const school = data.schools.find(s => s.name === schoolSel.value);
      progSel.innerHTML = '<option value="">Choose programme</option>' +
        (school ? school.programmes.map(p => `<option value="${esc(p.name)}" data-years="${p.years || 4}">${esc(p.name)}</option>`).join('') : '');
      fillSemesters();
    }
    // A programme of N years has 2N semesters
    function fillSemesters() {
      const opt = progSel.selectedOptions[0];
      const count = opt && opt.dataset.years ? Math.min(Number(opt.dataset.years) * 2, SEMESTERS.length) : SEMESTERS.length;
      const keep = semSel.value;
      semSel.innerHTML = '<option value="">Semester</option>' + SEMESTERS.slice(0, count).map(x => `<option>${x}</option>`).join('');
      if (SEMESTERS.slice(0, count).includes(keep)) semSel.value = keep;
      onChange();
    }
    schoolSel.addEventListener('change', fillProgrammes);
    progSel.addEventListener('change', fillSemesters);
    semSel.addEventListener('change', onChange);
    fillProgrammes();
  }

  // ---------- programme modules (the catalogue) ----------
  async function loadModules() {
    const programme = $('pm-programme').value;
    $('pm-empty').hidden = !!programme;
    if (!programme) { document.querySelector('#pm-table tbody').innerHTML = ''; $('pm-empty').textContent = 'Choose a programme to see its modules.'; return; }
    try {
      const { modules } = await S.api(`/api/exams/modules?programme=${encodeURIComponent(programme)}`);
      $('pm-empty').hidden = modules.length > 0;
      $('pm-empty').textContent = 'No modules listed for this programme yet. Add them above.';
      const sem = $('pm-semester').value;
      document.querySelector('#pm-table tbody').innerHTML = modules.map(m => `
        <tr class="${sem && m.semester === sem ? 'pm-current' : ''}">
          <td>Semester ${esc(m.semester)}</td>
          <td><strong>${esc(m.module_code)}</strong></td>
          <td>${esc(m.module_name)}</td>
          <td><button type="button" class="btn-danger btn-small" data-mod="${m.module_id}">Remove</button></td>
        </tr>`).join('');
    } catch (err) {
      S.say('pm-message', err.message, 'error');
    }
  }
  wirePickers('pm', loadModules);

  $('pm-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    try {
      const msg = await S.api('/api/exams/modules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ school: f.school.value, programme: f.programme.value, semester: f.semester.value,
                               module_code: f.module_code.value, module_name: f.module_name.value })
      });
      S.say('pm-message', msg, 'success');
      f.module_code.value = ''; f.module_name.value = ''; f.module_code.focus();
      await loadModules();
      loadModuleChoices();
    } catch (err) {
      S.say('pm-message', err.message, 'error');
    }
  });

  $('pm-table').addEventListener('click', async e => {
    const b = e.target.closest('button[data-mod]');
    if (!b) return;
    if (b.dataset.confirm !== 'yes') { b.dataset.confirm = 'yes'; b.textContent = 'Confirm'; return; }
    try {
      await S.api(`/api/exams/modules/${b.dataset.mod}`, { method: 'DELETE' });
      S.hush('pm-message');
      await loadModules();
      loadModuleChoices();
    } catch (err) {
      S.say('pm-message', err.message, 'error');
    }
  });

  // ---------- timetable form: modules come from the chosen programme + semester ----------
  async function loadModuleChoices() {
    const programme = $('tt-programme').value, semester = $('tt-semester').value;
    const sel = $('tt-module'), hint = $('tt-module-hint');
    if (!programme || !semester) {
      sel.innerHTML = '<option value="">Choose programme and semester first</option>';
      hint.textContent = '';
      return;
    }
    try {
      const { modules } = await S.api(`/api/exams/modules?programme=${encodeURIComponent(programme)}&semester=${semester}`);
      sel.innerHTML = modules.length
        ? '<option value="">Choose module</option>' + modules.map(m => `<option value="${m.module_id}">${esc(m.module_code)} — ${esc(m.module_name)}</option>`).join('')
        : '<option value="">No modules listed</option>';
      hint.textContent = modules.length ? '' : `Add ${programme}'s Semester ${semester} modules under "Programme modules" first.`;
    } catch (err) {
      S.say('tt-message', err.message, 'error');
    }
  }
  wirePickers('tt', loadModuleChoices);

  // ---------- sessions ----------
  async function loadSessions(selectId) {
    try {
      sessions = (await S.api('/api/exams/sessions')).sessions;
      document.getElementById('es-empty').hidden = sessions.length > 0;
      document.querySelector('#es-table tbody').innerHTML = sessions.map(s => `
        <tr>
          <td><strong>${esc(s.name)}</strong><br><small class="muted">${s.exam_type === 'end' ? 'End-semester exams' : 'Mid-semester test'} · Centre ${esc(s.centre_name)} (${esc(s.centre_code)})</small></td>
          <td class="num">${s.min_paid_pct}%</td>
          <td class="num">${s.papers}</td>
          <td class="num">${s.tickets}</td>
          <td>${s.is_open ? '<span class="badge badge-ok">Open</span>' : '<span class="badge badge-full">Closed</span>'}</td>
          <td class="ex-actions">
            <button type="button" class="btn-ghost btn-small" data-tt="${s.session_id}">Timetable</button>
            <button type="button" class="btn-ghost btn-small" data-toggle="${s.session_id}" data-open="${s.is_open ? 0 : 1}">${s.is_open ? 'Close' : 'Reopen'}</button>
            ${Number(s.tickets) === 0 ? `<button type="button" class="btn-danger btn-small" data-del="${s.session_id}">Delete</button>` : ''}
          </td>
        </tr>`).join('');

      const sel = document.getElementById('tt-session');
      const keep = selectId || sel.value;
      sel.innerHTML = sessions.map(s => `<option value="${s.session_id}">${esc(s.name)}</option>`).join('');
      if (keep && sessions.some(s => String(s.session_id) === String(keep))) sel.value = keep;
      document.getElementById('tt-wrap').hidden = sessions.length === 0;
      loadTimetable();
    } catch (err) {
      S.say('es-message', err.message, 'error');
    }
  }

  document.getElementById('es-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button[type="submit"]');
    btn.classList.add('loading'); btn.disabled = true;
    try {
      const r = await S.api('/api/exams/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: f.name.value, exam_type: f.exam_type.value, min_paid_pct: Number(f.min_paid_pct.value),
          centre_name: f.centre_name.value, centre_code: f.centre_code.value
        })
      });
      S.say('es-message', `${r.message} Now add its timetable below.`, 'success');
      f.name.value = '';
      await loadSessions(r.session_id);
      if (window.ExamBoard) window.ExamBoard.reload(r.session_id);
    } catch (err) {
      S.say('es-message', err.message, 'error');
    } finally {
      btn.classList.remove('loading'); btn.disabled = false;
    }
  });

  // Mid-semester defaults to 75% fees paid, end-semester to 100%
  document.getElementById('es-type').addEventListener('change', e => {
    document.getElementById('es-pct').value = e.target.value === 'end' ? 100 : 75;
  });

  document.getElementById('es-table').addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.tt) {
        document.getElementById('tt-session').value = b.dataset.tt;
        loadTimetable();
        document.getElementById('tt-wrap').scrollIntoView({ behavior: 'smooth' });
        return;
      }
      if (b.dataset.toggle) {
        await S.api(`/api/exams/sessions/${b.dataset.toggle}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_open: b.dataset.open === '1' })
        });
      }
      if (b.dataset.del) {
        const s = sessions.find(x => String(x.session_id) === b.dataset.del);
        if (b.dataset.confirm !== 'yes') {
          b.dataset.confirm = 'yes';
          b.textContent = 'Confirm delete';
          S.say('es-message', `Click "Confirm delete" to remove ${s.name} and its timetable.`, 'error');
          return;
        }
        await S.api(`/api/exams/sessions/${b.dataset.del}`, { method: 'DELETE' });
      }
      S.hush('es-message');
      await loadSessions();
      if (window.ExamBoard) window.ExamBoard.reload();
    } catch (err) {
      S.say('es-message', err.message, 'error');
    }
  });

  // ---------- timetable ----------
  async function loadTimetable() {
    const id = document.getElementById('tt-session').value;
    if (!id) return;
    try {
      const { timetable } = await S.api(`/api/exams/sessions/${id}/timetable`);
      document.getElementById('tt-empty').hidden = timetable.length > 0;
      let last = null;
      document.querySelector('#tt-table tbody').innerHTML = timetable.map(t => {
        const group = `${t.programme} · ${t.semester ? 'Semester ' + t.semester : 'All semesters'}`;
        const head = group !== last ? `<tr class="tt-group"><th colspan="5">${esc(group)}</th></tr>` : '';
        last = group;
        const d = new Date(t.exam_date + 'T00:00:00');
        return head + `
          <tr>
            <td>${d.toLocaleDateString('en-GB')}${t.start_time ? `<br><small class="muted">${esc(t.start_time)}</small>` : ''}</td>
            <td><strong>${esc(t.module_code)}</strong></td>
            <td>${esc(t.module_name)}</td>
            <td>${t.semester ? esc(t.semester) : '<small class="muted">All</small>'}</td>
            <td><button type="button" class="btn-danger btn-small" data-row="${t.row_id}">Remove</button></td>
          </tr>`;
      }).join('');
    } catch (err) {
      S.say('tt-message', err.message, 'error');
    }
  }
  document.getElementById('tt-session').addEventListener('change', loadTimetable);

  document.getElementById('tt-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const id = document.getElementById('tt-session').value;
    try {
      const msg = await S.api(`/api/exams/sessions/${id}/timetable`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module_id: f.module_id.value, programme: f.programme.value,
          exam_date: f.exam_date.value, start_time: f.start_time.value
        })
      });
      S.say('tt-message', typeof msg === 'string' ? msg : 'Paper added.', 'success');
      // Keep school / programme / semester for quick entry of the next paper
      f.module_id.value = '';
      f.exam_date.focus();
      await loadTimetable();
      if (window.ExamBoard) window.ExamBoard.reload(id);
    } catch (err) {
      S.say('tt-message', err.message, 'error');
    }
  });

  document.getElementById('tt-table').addEventListener('click', async e => {
    const b = e.target.closest('button[data-row]');
    if (!b) return;
    try {
      await S.api(`/api/exams/timetable/${b.dataset.row}`, { method: 'DELETE' });
      S.hush('tt-message');
      await loadTimetable();
    } catch (err) {
      S.say('tt-message', err.message, 'error');
    }
  });

  loadSessions();
});
