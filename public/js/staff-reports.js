// Staff dashboard → Reports: fee collections, outstanding balances, programme summary, billing summary.
// Each report can be downloaded as CSV (opens in Excel) or printed / saved as PDF.
document.addEventListener('staff:loaded', async () => {
  if (!document.getElementById('tab-reports')) return;
  const S = window.Staff;
  const esc = S.escapeHtml;
  const K = n => S.kwacha(n);
  let data = { schools: [] };
  try { data = await S.programmes(); } catch (e) { /* ignore */ }
  let current = null; // last generated report { type, title, columns, rows, ... }

  const $ = id => document.getElementById(id);
  const reportType = () => document.querySelector('input[name="report"]:checked').value;

  // ---------- filters ----------
  $('rp-school').innerHTML = '<option value="">All schools</option>' +
    data.schools.map(s => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('');
  function fillProgrammes() {
    const list = data.schools.filter(s => !$('rp-school').value || s.name === $('rp-school').value).flatMap(s => s.programmes);
    $('rp-programme').innerHTML = '<option value="">All programmes</option>' +
      list.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
  }
  fillProgrammes();
  $('rp-school').addEventListener('change', fillProgrammes);

  const iso = d => new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  function setRange(range) {
    const now = new Date();
    let from = '', to = iso(now);
    if (range === 'month') from = iso(new Date(now.getFullYear(), now.getMonth(), 1));
    if (range === 'last-month') {
      from = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      to = iso(new Date(now.getFullYear(), now.getMonth(), 0));
    }
    if (range === 'year') from = iso(new Date(now.getFullYear(), 0, 1));
    if (range === 'all') { from = ''; to = ''; }
    $('rp-from').value = from;
    $('rp-to').value = to;
  }
  setRange('month');
  document.querySelectorAll('.chip-btn[data-range]').forEach(b => b.addEventListener('click', () => setRange(b.dataset.range)));

  // "Outstanding" is a snapshot as at a date, not a period
  function updateFilterLabels() {
    const outstanding = reportType() === 'outstanding';
    $('rp-from-field').hidden = outstanding;
    $('rp-to-label').textContent = outstanding ? 'Balances as at' : 'To';
  }
  document.querySelectorAll('input[name="report"]').forEach(r => r.addEventListener('change', () => {
    updateFilterLabels();
    $('rp-output').hidden = true;
  }));
  updateFilterLabels();

  // ---------- report definitions ----------
  const TITLES = {
    collections: 'Fee Collections Report',
    outstanding: 'Outstanding Balances Report',
    'by-programme': 'Fees Summary by Programme',
    billing: 'Billing Summary'
  };

  const COLUMNS = {
    collections: [
      ['date', 'Date'], ['student_id', 'Student ID'], ['student', 'Student'], ['programme', 'Programme'],
      ['reference', 'Reference'], ['method', 'Method'], ['amount', 'Amount', 'money'], ['recorded_by', 'Recorded by']
    ],
    outstanding: [
      ['student_id', 'Student ID'], ['student', 'Student'], ['programme', 'Programme'],
      ['billed', 'Billed', 'money'], ['paid', 'Paid', 'money'], ['balance', 'Balance', 'money'], ['last_payment', 'Last payment']
    ],
    'by-programme': [
      ['school', 'School'], ['programme', 'Programme'], ['students', 'Students', 'num'],
      ['billed', 'Billed', 'money'], ['paid', 'Collected', 'money'], ['outstanding', 'Outstanding', 'money'], ['collected_pct', '% collected', 'pct']
    ],
    billing: [
      ['description', 'Charge'], ['students', 'Students', 'num'], ['charges', 'Entries', 'num'],
      ['total', 'Total billed', 'money'], ['first_date', 'First billed']
    ]
  };

  const fmt = (v, kind) => {
    if (v === null || v === undefined || v === '') return '–';
    if (kind === 'money') return K(v);
    if (kind === 'pct') return `${v}%`;
    if (kind === 'num') return Number(v).toLocaleString('en-US');
    return esc(v);
  };

  function periodText(meta) {
    const d = v => v ? new Date(v + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    if (meta.type === 'outstanding') return `As at ${meta.to ? d(meta.to) : 'today'}`;
    if (meta.from && meta.to) return `${d(meta.from)} – ${d(meta.to)}`;
    if (meta.from) return `From ${d(meta.from)}`;
    if (meta.to) return `Up to ${d(meta.to)}`;
    return 'All time';
  }

  function summaryCards(type, s) {
    const card = (label, value, tone = '') => `<div class="stat-card ${tone}"><span class="stat-label">${label}</span><span class="stat-value">${value}</span></div>`;
    if (type === 'collections') return card('Total collected', K(s.total), 'tone-ok') + card('Payments', s.payments) + card('Students who paid', s.students);
    if (type === 'outstanding') return card('Total outstanding', K(s.total_outstanding), s.total_outstanding ? 'tone-warn' : '') + card('Students owing', s.students_owing) + card('Students checked', s.students_checked);
    if (type === 'by-programme') return card('Billed', K(s.billed)) + card('Collected', K(s.paid), 'tone-ok') + card('Outstanding', K(s.outstanding), s.outstanding > 0 ? 'tone-warn' : '') + card('Collected', s.collected_pct === null ? '–' : `${s.collected_pct}%`);
    if (type === 'billing') return card('Total billed', K(s.total_billed)) + card('Charge types', s.items);
    return '';
  }

  function totalsRow(type, r) {
    const cols = COLUMNS[type];
    const sum = key => r.rows.reduce((t, x) => t + (Number(x[key]) || 0), 0);
    const cells = cols.map(([key, , kind], i) => {
      if (i === 0) return '<td><strong>Total</strong></td>';
      if (kind === 'money' || (kind === 'num' && key !== 'charges')) return `<td class="num"><strong>${fmt(sum(key), kind)}</strong></td>`;
      if (kind === 'num') return `<td class="num"><strong>${fmt(sum(key), kind)}</strong></td>`;
      if (kind === 'pct' && r.summary.collected_pct !== undefined) return `<td class="num"><strong>${fmt(r.summary.collected_pct, 'pct')}</strong></td>`;
      return '<td></td>';
    });
    return `<tr>${cells.join('')}</tr>`;
  }

  // ---------- generate ----------
  $('rp-form').addEventListener('submit', async e => {
    e.preventDefault();
    S.hush('rp-message');
    const type = reportType();
    const params = new URLSearchParams();
    if (type !== 'outstanding' && $('rp-from').value) params.set('from', $('rp-from').value);
    if ($('rp-to').value) params.set('to', $('rp-to').value);
    if ($('rp-school').value) params.set('school', $('rp-school').value);
    if ($('rp-programme').value) params.set('programme', $('rp-programme').value);

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true; btn.classList.add('loading');
    try {
      const r = await S.api(`/api/fees/reports/${type}?${params}`);
      const cols = COLUMNS[type];
      const scope = [r.meta.school, r.meta.programme].filter(Boolean).join(' · ') || 'All schools and programmes';
      current = { type, title: TITLES[type], period: periodText(r.meta), scope, meta: r.meta, cols, rows: r.rows };

      $('rp-title').textContent = TITLES[type];
      $('rp-meta').textContent = `${current.period} · ${scope}`;
      $('rp-summary').innerHTML = summaryCards(type, r.summary);

      // Collections: extra breakdown by payment method
      $('rp-extra').innerHTML = type === 'collections' && r.by_method.length ? `
        <h4>By payment method</h4>
        <table class="data-table compact-table method-table">
          <tbody>${r.by_method.map(m => `<tr><td>${esc(m.method)}</td><td class="num">${K(m.amount)}</td><td class="num muted">${r.summary.total ? Math.round(m.amount / r.summary.total * 100) : 0}%</td></tr>`).join('')}</tbody>
        </table>
        <h4>All payments</h4>` : '';

      $('rp-table').querySelector('thead').innerHTML =
        `<tr>${cols.map(([, label, kind]) => `<th class="${kind ? 'num' : ''}">${label}</th>`).join('')}</tr>`;
      $('rp-table').querySelector('tbody').innerHTML = r.rows.map(row =>
        `<tr>${cols.map(([key, , kind]) => `<td class="${kind ? 'num' : ''}${key === 'balance' ? ' owing' : ''}">${fmt(row[key], kind)}</td>`).join('')}</tr>`
      ).join('');
      $('rp-table').querySelector('tfoot').innerHTML = r.rows.length ? totalsRow(type, r) : '';
      $('rp-empty').hidden = r.rows.length > 0;

      const when = new Date(r.meta.generated_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
      $('rp-foot').textContent = `Generated by ${r.meta.generated_by || 'staff'} on ${when}. Amounts in Zambian Kwacha (ZMW).`;
      $('rp-output').hidden = false;
      $('rp-output').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      S.say('rp-message', err.message, 'error');
    } finally {
      btn.disabled = false; btn.classList.remove('loading');
    }
  });

  // ---------- CSV ----------
  $('rp-csv').addEventListener('click', () => {
    if (!current) return;
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      q('DMI St. Eugene University — Chipata Campus'),
      q(current.title),
      q(`${current.period} · ${current.scope}`),
      '',
      current.cols.map(([, label]) => q(label)).join(',')
    ];
    current.rows.forEach(row => lines.push(current.cols.map(([key]) => q(row[key])).join(',')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `${current.title} ${stamp}.csv`.replace(/[\\/:*?"<>|]/g, '-');
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // ---------- print / PDF ----------
  $('rp-print').addEventListener('click', () => {
    document.body.classList.add('printing-report');
    window.print();
  });
  window.addEventListener('afterprint', () => document.body.classList.remove('printing-report'));
});
