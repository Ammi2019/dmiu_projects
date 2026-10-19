// Student dashboard → Results tab: published marks per course, CA, exam, total and grade.
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('token');

  const escapeHtml = v => String(v ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
  const fmt = n => (Math.round(n * 10) / 10).toString();

  function courseCard(course, config) {
    const r = course.result;
    const rows = config.components.map(c => {
      const released = course.published.includes(c.key);
      const mark = course.marks[c.key];
      let markCell = '<span class="muted">Not yet released</span>';
      let weighted = '–';
      if (released && mark !== undefined) {
        markCell = `<strong>${fmt(mark)}</strong><span class="muted"> / 100</span>`;
        weighted = `${fmt((mark * c.weight) / 100)} / ${c.weight}`;
      } else if (released) {
        markCell = '<span class="muted">No mark recorded</span>';
      }
      return `
        <tr>
          <td>${escapeHtml(c.label)}${c.ca ? '' : ' <span class="exam-tag">Exam</span>'}</td>
          <td class="num">${markCell}</td>
          <td class="num">${weighted}</td>
        </tr>`;
    }).join('');

    const summary = r.complete
      ? `
        <div class="sr-final ${r.passed ? 'pass' : 'fail'}">
          <div><span class="sr-final-label">Final</span><span class="sr-final-total">${fmt(r.total)}%</span></div>
          <div class="sr-grade">${escapeHtml(r.grade)}</div>
          <div class="sr-remark">${escapeHtml(r.remark)}</div>
        </div>`
      : `<p class="sr-pending">Final grade will show once all four parts have been released.</p>`;

    return `
      <article class="sr-card">
        <header class="sr-head">
          <div>
            <p class="sa-course">${escapeHtml(course.period)}</p>
            <h3>${escapeHtml(course.course_name)}</h3>
            <p class="sa-meta">Lecturer: ${escapeHtml(course.lecturer_name)}</p>
          </div>
          ${summary}
        </header>
        <table class="data-table sr-table">
          <thead><tr><th>Assessment</th><th class="num">Mark</th><th class="num">Counts for</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr><td>Continuous assessment (CA)</td><td></td><td class="num"><strong>${fmt(r.ca)} / ${r.caMax}</strong></td></tr>
            <tr><td>Exam</td><td></td><td class="num"><strong>${fmt(r.exam)} / ${r.examMax}</strong></td></tr>
          </tfoot>
        </table>
      </article>`;
  }

  (async function load() {
    try {
      const res = await fetch('/api/results/mine', { headers: { 'Authorization': `Bearer ${token}` } });
      if (!res.ok) throw new Error(await res.text());
      const { config, courses } = await res.json();

      const ca = config.components.filter(c => c.ca);
      document.getElementById('sr-weights').textContent =
        `Your final mark = CA ${ca.reduce((t, c) => t + c.weight, 0)}% (` +
        ca.map(c => `${c.label} ${c.weight}%`).join(', ') + ') + ' +
        config.components.filter(c => !c.ca).map(c => `${c.label} ${c.weight}%`).join(', ') +
        `. Pass mark: ${config.passMark}%.`;

      document.getElementById('sr-empty').hidden = courses.length > 0;
      document.getElementById('sr-list').innerHTML = courses.map(c => courseCard(c, config)).join('');
    } catch (err) {
      const el = document.getElementById('sr-message');
      el.textContent = err.message || 'Could not load results.';
      el.className = 'message show error';
    }
  })();
});
