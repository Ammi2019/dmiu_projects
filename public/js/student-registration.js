// Student dashboard → Registration: current semester, register for the next one, approval progress, history.
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('token');
  const auth = { 'Authorization': `Bearer ${token}` };
  const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const $ = id => document.getElementById(id);
  const say = (text, type) => { const el = $('sr2-message'); el.textContent = text; el.className = `message show ${type}`; };
  const STATUS = { cleared: ['ok', 'Cleared', '✓'], held: ['danger', 'On hold', '!'], pending: ['late', 'Pending', '…'], waiting: ['full', 'Waiting', '·'] };

  function progress(r) {
    const steps = Object.values(r.steps);
    const next = steps.find(s => s.status !== 'cleared');
    return `
      <article class="ex-card">
        <header class="ex-card-head">
          <div>
            <p class="sa-course">${esc(r.period_name)}</p>
            <h3>Registering for Semester ${esc(r.semester)}</h3>
            <p class="sa-meta">Submitted ${esc(r.submitted_at)}${next ? ` · Now with: <strong>${esc(next.label)}</strong>` : ''}</p>
          </div>
          <div class="ex-ticket-box">
            <span class="badge badge-late">Awaiting approval</span>
            ${steps.every(s => !s.by) ? `<button type="button" class="btn-ghost btn-small" data-withdraw="${r.reg_id}">Withdraw</button>` : ''}
          </div>
        </header>
        ${r.steps.accounts.status !== 'cleared' ? `<div class="notice notice-warn">${esc(r.steps.accounts.detail || '')}</div>` : ''}
        <ol class="ex-stepper ex-stepper-5">
          ${steps.map(s => `
            <li class="ex-stage stage-${s.status}">
              <span class="ex-dot" aria-hidden="true">${STATUS[s.status][2]}</span>
              <span class="ex-stage-text">
                <strong>${esc(s.label)}</strong>
                <small>${STATUS[s.status][1]}${s.at ? ' · ' + esc(s.at.slice(0, 10)) : ''}${s.key === 'accounts' && s.auto && s.status === 'cleared' ? ' · automatic' : ''}</small>
                ${s.note ? `<small class="ex-note">“${esc(s.note)}”</small>` : ''}
              </span>
            </li>`).join('')}
        </ol>
      </article>`;
  }

  async function load() {
    try {
      const res = await fetch('/api/registration/mine', { headers: auth });
      if (!res.ok) throw new Error(await res.text());
      const d = await res.json();
      const approved = d.history.filter(h => h.status === 'approved').length;

      $('sr2-cards').innerHTML = `
        <div class="stat-card"><span class="stat-label">Current semester</span><span class="stat-value">${esc(d.current_semester)}</span></div>
        <div class="stat-card"><span class="stat-label">Semesters registered</span><span class="stat-value">${approved}</span></div>
        <div class="stat-card"><span class="stat-label">Final semester</span><span class="stat-value">${esc(d.final_semester)}</span></div>`;

      // Direct entry / exemptions
      const range = (a, b) => a === b ? `Semester ${a}` : `Semesters ${a}–${b}`;
      const exNote = d.exemptions.length ? `
        <div class="notice notice-info">
          <strong>${d.entry_type === 'direct' ? 'Direct entry student' : 'Exemptions'}:</strong>
          ${d.exemptions.map(e => `exempted from ${range(e.from_semester, e.to_semester)} — ${esc(e.reason)}`).join('; ')}.
          You don't register for exempted semesters.
        </div>` : '';

      // Register button
      const reg = $('sr2-register');
      if (d.in_progress) {
        reg.innerHTML = exNote;
      } else if (!d.next_semester) {
        reg.innerHTML = exNote + '<div class="notice">You have registered for every semester of your programme.</div>';
      } else if (!d.open_periods.length) {
        reg.innerHTML = exNote + `<div class="notice">Registration for Semester ${esc(d.next_semester)} is not open yet. You will be able to register here when the registry opens it.</div>`;
      } else {
        const p = d.open_periods[0];
        reg.innerHTML = exNote + `
          <div class="pay-box reg-box">
            <div>
              <h3>Register for Semester ${esc(d.next_semester)}</h3>
              <p class="section-hint">${d.open_periods.length > 1
                ? `<label for="sr2-period">Registration window</label> <span class="select-wrap filter-select"><select id="sr2-period">${d.open_periods.map(x => `<option value="${x.period_id}">${esc(x.name)}</option>`).join('')}</select></span>`
                : esc(p.name)} · You need at least ${p.min_paid_pct}% of your fees paid.</p>
            </div>
            <button type="button" class="btn-cta btn-cta-sm" id="sr2-go" data-period="${p.period_id}"><span class="btn-cta-label">Register for Semester ${esc(d.next_semester)}</span><span class="spinner" aria-hidden="true"></span></button>
          </div>`;
      }

      // In-progress registration (open window, not approved yet)
      $('sr2-current').innerHTML = d.history.filter(h => h.status !== 'approved' && h.is_open).map(progress).join('');

      // History, with exempted semesters listed alongside the registrations
      const ORDER = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
      const exemptRows = d.exemptions.flatMap(e => ORDER.slice(ORDER.indexOf(e.from_semester), ORDER.indexOf(e.to_semester) + 1)
        .map(sem => ({ sem, e })));
      const exHtml = exemptRows.map(({ sem, e }) => `
        <tr class="row-exempt">
          <td><strong>Semester ${sem}</strong></td>
          <td>${esc(e.reason)}</td>
          <td>${esc(e.granted_at)}</td>
          <td><span class="badge badge-grade">Exempted</span></td>
          <td>–</td>
        </tr>`).reverse().join('');
      $('sr2-empty').hidden = d.history.length + exemptRows.length > 0;
      $('sr2-history').querySelector('tbody').innerHTML = d.history.map(h => `
        <tr>
          <td><strong>Semester ${esc(h.semester)}</strong></td>
          <td>${esc(h.period_name)}</td>
          <td>${esc((h.submitted_at || '').slice(0, 10))}</td>
          <td>${h.status === 'approved' ? '<span class="badge badge-ok">Registered</span>'
              : h.is_open ? '<span class="badge badge-late">Awaiting approval</span>'
              : '<span class="badge badge-danger">Not completed</span>'}</td>
          <td>${esc((h.approved_at || '').slice(0, 10)) || '–'}</td>
        </tr>`).join('') + exHtml;
    } catch (err) {
      say(err.message || 'Could not load your registration.', 'error');
    }
  }

  document.getElementById('tab-registration').addEventListener('click', async e => {
    const go = e.target.closest('#sr2-go');
    const wd = e.target.closest('[data-withdraw]');
    if (go) {
      const sel = $('sr2-period');
      go.classList.add('loading'); go.disabled = true;
      try {
        const res = await fetch('/api/registration/mine', {
          method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ period_id: sel ? sel.value : go.dataset.period })
        });
        const text = await res.text();
        if (!res.ok) throw new Error(text);
        say(text, 'success');
        await load();
      } catch (err) {
        say(err.message, 'error');
        go.classList.remove('loading'); go.disabled = false;
      }
    }
    if (wd) {
      if (wd.dataset.confirm !== 'yes') { wd.dataset.confirm = 'yes'; wd.textContent = 'Confirm withdraw'; return; }
      const res = await fetch(`/api/registration/mine/${wd.dataset.withdraw}`, { method: 'DELETE', headers: auth });
      const text = await res.text();
      say(text, res.ok ? 'success' : 'error');
      load();
    }
  });

  load();
  const tab = document.querySelector('.tab[data-tab="tab-registration"]');
  if (tab) tab.addEventListener('click', load);
});
