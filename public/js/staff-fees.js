// Staff dashboard → Fees: bill students, record payments, view statements and balances.
document.addEventListener('staff:loaded', async () => {
  if (!document.getElementById('tab-fees')) return;
  const S = window.Staff;
  const esc = S.escapeHtml;
  const canManage = S.me.can.manageFees;
  let data = { schools: [], annualFees: [], admissionFees: [] };
  try { data = await S.programmes(); } catch (e) { /* ignore */ }
  let openId = null;

  // View-only roles don't get the billing / payment forms
  document.querySelectorAll('#tab-fees [data-manage-only]').forEach(el => { if (!canManage) el.remove(); });

  const schoolOptions = first => `<option value="">${first}</option>` +
    data.schools.map(s => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('');
  document.getElementById('fe-school').innerHTML = schoolOptions('All schools');

  // ---------- billing ----------
  if (canManage) {
    const itemSel = document.getElementById('fe-item');
    const billSchool = document.getElementById('fe-bill-school');
    const billProg = document.getElementById('fe-bill-programme');
    billSchool.innerHTML = schoolOptions('All schools');

    const fillBillProgrammes = () => {
      const list = data.schools.filter(s => !billSchool.value || s.name === billSchool.value).flatMap(s => s.programmes);
      billProg.innerHTML = '<option value="">All programmes</option>' +
        list.map(p => `<option value="${esc(p.name)}">${esc(p.name)} — ${S.kwacha(p.fee)}</option>`).join('');
    };
    fillBillProgrammes();
    billSchool.addEventListener('change', fillBillProgrammes);

    const annual = data.annualFees.reduce((t, f) => t + f.amount, 0);
    const admission = data.admissionFees.reduce((t, f) => t + f.ug, 0);
    const d = new Date();
    function updateItem() {
      const item = itemSel.value;
      document.getElementById('fe-item-hint').textContent = {
        tuition: "Each student is charged their own programme's tuition for one semester.",
        annual: `${S.kwacha(annual)} per student (clubs, sports, library, e-learning and other annual fees).`,
        admission: `${S.kwacha(admission)} per student (application, registration, ID card and caution deposit).`
      }[item];
      document.getElementById('fe-period-field').hidden = item === 'admission';
      document.getElementById('fe-period').placeholder = item === 'annual' ? `e.g. ${d.getFullYear()}` : `e.g. ${d.getFullYear()} Semester 1`;
    }
    itemSel.addEventListener('change', updateItem);
    updateItem();

    document.getElementById('fe-bill-form').addEventListener('submit', async e => {
      e.preventDefault();
      S.hush('fe-bill-message');
      const body = {
        item: itemSel.value,
        period: document.getElementById('fe-period').value.trim(),
        school: billSchool.value,
        programme: billProg.value
      };
      if (body.item !== 'admission' && !body.period) return S.say('fe-bill-message', 'Enter the semester or year being billed.', 'error');
      const who = body.programme || body.school || 'ALL students';
      if (!confirm(`Bill ${who} for ${itemSel.selectedOptions[0].text}${body.period ? ' — ' + body.period : ''}?`)) return;

      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true; btn.classList.add('loading');
      try {
        const r = await S.api('/api/fees/bill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        S.say('fe-bill-message', r.message, r.billed ? 'success' : 'error');
        loadList();
        if (openId) openStatement(openId);
      } catch (err) {
        S.say('fe-bill-message', err.message, 'error');
      } finally {
        btn.disabled = false; btn.classList.remove('loading');
      }
    });
  }

  // ---------- list ----------
  async function loadList() {
    S.hush('fe-message');
    const params = new URLSearchParams();
    const school = document.getElementById('fe-school').value;
    const q = document.getElementById('fe-search').value.trim();
    if (school) params.set('school', school);
    if (q) params.set('q', q);
    if (document.getElementById('fe-owing').checked) params.set('owing', '1');
    try {
      const { students } = await S.api(`/api/fees/students?${params}`);
      const t = students.reduce((a, s) => ({ c: a.c + s.charged, p: a.p + s.paid, b: a.b + s.balance }), { c: 0, p: 0, b: 0 });
      document.getElementById('fe-totals').innerHTML = `
        <span>Billed <strong>${S.kwacha(t.c)}</strong></span>
        <span>Collected <strong>${S.kwacha(t.p)}</strong></span>
        <span>Outstanding <strong class="${t.b > 0 ? 'owing' : ''}">${S.kwacha(t.b)}</strong></span>
        <span class="muted">${students.length} student${students.length === 1 ? '' : 's'}</span>`;
      document.getElementById('fe-empty').hidden = students.length > 0;
      document.querySelector('#fe-table tbody').innerHTML = students.map(s => `
        <tr class="click-row ${String(s.student_id) === String(openId) ? 'active' : ''}" data-id="${s.student_id}" tabindex="0">
          <td><strong>${esc(s.name)}</strong><br><small>ID ${esc(s.student_id)}</small></td>
          <td class="wrap"><small>${esc(s.programme || '–')}</small></td>
          <td class="num">${S.kwacha(s.charged)}</td>
          <td class="num">${S.kwacha(s.paid)}</td>
          <td class="num ${s.balance > 0 ? 'owing' : (s.balance < 0 ? 'credit' : '')}"><strong>${S.kwacha(s.balance)}</strong></td>
        </tr>`).join('');
    } catch (err) {
      S.say('fe-message', err.message, 'error');
    }
  }

  document.getElementById('fe-school').addEventListener('change', loadList);
  document.getElementById('fe-owing').addEventListener('change', loadList);
  document.getElementById('fe-search').addEventListener('input', S.debounce(loadList));
  const table = document.getElementById('fe-table');
  table.addEventListener('click', e => { const r = e.target.closest('tr[data-id]'); if (r) openStatement(r.dataset.id); });
  table.addEventListener('keydown', e => { const r = e.target.closest('tr[data-id]'); if (r && e.key === 'Enter') openStatement(r.dataset.id); });

  // ---------- statement ----------
  async function openStatement(id) {
    openId = id;
    table.querySelectorAll('tr[data-id]').forEach(r => r.classList.toggle('active', r.dataset.id === String(id)));
    S.hush('fed-message');
    try {
      const st = await S.api(`/api/fees/students/${id}`);
      document.getElementById('fed-ref').textContent = `Student ID ${st.student.student_id}`;
      document.getElementById('fed-name').textContent = st.student.name;
      document.getElementById('fed-programme').textContent = [st.student.programme, st.student.school].filter(Boolean).join(' · ');
      const bal = document.getElementById('fed-balance');
      bal.className = `balance-pill ${st.balance > 0 ? 'owing' : 'clear'}`;
      bal.innerHTML = `<small>${st.balance > 0 ? 'Owes' : st.balance < 0 ? 'In credit' : 'Balance'}</small><strong>${S.kwacha(Math.abs(st.balance))}</strong>`;

      let running = 0;
      document.querySelector('#fed-table tbody').innerHTML = st.entries.length ? st.entries.map(e => {
        running += e.entry_type === 'charge' ? e.amount : -e.amount;
        const details = e.entry_type === 'payment'
          ? `${esc(e.description)}<br><small>${esc(e.method || '')} · Ref ${esc(e.reference || '–')}${e.recorded_by ? ' · by ' + esc(e.recorded_by) : ''}</small>`
          : esc(e.description);
        return `
          <tr>
            <td>${esc(e.entry_date)}</td>
            <td class="wrap">${details}</td>
            <td class="num">${e.entry_type === 'charge' ? S.kwacha(e.amount) : ''}</td>
            <td class="num paid">${e.entry_type === 'payment' ? S.kwacha(e.amount) : ''}</td>
            <td class="num">${S.kwacha(running)}</td>
            <td>${canManage ? `<button type="button" class="icon-btn" data-remove="${e.entry_id}" title="Remove entry" aria-label="Remove entry">✕</button>` : ''}</td>
          </tr>`;
      }).join('') : '<tr><td colspan="6" class="muted">Nothing billed or paid yet.</td></tr>';

      if (canManage) {
        const now = new Date();
        const local = new Date(now - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
        const dateEl = document.getElementById('pay-date');
        dateEl.max = local;
        if (!dateEl.value) dateEl.value = local;
      }

      const panel = document.getElementById('fe-detail');
      panel.hidden = false;
      if (window.innerWidth < 900) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      S.say('fe-message', err.message, 'error');
    }
  }

  if (canManage) {
    document.getElementById('fe-pay-form').addEventListener('submit', async e => {
      e.preventDefault();
      S.hush('fed-message');
      const amount = document.getElementById('pay-amount').value;
      const reference = document.getElementById('pay-ref').value.trim();
      if (!(Number(amount) > 0)) return S.say('fed-message', 'Enter an amount greater than zero.', 'error');
      if (!reference) return S.say('fed-message', 'Enter the receipt or bank reference number.', 'error');
      try {
        const text = await S.api(`/api/fees/students/${openId}/payments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount, reference,
            method: document.getElementById('pay-method').value,
            date: document.getElementById('pay-date').value
          })
        });
        document.getElementById('pay-amount').value = '';
        document.getElementById('pay-ref').value = '';
        await openStatement(openId);
        S.say('fed-message', text, 'success');
        loadList();
      } catch (err) {
        S.say('fed-message', err.message, 'error');
      }
    });

    document.getElementById('fe-charge-form').addEventListener('submit', async e => {
      e.preventDefault();
      S.hush('fed-message');
      try {
        const text = await S.api(`/api/fees/students/${openId}/charges`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: document.getElementById('ch-desc').value,
            amount: document.getElementById('ch-amount').value
          })
        });
        e.target.reset();
        await openStatement(openId);
        S.say('fed-message', text, 'success');
        loadList();
      } catch (err) {
        S.say('fed-message', err.message, 'error');
      }
    });

    document.getElementById('fed-table').addEventListener('click', async e => {
      const btn = e.target.closest('[data-remove]');
      if (!btn) return;
      if (!confirm('Remove this entry? Only do this if it was recorded by mistake.')) return;
      try {
        const text = await S.api(`/api/fees/entries/${btn.dataset.remove}`, { method: 'DELETE' });
        await openStatement(openId);
        S.say('fed-message', text, 'success');
        loadList();
      } catch (err) {
        S.say('fed-message', err.message, 'error');
      }
    });
  }

  // ---------- proofs of payment ----------
  let pqStatus = 'pending';
  document.getElementById('pq-hint').textContent = canManage
    ? 'Open each receipt, check it against the bank statement or receipt book, then verify it (this records the payment) or reject it with a reason.'
    : 'Receipts uploaded by students. The Accountant verifies them.';

  async function loadProofs() {
    S.hush('pq-message');
    try {
      const { proofs } = await S.api(`/api/fees/proofs?status=${pqStatus}`);
      if (pqStatus === 'pending') {
        const pill = document.getElementById('pq-count');
        pill.hidden = proofs.length === 0;
        pill.textContent = proofs.length;
      }
      const empty = document.getElementById('pq-empty');
      empty.hidden = proofs.length > 0;
      empty.textContent = { pending: 'No receipts waiting to be verified.', verified: 'No verified receipts yet.', rejected: 'No rejected receipts.' }[pqStatus];

      document.getElementById('pq-list').innerHTML = proofs.map(p => {
        const manageable = canManage && p.status === 'pending';
        return `
        <article class="proof-card status-${p.status}" data-proof="${p.proof_id}">
          <div class="proof-main">
            <strong>${esc(p.student_name)} <small class="muted">ID ${esc(p.student_id)}</small></strong>
            <span>${esc(p.programme || '')}</span>
            <span>Claims <strong>${S.kwacha(p.amount)}</strong> · ref <strong>${esc(p.reference)}</strong> · paid ${esc(p.payment_date)}${p.method ? ' · ' + esc(p.method) : ''}</span>
            ${p.note ? `<span class="muted">“${esc(p.note)}”</span>` : ''}
            <small class="muted">Uploaded ${esc(p.uploaded_at)}${p.reviewed_by ? ` · ${p.status} by ${esc(p.reviewed_by)} ${esc(p.reviewed_at)}` : ''}</small>
            ${p.reference_used && p.status === 'pending' ? '<p class="proof-reason"><strong>Warning:</strong> a payment with this reference is already recorded. This may be a duplicate.</p>' : ''}
            ${p.status === 'rejected' && p.review_note ? `<p class="proof-reason"><strong>Reason given:</strong> ${esc(p.review_note)}</p>` : ''}
            ${manageable ? `
              <div class="pq-verify">
                <label>Amount (K)<input type="number" class="pq-amount" min="1" step="0.01" value="${p.amount}"></label>
                <label>Reference<input type="text" class="pq-ref" maxlength="60" value="${esc(p.reference)}"></label>
              </div>
              <div class="pq-reject" hidden>
                <input type="text" class="pq-reason" maxlength="500" placeholder="Reason, e.g. receipt is unreadable — please upload a clearer photo">
                <button type="button" class="btn-reject btn-small" data-confirm-reject>Confirm reject</button>
              </div>` : ''}
          </div>
          <div class="proof-side">
            <button type="button" class="btn-ghost btn-small" data-view-proof data-name="${esc(p.file_name)}">View receipt</button>
            ${manageable ? `
              <button type="button" class="btn-accept btn-small" data-verify>Verify</button>
              <button type="button" class="btn-danger btn-small" data-reject>Reject</button>` : ''}
          </div>
        </article>`;
      }).join('');
    } catch (err) {
      S.say('pq-message', err.message, 'error');
    }
  }

  document.querySelectorAll('#pq .seg-btn').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('#pq .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
    pqStatus = btn.dataset.pq;
    loadProofs();
  }));

  document.getElementById('pq-list').addEventListener('click', async e => {
    const card = e.target.closest('[data-proof]');
    if (!card) return;
    const id = card.dataset.proof;
    S.hush('pq-message');
    try {
      if (e.target.closest('[data-view-proof]')) {
        await S.download(`/api/fees/proofs/${id}/file`, e.target.closest('[data-view-proof]').dataset.name, true);
        return;
      }
      if (e.target.closest('[data-verify]')) {
        const amount = card.querySelector('.pq-amount').value;
        const reference = card.querySelector('.pq-ref').value.trim();
        if (!confirm(`Verify ${S.kwacha(amount)} (ref ${reference})? It will be added to the student's statement.`)) return;
        const text = await S.api(`/api/fees/proofs/${id}/verify`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount, reference })
        });
        S.say('pq-message', text, 'success');
      } else if (e.target.closest('[data-reject]')) {
        const box = card.querySelector('.pq-reject');
        box.hidden = !box.hidden;
        if (!box.hidden) box.querySelector('.pq-reason').focus();
        return;
      } else if (e.target.closest('[data-confirm-reject]')) {
        const reason = card.querySelector('.pq-reason').value.trim();
        if (!reason) { card.querySelector('.pq-reason').focus(); return S.say('pq-message', 'Give the student a reason so they know what to fix.', 'error'); }
        S.say('pq-message', await S.api(`/api/fees/proofs/${id}/reject`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason })
        }), 'success');
      } else {
        return;
      }
      loadProofs();
      loadList();
      if (openId) openStatement(openId);
    } catch (err) {
      S.say('pq-message', err.message, 'error');
    }
  });

  loadProofs();
  loadList();
});
