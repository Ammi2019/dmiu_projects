// Student dashboard → Fees: statement, balance, and proof-of-payment uploads.
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('token');
  const auth = { 'Authorization': `Bearer ${token}` };
  const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const kwacha = n => 'K' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const say = (id, text, type) => { const el = document.getElementById(id); el.textContent = text; el.className = `message show ${type}`; };

  const STATUS = {
    pending: '<span class="badge badge-late">Awaiting verification</span>',
    verified: '<span class="badge badge-ok">Verified</span>',
    rejected: '<span class="badge badge-danger">Not accepted</span>'
  };

  // Local "today" for the date picker
  const now = new Date();
  const todayLocal = new Date(now - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const dateInput = document.getElementById('sp-date');
  dateInput.max = todayLocal;
  dateInput.value = todayLocal;

  async function load() {
    try {
      const res = await fetch('/api/fees/mine', { headers: auth });
      if (!res.ok) throw new Error(await res.text());
      const f = await res.json();

      const pending = f.proofs.filter(p => p.status === 'pending');
      const pendingTotal = pending.reduce((t, p) => t + p.amount, 0);

      document.getElementById('sf-cards').innerHTML = `
        <div class="stat-card"><span class="stat-label">Total billed</span><span class="stat-value">${kwacha(f.charged)}</span></div>
        <div class="stat-card"><span class="stat-label">Total paid</span><span class="stat-value">${kwacha(f.paid)}</span></div>
        <div class="stat-card ${f.balance > 0 ? 'tone-warn' : 'tone-ok'}">
          <span class="stat-label">${f.balance > 0 ? 'Balance to pay' : f.balance < 0 ? 'In credit' : 'Balance'}</span>
          <span class="stat-value">${kwacha(Math.abs(f.balance))}</span>
          ${pending.length ? `<small class="stat-sub">${kwacha(pendingTotal)} awaiting verification</small>` : ''}
        </div>`;

      // My uploads
      document.getElementById('sf-proofs-wrap').hidden = f.proofs.length === 0;
      document.getElementById('sf-proofs').innerHTML = f.proofs.map(p => `
        <article class="proof-card status-${p.status}">
          <div class="proof-main">
            <strong>${kwacha(p.amount)}</strong>
            <span>Ref ${esc(p.reference)} · paid ${esc(p.payment_date)}${p.method ? ' · ' + esc(p.method) : ''}</span>
            <small class="muted">Uploaded ${esc(p.uploaded_at)}</small>
            ${p.status === 'rejected' && p.review_note ? `<p class="proof-reason"><strong>Reason:</strong> ${esc(p.review_note)}</p>` : ''}
          </div>
          <div class="proof-side">
            ${STATUS[p.status] || ''}
            <div class="proof-actions">
              <button type="button" class="btn-ghost btn-small" data-view="${p.proof_id}">View</button>
              ${p.status === 'pending' ? `<button type="button" class="btn-danger btn-small" data-withdraw="${p.proof_id}">Withdraw</button>` : ''}
            </div>
          </div>
        </article>`).join('');

      // Statement
      let running = 0;
      document.querySelector('#sf-table tbody').innerHTML = f.entries.length ? f.entries.map(e => {
        running += e.entry_type === 'charge' ? e.amount : -e.amount;
        return `
          <tr>
            <td>${esc(e.entry_date)}</td>
            <td class="wrap">${esc(e.description)}${e.entry_type === 'payment' && e.reference ? `<br><small>Receipt ${esc(e.reference)}</small>` : ''}</td>
            <td class="num">${e.entry_type === 'charge' ? kwacha(e.amount) : ''}</td>
            <td class="num paid">${e.entry_type === 'payment' ? kwacha(e.amount) : ''}</td>
            <td class="num">${kwacha(running)}</td>
          </tr>`;
      }).join('') : '<tr><td colspan="5" class="muted">Nothing has been billed to your account yet.</td></tr>';

      if (f.payment) {
        document.getElementById('sf-pay').innerHTML = `
          <div>
            <h3>How to pay</h3>
            <dl class="pay-list">
              <dt>Bank</dt><dd>${esc(f.payment.bank)}</dd>
              <dt>Account name</dt><dd>${esc(f.payment.accountName)}</dd>
              <dt>Account no.</dt><dd class="mono">${esc(f.payment.accountNo)}</dd>
              <dt>Swift code</dt><dd class="mono">${esc(f.payment.swift)}</dd>
            </dl>
          </div>
          <p class="fee-source">After paying, upload your receipt above. Your balance updates once the Accounts office has verified it.</p>`;
      }
    } catch (err) {
      say('sf-message', err.message || 'Could not load your fees.', 'error');
    }
  }

  // ---------- upload ----------
  const fileInput = document.getElementById('sp-file');
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    fileInput.nextElementSibling.textContent = file ? file.name : 'Choose a photo or PDF of your receipt (max 5MB)';
    document.getElementById('sp-file-label').classList.toggle('has-file', Boolean(file));
  });

  document.getElementById('sf-proof-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    const file = fileInput.files[0];
    if (!(Number(form.amount.value) > 0)) return say('sp-message', 'Enter the amount you paid.', 'error');
    if (!form.reference.value.trim()) return say('sp-message', 'Enter the receipt or bank reference number.', 'error');
    if (!form.date.value) return say('sp-message', 'Enter the date you paid.', 'error');
    if (!file) return say('sp-message', 'Attach a photo or PDF of your receipt.', 'error');
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) return say('sp-message', 'Upload a PDF, JPEG or PNG.', 'error');
    if (file.size > 5 * 1024 * 1024) return say('sp-message', 'File is too large. Maximum size is 5MB.', 'error');

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true; btn.classList.add('loading');
    try {
      const res = await fetch('/api/fees/mine/proofs', { method: 'POST', headers: auth, body: new FormData(form) });
      const text = await res.text();
      if (!res.ok) throw new Error(text);
      say('sp-message', text, 'success');
      form.reset();
      dateInput.value = todayLocal;
      fileInput.dispatchEvent(new Event('change'));
      load();
    } catch (err) {
      say('sp-message', err.message || 'Upload failed.', 'error');
    } finally {
      btn.disabled = false; btn.classList.remove('loading');
    }
  });

  // ---------- view / withdraw ----------
  document.getElementById('sf-proofs').addEventListener('click', async e => {
    const view = e.target.closest('[data-view]');
    const withdraw = e.target.closest('[data-withdraw]');
    try {
      if (view) {
        const res = await fetch(`/api/fees/mine/proofs/${view.dataset.view}/file`, { headers: auth });
        if (!res.ok) throw new Error(await res.text());
        window.open(URL.createObjectURL(await res.blob()), '_blank');
      }
      if (withdraw) {
        if (!confirm('Withdraw this receipt? You can upload it again later.')) return;
        const res = await fetch(`/api/fees/mine/proofs/${withdraw.dataset.withdraw}`, { method: 'DELETE', headers: auth });
        const text = await res.text();
        if (!res.ok) throw new Error(text);
        say('sp-message', text, 'success');
        load();
      }
    } catch (err) {
      say('sf-message', err.message, 'error');
    }
  });

  load();
});
