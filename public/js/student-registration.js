// Student dashboard → Registration: current semester, register for the next one, approval progress, history.
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('token');
  const auth = { 'Authorization': `Bearer ${token}` };
  const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const $ = id => document.getElementById(id);
  const say = (text, type) => { const el = $('sr2-message'); el.textContent = text; el.className = `message show ${type}`; };
  const kwacha = n => 'K' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
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
        ${r.steps.accounts.status !== 'cleared' ? `<div class="notice notice-warn">${esc(r.steps.accounts.detail || '')}
          ${r.steps.accounts.charged > 0 ? ` <a href="#tab-fees">Pay or upload your receipt in the Fees tab →</a>` : ''}</div>` : ''}
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

  // What registering will add to the fee statement, and the least the student must pay
  function feeSummary(f) {
    if (!f) return '';
    const rows = f.items.map(i => `<tr><td>${esc(i.description)}</td><td class="num">${kwacha(i.amount)}</td></tr>`).join('');
    return `
      <div class="reg-fees">
        <h4>Fees this registration adds</h4>
        <table>
          <tbody>${rows || '<tr><td colspan="2">No new fees: these have already been billed.</td></tr>'}</tbody>
          <tfoot>
            <tr><td>Added now</td><td class="num">${kwacha(f.new_total)}</td></tr>
            <tr><td>Already paid</td><td class="num">− ${kwacha(f.paid)}</td></tr>
            <tr class="reg-fees-total"><td>${f.balance_after < 0 ? 'In credit after registering' : 'Balance after registering'}</td><td class="num">${kwacha(Math.abs(f.balance_after))}</td></tr>
          </tfoot>
        </table>
        <p>${f.min_to_pay > 0
          ? `To be cleared by Accounts you need to pay at least <strong>${kwacha(f.min_to_pay)}</strong> more (any balance from earlier semesters in full, plus ${f.min_paid_pct}% of this semester's fees).`
          : `You have already paid at least ${f.min_paid_pct}% of this semester's fees, so the Accounts office will clear you automatically.`}</p>
      </div>`;
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

      // The three stages of registering, with the student's current stage highlighted
      const live = d.history.find(h => h.status !== 'approved' && h.is_open);
      const stage = !live ? 1 : live.steps.accounts.status !== 'cleared' ? 2 : 3;
      const minPct = live ? live.steps.accounts.required_pct : (d.open_periods[0] ? d.open_periods[0].min_paid_pct : 40);
      const guide = [
        ['Register for the semester', 'Your semester fees are added to your fee statement.'],
        [`Pay at least ${minPct}% of your fees`, 'Pay at the bank, then upload the receipt in the Fees tab. The Accounts office clears you once it is verified.'],
        ['Get approved', 'Class Advisor → Head of Department → Dean of Students → Dean (Academic). The last approval completes your registration.']
      ];
      $('sr2-guide').innerHTML = `<ol class="reg-guide">${guide.map(([t, sub], i) => `
        <li class="${i + 1 < stage ? 'done' : i + 1 === stage && (live || d.next_semester) ? 'now' : ''}">
          <span class="reg-guide-num">${i + 1 < stage ? '✓' : i + 1}</span>
          <span><strong>${esc(t)}</strong><small>${esc(sub)}</small></span>
        </li>`).join('')}</ol>`;

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
            ${feeSummary(d.fee_preview)}
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
