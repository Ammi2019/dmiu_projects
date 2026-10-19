// Staff dashboard → Fees → Fee reminders: semester calendar, acceptable amount, send now.
document.addEventListener('staff:loaded', () => {
  if (!document.getElementById('fr')) return;
  const S = window.Staff;
  const esc = S.escapeHtml;
  const $ = id => document.getElementById(id);
  let canManage = false;

  const fmtDate = v => new Date(v + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const addDays = (v, n) => { const d = new Date(v + 'T00:00:00'); d.setDate(d.getDate() + n); return d; };

  async function load() {
    try {
      const r = await S.api('/api/fees/reminders');
      canManage = r.can_manage;
      const s = r.settings;
      $('fr-pct').value = s.min_paid_pct;
      $('fr-lead').value = s.lead_days;
      $('fr-enabled').checked = s.enabled;
      ['fr-pct', 'fr-lead', 'fr-enabled'].forEach(id => { $(id).disabled = !canManage; });
      document.querySelectorAll('#fr-settings button, #fr-sem-form').forEach(el => { el.hidden = !canManage; });

      $('fr-count').hidden = !r.below_count;
      $('fr-count').textContent = r.below_count;
      $('fr-status').innerHTML = r.below_count
        ? `<strong>${r.below_count} student${r.below_count === 1 ? ' is' : 's are'}</strong> below the acceptable amount (have paid less than ${s.min_paid_pct}% of their fees). Together they need to pay at least <strong>${S.kwacha(r.below_total_short)}</strong> more to reach it.`
        : `All students have paid at least ${s.min_paid_pct}% of their fees.`;

      const today = new Date(); today.setHours(0, 0, 0, 0);
      $('fr-sem-table').querySelector('tbody').innerHTML = r.semesters.length ? r.semesters.map(m => {
        const endRem = addDays(m.end_date, -s.lead_days), startRem = addDays(m.start_date, -s.lead_days);
        const isNow = new Date(m.start_date + 'T00:00:00') <= today && today <= new Date(m.end_date + 'T00:00:00');
        return `
          <tr>
            <td><strong>${esc(m.name)}</strong>${isNow ? ' <span class="badge badge-ok">Current</span>' : ''}</td>
            <td>${fmtDate(m.start_date)}</td>
            <td>${fmtDate(m.end_date)}</td>
            <td class="wrap"><small>From ${startRem.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} (before it starts) and from ${endRem.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} (before it ends)</small></td>
            <td>${canManage ? `<button type="button" class="icon-btn" data-del="${m.semester_id}" aria-label="Remove ${esc(m.name)}" title="Remove">✕</button>` : ''}</td>
          </tr>`;
      }).join('') : '<tr><td colspan="5" class="muted">No semesters yet. Add the semester dates so reminders can go out automatically.</td></tr>';
    } catch (err) {
      S.say('fr-message', err.message, 'error');
    }
  }

  $('fr-settings').addEventListener('submit', async e => {
    e.preventDefault();
    S.hush('fr-message');
    try {
      S.say('fr-message', await S.api('/api/fees/reminders/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ min_paid_pct: Number($('fr-pct').value), lead_days: Number($('fr-lead').value), enabled: $('fr-enabled').checked })
      }), 'success');
      load();
    } catch (err) {
      S.say('fr-message', err.message, 'error');
    }
  });

  $('fr-send-now').addEventListener('click', async () => {
    S.hush('fr-message');
    if (!confirm('Send a fee reminder now to every student below the acceptable amount?')) return;
    try {
      S.say('fr-message', await S.api('/api/fees/reminders/send-now', { method: 'POST' }), 'success');
    } catch (err) {
      S.say('fr-message', err.message, 'error');
    }
  });

  $('fr-sem-form').addEventListener('submit', async e => {
    e.preventDefault();
    S.hush('fr-message');
    try {
      S.say('fr-message', await S.api('/api/fees/semesters', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: $('fr-sem-name').value.trim(), start_date: $('fr-sem-start').value, end_date: $('fr-sem-end').value })
      }), 'success');
      e.target.reset();
      load();
    } catch (err) {
      S.say('fr-message', err.message, 'error');
    }
  });

  $('fr-sem-table').addEventListener('click', async e => {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    if (!confirm('Remove this semester from the calendar?')) return;
    try {
      S.say('fr-message', await S.api(`/api/fees/semesters/${btn.dataset.del}`, { method: 'DELETE' }), 'success');
      load();
    } catch (err) {
      S.say('fr-message', err.message, 'error');
    }
  });

  load();
});
