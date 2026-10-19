// Staff dashboard → Registration: open / close registration windows (Registrar, Dean (Academic),
// Administrator). The approval board below lives in exam-clearance.js (data-api="/api/registration").
document.addEventListener('staff:loaded', () => {
  if (!document.getElementById('tab-registration')) return;
  const S = window.Staff;
  const esc = S.escapeHtml;
  const box = document.getElementById('rp-manage');
  if (!['administrator', 'registrar', 'dean_academic'].includes(S.role)) { box.remove(); return; }
  box.hidden = false;
  let windows = [];
  const reloadBoard = id => window.RegBoard && window.RegBoard.reload(id);

  async function load() {
    try {
      windows = (await S.api('/api/registration/sessions')).sessions;
      document.getElementById('rw-empty').hidden = windows.length > 0;
      document.querySelector('#rw-table tbody').innerHTML = windows.map(w => `
        <tr>
          <td><strong>${esc(w.name)}</strong><br><small class="muted">Opened ${esc(w.created_at)}</small></td>
          <td class="num">${w.min_paid_pct}%</td>
          <td class="num">${w.registrations}</td>
          <td class="num">${w.approved}</td>
          <td>${w.is_open ? '<span class="badge badge-ok">Open</span>' : '<span class="badge badge-full">Closed</span>'}</td>
          <td class="ex-actions">
            <button type="button" class="btn-ghost btn-small" data-toggle="${w.session_id}" data-open="${w.is_open ? 0 : 1}">${w.is_open ? 'Close' : 'Reopen'}</button>
            ${Number(w.registrations) === 0 ? `<button type="button" class="btn-danger btn-small" data-del="${w.session_id}">Delete</button>` : ''}
          </td>
        </tr>`).join('');
    } catch (err) {
      S.say('rw-message', err.message, 'error');
    }
  }

  document.getElementById('rw-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button[type="submit"]');
    btn.classList.add('loading'); btn.disabled = true;
    try {
      const r = await S.api('/api/registration/sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: f.name.value, min_paid_pct: Number(f.min_paid_pct.value) })
      });
      S.say('rw-message', r.message, 'success');
      f.name.value = '';
      await load();
      reloadBoard(r.session_id);
    } catch (err) {
      S.say('rw-message', err.message, 'error');
    } finally {
      btn.classList.remove('loading'); btn.disabled = false;
    }
  });

  document.getElementById('rw-table').addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.toggle) {
        const msg = await S.api(`/api/registration/sessions/${b.dataset.toggle}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_open: b.dataset.open === '1' })
        });
        S.say('rw-message', msg, 'success');
      }
      if (b.dataset.del) {
        if (b.dataset.confirm !== 'yes') { b.dataset.confirm = 'yes'; b.textContent = 'Confirm delete'; return; }
        await S.api(`/api/registration/sessions/${b.dataset.del}`, { method: 'DELETE' });
        S.hush('rw-message');
      }
      await load();
      reloadBoard();
    } catch (err) {
      S.say('rw-message', err.message, 'error');
    }
  });

  load();
});

// Staff dashboard → Registration → Direct entry & exemptions
document.addEventListener('staff:loaded', () => {
  const box = document.getElementById('ex-direct');
  if (!box) return;
  const S = window.Staff;
  const esc = S.escapeHtml;
  if (!['administrator', 'registrar', 'dean_academic'].includes(S.role)) { box.remove(); return; }
  box.hidden = false;
  let semesters = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  const range = (a, b) => a === b ? `Semester ${a}` : `Semesters ${a}–${b}`;

  function card(st) {
    const last = semesters.indexOf(st.final_semester);
    const opts = semesters.slice(0, Math.max(last, 1)).map(x => `<option>${x}</option>`).join('');
    return `
      <article class="xd-card" data-id="${st.student_id}">
        <header>
          <div>
            <strong>${esc(st.name)}</strong> ${st.entry_type === 'direct' ? '<span class="badge badge-grade">Direct entry</span>' : ''}
            <small class="muted">Reg. No ${esc(st.reg_no || '–')} · ${esc(st.programme || 'No programme')} · Current semester ${esc(st.current_semester || 'I')} of ${esc(st.final_semester)}</small>
          </div>
        </header>
        ${st.exemptions.length ? `<ul class="xd-list">${st.exemptions.map(e => `
          <li><span><strong>Exempted: ${range(e.from_semester, e.to_semester)}</strong> — ${esc(e.reason)}
            <small class="muted">${esc(e.granted_by || 'Staff')} · ${esc(e.granted_at)}</small></span>
            <button type="button" class="btn-ghost btn-small" data-remove="${e.exemption_id}">Remove</button></li>`).join('')}</ul>`
          : '<p class="muted xd-none">No exemptions.</p>'}
        <form class="xd-form" novalidate>
          <label>From <span class="select-wrap filter-select"><select name="from_semester">${opts}</select></span></label>
          <label>To <span class="select-wrap filter-select"><select name="to_semester">${opts.replace('<option>II</option>', '<option selected>II</option>')}</select></span></label>
          <input type="text" name="reason" maxlength="300" class="filter-search" placeholder="Reason, e.g. Direct entry — holds a Diploma in Computer Science">
          <button type="submit" class="btn-primary btn-small">Grant exemption</button>
        </form>
      </article>`;
  }

  async function search() {
    const q = document.getElementById('xd-search').value.trim();
    const out = document.getElementById('xd-results');
    if (q.length < 2) { out.innerHTML = ''; return; }
    try {
      const d = await S.api(`/api/registration/students?q=${encodeURIComponent(q)}`);
      if (d.semesters) semesters = d.semesters;
      out.innerHTML = d.students.length ? d.students.map(card).join('') : '<p class="empty-state">No students match.</p>';
    } catch (err) {
      S.say('xd-message', err.message, 'error');
    }
  }
  document.getElementById('xd-search').addEventListener('input', S.debounce(search));

  box.addEventListener('submit', async e => {
    const f = e.target.closest('.xd-form');
    if (!f) return;
    e.preventDefault();
    const id = f.closest('.xd-card').dataset.id;
    try {
      const msg = await S.api(`/api/registration/students/${id}/exemptions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_semester: f.from_semester.value, to_semester: f.to_semester.value, reason: f.reason.value })
      });
      S.say('xd-message', msg, 'success');
      search();
      if (window.RegBoard) window.RegBoard.reload();
    } catch (err) {
      S.say('xd-message', err.message, 'error');
    }
  });

  box.addEventListener('click', async e => {
    const b = e.target.closest('button[data-remove]');
    if (!b) return;
    if (b.dataset.confirm !== 'yes') { b.dataset.confirm = 'yes'; b.textContent = 'Confirm remove'; return; }
    try {
      S.say('xd-message', await S.api(`/api/registration/exemptions/${b.dataset.remove}`, { method: 'DELETE' }), 'success');
      search();
    } catch (err) {
      S.say('xd-message', err.message, 'error');
    }
  });
});
