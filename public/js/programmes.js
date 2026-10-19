// Renders the Programmes tab from /api/programmes (source: data/programmes.json).
document.addEventListener('DOMContentLoaded', async () => {
  let data;
  try {
    const res = await fetch('/api/programmes');
    if (!res.ok) throw new Error();
    data = await res.json();
  } catch (err) {
    document.getElementById('schools-list').innerHTML =
      '<p class="empty-state">Programmes could not be loaded. Please refresh the page.</p>';
    return;
  }

  const schoolsList = document.getElementById('schools-list');
  const chipsEl = document.getElementById('school-chips');
  const searchEl = document.getElementById('prog-search');
  const emptyEl = document.getElementById('prog-empty');
  let level = 'all';

  const kwacha = n => 'K' + Number(n).toLocaleString('en-US');
  const escapeHtml = v => String(v ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));

  // ---------- programmes by school ----------
  function render() {
    const q = searchEl.value.trim().toLowerCase();
    let shown = 0;

    const html = data.schools.map(school => {
      const progs = school.programmes.filter(p =>
        (level === 'all' || p.level === level) &&
        (!q || p.name.toLowerCase().includes(q) || school.name.toLowerCase().includes(q))
      );
      if (!progs.length) return '';
      shown += progs.length;

      const cards = progs.map(p => `
        <article class="prog-card">
          <div class="prog-card-top">
            <span class="level-badge level-${p.level.toLowerCase()}">${escapeHtml(p.level)}</span>
            <span class="prog-duration">${p.years} years</span>
          </div>
          <h4 class="prog-name">${escapeHtml(p.name)}</h4>
          <div class="prog-card-bottom">
            <div class="prog-fee">
              <span class="prog-fee-amount">${kwacha(p.fee)}</span>
              <span class="prog-fee-unit">per semester</span>
            </div>
            <a href="/apply.html?programme=${encodeURIComponent(p.name)}" class="prog-apply" aria-label="Apply for ${escapeHtml(p.name)}">Apply <span aria-hidden="true">→</span></a>
          </div>
        </article>`).join('');

      return `
        <section class="school-block" id="school-${school.id}">
          <header class="school-head">
            <div>
              <h3>${escapeHtml(school.name)}</h3>
              <p>${escapeHtml(school.blurb)}</p>
            </div>
            <span class="school-count">${progs.length} programme${progs.length === 1 ? '' : 's'}</span>
          </header>
          <div class="prog-grid">${cards}</div>
        </section>`;
    }).join('');

    schoolsList.innerHTML = html;
    emptyEl.hidden = shown > 0;

    // Only show jump-chips for schools that are currently visible
    chipsEl.innerHTML = data.schools
      .filter(s => schoolsList.querySelector(`#school-${s.id}`))
      .map(s => `<a href="#school-${s.id}" class="school-chip" data-target="school-${s.id}">${escapeHtml(s.name.replace(/^School of /, ''))}</a>`)
      .join('');
  }

  // Smooth-scroll for chips without changing the hash (the page uses tabs, not routes)
  chipsEl.addEventListener('click', e => {
    const chip = e.target.closest('.school-chip');
    if (!chip) return;
    e.preventDefault();
    document.getElementById(chip.dataset.target).scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  searchEl.addEventListener('input', render);
  document.querySelectorAll('.level-btn').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.level-btn').forEach(b => b.classList.toggle('active', b === btn));
    level = btn.dataset.level;
    render();
  }));

  // ---------- other fees ----------
  function renderFees() {
    const sum = (rows, key) => rows.reduce((t, r) => t + r[key], 0);

    const admissionRows = data.admissionFees.map(f => `
      <tr><td>${escapeHtml(f.item)}</td><td>${kwacha(f.ug)}</td><td>${kwacha(f.pg)}</td></tr>`).join('');
    const annualRows = data.annualFees.map(f => `
      <tr><td>${escapeHtml(f.item)}</td><td>${kwacha(f.amount)}</td></tr>`).join('');
    const laterRows = data.laterFees.map(f => `
      <tr><td>${escapeHtml(f.item)}</td><td>${kwacha(f.amount)}</td></tr>`).join('');

    document.getElementById('fee-grid').innerHTML = `
      <div class="fee-card">
        <h3>At admission <span class="fee-tag">once off</span></h3>
        <table class="fee-table">
          <thead><tr><th>Item</th><th>Undergrad</th><th>Postgrad</th></tr></thead>
          <tbody>${admissionRows}</tbody>
          <tfoot><tr><td>Total</td><td>${kwacha(sum(data.admissionFees, 'ug'))}</td><td>${kwacha(sum(data.admissionFees, 'pg'))}</td></tr></tfoot>
        </table>
      </div>
      <div class="fee-card">
        <h3>Annual fees <span class="fee-tag">every year</span></h3>
        <table class="fee-table">
          <tbody>${annualRows}</tbody>
          <tfoot><tr><td>Total per year</td><td>${kwacha(sum(data.annualFees, 'amount'))}</td></tr></tfoot>
        </table>
      </div>
      <div class="fee-card">
        <h3>Later in the course <span class="fee-tag">once off</span></h3>
        <table class="fee-table">
          <tbody>${laterRows}</tbody>
        </table>
        <p class="fee-note">The caution deposit is refunded at the end of the course.</p>
      </div>`;

    const p = data.payment;
    document.getElementById('pay-box').innerHTML = `
      <div>
        <h3>How to pay</h3>
        <dl class="pay-list">
          <dt>Bank</dt><dd>${escapeHtml(p.bank)}</dd>
          <dt>Account name</dt><dd>${escapeHtml(p.accountName)}</dd>
          <dt>Account no.</dt><dd class="mono">${escapeHtml(p.accountNo)}</dd>
          <dt>Swift code</dt><dd class="mono">${escapeHtml(p.swift)}</dd>
        </dl>
      </div>
      <div>
        <h3>Admissions enquiries</h3>
        <p>${data.contact.phones.map(escapeHtml).join('<br>')}</p>
        <p>${data.contact.emails.map(e => `<a href="mailto:${escapeHtml(e)}">${escapeHtml(e)}</a>`).join('<br>')}</p>
      </div>
      <p class="fee-source">${escapeHtml(data.sourceNote)} Fees may change — confirm with the admissions office before paying.</p>`;
  }

  render();
  renderFees();
});
