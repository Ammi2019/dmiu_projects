// Approval board shared by the staff and lecturer dashboards, used for both
//   - exam clearance (No Due Certificate -> hall ticket):  <div data-clearance-board data-api="/api/exams" data-prefix="exb" data-global="ExamBoard">
//   - semester registration:                               <div data-clearance-board data-api="/api/registration" data-prefix="rgb" data-global="RegBoard">
// Each officer sees Clear / Hold buttons only on the steps they sign; the server decides who can act on what.
document.querySelectorAll('[data-clearance-board]').forEach(root => (function (root) {
  const API = root.dataset.api || '/api/exams';
  const P = root.dataset.prefix || 'exb';

  const token = localStorage.getItem('token');
  const auth = { 'Authorization': `Bearer ${token}` };
  const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  async function api(url, options = {}) {
    const res = await fetch(url, { ...options, headers: { ...auth, ...(options.headers || {}) } });
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    const body = isJson ? await res.json() : await res.text();
    if (!res.ok) throw new Error(typeof body === 'string' ? body : (body.message || 'Request failed.'));
    return body;
  }

  const CHIP = {
    cleared: ['ok', 'Cleared'],
    held: ['danger', 'On hold'],
    pending: ['late', 'Pending'],
    waiting: ['full', 'Waiting'],
    na: ['full', 'N/A']
  };
  const chip = s => `<span class="badge badge-${CHIP[s][0]}">${CHIP[s][1]}</span>`;

  root.innerHTML = `
    <div class="filter-bar ex-filters">
      <div class="select-wrap filter-select"><select id="${P}-session" aria-label="Exam session"></select></div>
      <div class="select-wrap filter-select"><select id="${P}-filter" aria-label="Show">
        <option value="mine">Waiting for me</option>
        <option value="">All students</option>
        <option value="pending">Not yet eligible</option>
        <option value="eligible">Done</option>
      </select></div>
      <div class="select-wrap filter-select"><select id="${P}-programme" aria-label="Programme"><option value="">All programmes</option></select></div>
      <input type="search" id="${P}-search" class="filter-search" placeholder="Search name, register no or ticket no">
    </div>
    <p class="section-hint" id="${P}-summary"></p>
    <p id="${P}-message" class="message" role="status" aria-live="polite"></p>
    <div class="ex-bulk" id="${P}-bulk" hidden></div>
    <div class="table-wrap">
      <table class="data-table ex-board" id="${P}-table">
        <thead></thead><tbody></tbody>
      </table>
    </div>
    <p class="empty-state" id="${P}-empty" hidden></p>

    <dialog class="ex-dialog" id="${P}-dialog">
      <form method="dialog" id="${P}-form">
        <h3 id="${P}-d-title"></h3>
        <p class="section-hint" id="${P}-d-hint"></p>
        <div id="${P}-d-fields"></div>
        <p id="${P}-d-message" class="message" role="status" aria-live="polite"></p>
        <div class="ex-dialog-actions">
          <button type="button" class="btn-ghost" id="${P}-d-cancel">Cancel</button>
          <button type="submit" class="btn-primary" id="${P}-d-ok">Save</button>
        </div>
      </form>
    </dialog>`;

  const $ = id => document.getElementById(id.replace(/^exb-/, P + '-'));
  const say = (text, type) => { const el = $('exb-message'); el.textContent = text; el.className = `message show ${type}`; };
  const hush = () => { $('exb-message').className = 'message'; };

  let meta = null;      // sessions + what I can do
  let students = [];

  // ---------- dialog (hold reason / details) ----------
  let onSubmit = null;
  function openDialog({ title, hint, fields, ok, submit }) {
    $('exb-d-title').textContent = title;
    $('exb-d-hint').textContent = hint || '';
    $('exb-d-fields').innerHTML = fields;
    $('exb-d-ok').textContent = ok || 'Save';
    $('exb-d-message').className = 'message';
    onSubmit = submit;
    $('exb-dialog').showModal();
    const first = $('exb-d-fields').querySelector('input, textarea, select');
    if (first) first.focus();
  }
  $('exb-d-cancel').addEventListener('click', () => $('exb-dialog').close());
  $('exb-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await onSubmit(new FormData($('exb-form')));
      $('exb-dialog').close();
    } catch (err) {
      const el = $('exb-d-message');
      el.textContent = err.message;
      el.className = 'message show error';
    }
  });

  // ---------- loading ----------
  async function loadSessions(keepId) {
    meta = await api(`${API}/sessions`);
    const doneOpt = $('exb-filter').querySelector('option[value="eligible"]');
    if (doneOpt) doneOpt.textContent = meta.done_label || 'Done';
    if (meta.kind === 'registration') $('exb-search').placeholder = 'Search name or register no';
    const sel = $('exb-session');
    if (!meta.sessions.length) {
      sel.innerHTML = '<option value="">No exam sessions yet</option>';
      $('exb-summary').textContent = '';
      $('exb-table').querySelector('thead').innerHTML = '';
      $('exb-table').querySelector('tbody').innerHTML = '';
      $('exb-empty').hidden = false;
      $('exb-empty').textContent = meta.kind === 'registration'
        ? (meta.can_manage ? 'Open a registration window above so students can register.' : 'No registration windows have been opened yet.')
        : (meta.can_manage ? 'Create an exam session and add its timetable above to start clearing students.' : 'No exam sessions have been set up yet.');
      return;
    }
    const current = keepId || sel.value;
    sel.innerHTML = meta.sessions.map(s =>
      `<option value="${s.session_id}">${esc(s.name)}${s.is_open ? '' : ' (closed)'}</option>`).join('');
    if (current && meta.sessions.some(s => String(s.session_id) === String(current))) sel.value = current;

    // A role that signs no step (e.g. Principal) starts on "All students"
    if (!meta.steps.some(s => s.mine) && $('exb-filter').value === 'mine') $('exb-filter').value = '';
    await loadProgrammes();
    await loadBoard();
  }

  async function loadProgrammes() {
    const id = $('exb-session').value;
    if (!id) return;
    const { programmes: progs } = await api(`${API}/sessions/${id}/programmes`);
    const sel = $('exb-programme');
    const keep = sel.value;
    sel.innerHTML = '<option value="">All programmes</option>' + progs.map(p => `<option>${esc(p)}</option>`).join('');
    if (progs.includes(keep)) sel.value = keep;
  }

  async function loadBoard() {
    hush();
    const id = $('exb-session').value;
    if (!id) return;
    const params = new URLSearchParams();
    if ($('exb-filter').value) params.set('filter', $('exb-filter').value);
    if ($('exb-programme').value) params.set('programme', $('exb-programme').value);
    const q = $('exb-search').value.trim();
    if (q) params.set('q', q);
    try {
      const data = await api(`${API}/sessions/${id}/clearances?${params}`);
      students = data.students;
      const s = data.session;
      $('exb-summary').textContent = data.summary ||
        `${s.exam_type === 'end' ? 'End-semester examinations' : 'Mid-semester test'} · Accounts clears students who have paid at least ${s.min_paid_pct}% of their fees · ` +
        `${data.counts.eligible} of ${data.counts.total} student${data.counts.total === 1 ? '' : 's'} issued a hall ticket` +
        (data.school ? ` · ${data.school}` : '') + (s.is_open ? '' : ' · This session is closed.');
      render(s);
    } catch (err) {
      say(err.message, 'error');
    }
  }

  // ---------- table ----------
  function stepCell(student, step) {
    const st = student.steps[step];
    const canAct = student.actions.includes(step);
    const signed = st.by ? `<small class="muted">${esc(st.by)}${st.at ? ' · ' + esc(st.at.slice(0, 10)) : ''}</small>` : '';
    const detail = step === 'accounts' ? `<small class="muted">${st.paid_pct}% paid${st.auto ? '' : ' · manual'}</small>` : '';
    const note = st.note ? `<small class="ex-note" title="${esc(st.note)}">“${esc(st.note)}”</small>` : '';
    let buttons = '';
    if (canAct) {
      const decided = (step === 'accounts' && !st.auto) || (step !== 'accounts' && ['cleared', 'held'].includes(st.status));
      buttons = `<div class="ex-actions">
        ${st.status !== 'cleared' ? `<button type="button" class="btn-small btn-primary" data-act="cleared" data-step="${step}" data-id="${student.student_id}">${['hod', 'dos', 'academic'].includes(step) ? 'Approve' : 'Clear'}</button>` : ''}
        ${st.status !== 'held' ? `<button type="button" class="btn-small btn-danger" data-act="held" data-step="${step}" data-id="${student.student_id}">Hold</button>` : ''}
        ${decided ? `<button type="button" class="btn-small btn-ghost" data-act="reset" data-step="${step}" data-id="${student.student_id}" title="${step === 'accounts' ? 'Go back to the automatic fee check' : 'Undo this decision'}">${step === 'academic' && student.ticket_no ? 'Revoke' : 'Undo'}</button>` : ''}
      </div>`;
    }
    return `<td class="ex-step">${chip(st.status)}${detail}${signed}${note}${buttons}</td>`;
  }

  function render(session) {
    const steps = meta.steps;
    $('exb-table').querySelector('thead').innerHTML = `
      <tr>
        <th>Student</th>
        ${steps.map(s => `<th class="${s.mine ? 'ex-mine' : ''}">${esc(s.label)}${['hod', 'dos', 'academic'].includes(s.key) ? '<br><small class="muted">final approval</small>' : ''}</th>`).join('')}
        <th>${esc(meta.outcome_label || 'Hall ticket')}</th>
      </tr>`;

    const canEdit = meta.can_edit_details || meta.can_mark_hostel;
    $('exb-table').querySelector('tbody').innerHTML = students.map(st => `
      <tr>
        <td class="ex-student">
          <strong>${esc(st.name)}</strong>
          <small>Reg. No: ${st.reg_no ? esc(st.reg_no) : '<span class="owing">not set</span>'} · Sem ${esc(st.current_semester || '–')}</small>
          <small class="muted">${esc(st.programme)}${st.hostel_resident ? ' · Hostel' : ''}${st.entry_type === 'direct' ? ' · <span class="badge badge-grade">Direct entry</span>' : ''}</small>
          ${st.papers === undefined ? (st.semester ? `<small><strong>→ Semester ${esc(st.semester)}</strong></small>` : '')
            : !st.current_semester ? '<small class="owing">Semester not set — hall ticket can\'t list modules</small>'
            : st.papers === 0 ? `<small class="owing">No Semester ${esc(st.current_semester)} papers on this timetable</small>`
            : `<small class="muted">${st.papers} paper${st.papers === 1 ? '' : 's'}</small>`}
          ${canEdit ? `<button type="button" class="btn-ghost btn-small" data-edit="${st.student_id}">Edit details</button>` : ''}
        </td>
        ${steps.map(s => stepCell(st, s.key)).join('')}
        <td>${st.outcome
          ? (st.outcome.ok ? `<span class="badge badge-ok">${esc(st.outcome.label)}</span><small class="muted">${esc(st.outcome.sub)}</small>` : `<span class="muted">${esc(st.outcome.label)}</span>`)
          : st.ticket_no ? `<span class="badge badge-ok">${esc(st.ticket_no)}</span><small class="muted">${esc((st.issued_at || '').slice(0, 10))}</small>` : '<span class="muted">Not issued</span>'}</td>
      </tr>`).join('');

    const filter = $('exb-filter').value;
    $('exb-empty').hidden = students.length > 0;
    $('exb-empty').textContent = filter === 'mine'
      ? 'Nobody is waiting for your clearance right now.'
      : meta.kind === 'registration' ? 'No registrations match. Students appear here once they click Register in their portal.'
      : 'No students match. Students appear here once their programme has papers on this session\'s timetable.';

    // Bulk clear: for the steps I sign, students currently pending on that step
    const bulk = $('exb-bulk');
    const mySteps = steps.filter(s => s.mine).map(s => s.key);
    const groups = mySteps.map(k => ({ k, ids: students.filter(st => st.actions.includes(k) && st.steps[k].status === 'pending').map(st => st.student_id) }))
      .filter(g => g.ids.length > 1);
    bulk.hidden = !session.is_open || groups.length === 0;
    bulk.innerHTML = groups.map(g => {
      const label = steps.find(s => s.key === g.k).label;
      const verb = ['hod', 'dos', 'academic'].includes(g.k) ? 'Approve' : 'Clear';
      return `<button type="button" class="btn-secondary btn-small" data-bulk="${g.k}">${verb} all ${g.ids.length} shown as ${esc(label)}</button>`;
    }).join(' ');
  }

  // ---------- actions ----------
  async function decide(studentId, step, decision, note) {
    const id = $('exb-session').value;
    return api(`${API}/sessions/${id}/clearances/${studentId}/${step}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, note })
    });
  }

  root.addEventListener('click', async e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const label = s => meta.steps.find(x => x.key === s).label;

    if (btn.dataset.act) {
      const { act, step, id } = btn.dataset;
      const student = students.find(s => String(s.student_id) === id);
      if (act === 'held') {
        openDialog({
          title: `Hold ${student.name}`,
          hint: `${label(step)} — the student will see this reason on their Exams tab.`,
          fields: `<label for="${P}-note">Reason <span class="req">*</span></label>
                   <textarea id="${P}-note" name="note" maxlength="300" rows="3" required placeholder="e.g. Library book not returned"></textarea>`,
          ok: 'Hold clearance',
          submit: async fd => {
            const r = await decide(id, step, 'held', fd.get('note'));
            say(r.message, 'success');
            loadBoard();
          }
        });
        return;
      }
      btn.disabled = true;
      try {
        const r = await decide(id, step, act, null);
        say(r.message, 'success');
        await loadBoard();
      } catch (err) {
        say(err.message, 'error');
        btn.disabled = false;
      }
      return;
    }

    if (btn.dataset.bulk) {
      const step = btn.dataset.bulk;
      const ids = students.filter(st => st.actions.includes(step) && st.steps[step].status === 'pending').map(st => st.student_id);
      openDialog({
        title: `${['hod', 'dos', 'academic'].includes(step) ? 'Approve' : 'Clear'} ${ids.length} students?`,
        hint: `You are signing the ${label(step)} step for every student listed below the filters.`,
        fields: '',
        ok: 'Yes, sign all',
        submit: async () => {
          let ok = 0; const failed = [];
          for (const sid of ids) {
            try { await decide(sid, step, 'cleared', null); ok++; } catch (err) { failed.push(err.message); }
          }
          say(`${ok} signed.${failed.length ? ` ${failed.length} could not be signed: ${failed[0]}` : ''}`, failed.length ? 'error' : 'success');
          loadBoard();
        }
      });
      return;
    }

    if (btn.dataset.edit) {
      const st = students.find(s => String(s.student_id) === btn.dataset.edit);
      openDialog({
        title: st.name,
        hint: 'These details are printed on the hall ticket.',
        fields: `
          ${meta.can_edit_details ? `
            <label for="${P}-reg">Register number</label>
            <input type="text" id="${P}-reg" name="reg_no" maxlength="30" value="${esc(st.reg_no || '')}" placeholder="e.g. 25233351032">
            <label for="${P}-sem">Current semester</label>
            <div class="select-wrap"><select id="${P}-sem" name="current_semester">
              <option value="">Not set</option>
              ${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'].map(x => `<option ${st.current_semester === x ? 'selected' : ''}>${x}</option>`).join('')}
            </select></div>
            <p class="field-hint">The hall ticket lists this semester's modules for ${esc(st.programme)}.</p>` : ''}
          ${meta.can_mark_hostel ? `
            <label class="ex-check"><input type="checkbox" name="hostel_resident" ${st.hostel_resident ? 'checked' : ''}> Lives in the hostel (needs Hostel clearance)</label>` : ''}`,
        submit: async fd => {
          const json = body => ({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          if (meta.can_edit_details) {
            await api(`/api/exams/students/${st.student_id}/details`, json({ reg_no: fd.get('reg_no'), current_semester: fd.get('current_semester') }));
          }
          if (meta.can_mark_hostel && !!fd.get('hostel_resident') !== st.hostel_resident) {
            await api(`/api/exams/students/${st.student_id}/hostel`, json({ hostel_resident: !!fd.get('hostel_resident') }));
          }
          say('Details saved.', 'success');
          loadBoard();
        }
      });
    }
  });

  $('exb-session').addEventListener('change', async () => { await loadProgrammes(); loadBoard(); });
  $('exb-filter').addEventListener('change', loadBoard);
  $('exb-programme').addEventListener('change', loadBoard);
  $('exb-search').addEventListener('input', debounce(loadBoard));

  window[root.dataset.global || 'ExamBoard'] = { reload: id => loadSessions(id).catch(err => say(err.message, 'error')) };
  window[root.dataset.global || 'ExamBoard'].reload();
})(root));
