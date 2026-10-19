// Home tab: fills facts + school cards from /api/programmes, counts numbers up, reveals sections on scroll.
document.addEventListener('DOMContentLoaded', async () => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  const SCHOOL_STYLE = {
    computing: { icon: '💻', tone: 'blue' },
    business: { icon: '📈', tone: 'amber' },
    social: { icon: '🤝', tone: 'rose' },
    education: { icon: '🎓', tone: 'green' },
    nutrition: { icon: '🥗', tone: 'teal' }
  };

  // ---------- facts + schools from the real programme list ----------
  try {
    const res = await fetch('/api/programmes');
    if (res.ok) {
      const data = await res.json();
      const all = data.schools.flatMap(s => s.programmes);
      const stats = document.querySelectorAll('#home-stats [data-count]');
      stats[0].dataset.count = data.schools.length;
      stats[1].dataset.count = all.length;
      const minFee = Math.min(...all.map(p => p.fee));
      document.getElementById('home-fee-from').textContent = 'K' + minFee.toLocaleString('en-US');

      document.getElementById('home-schools').innerHTML = data.schools.map(s => {
        const st = SCHOOL_STYLE[s.id] || { icon: '🏫', tone: 'blue' };
        const dip = s.programmes.filter(p => p.level === 'Diploma').length;
        const bac = s.programmes.length - dip;
        const parts = [bac && `${bac} Bachelor's`, dip && `${dip} Diploma`].filter(Boolean).join(' · ');
        return `
          <button type="button" class="school-card tone-${st.tone}" data-school="${esc(s.id)}">
            <span class="school-icon" aria-hidden="true">${st.icon}</span>
            <strong>${esc(s.name.replace(/^School of /, ''))}</strong>
            <small>${esc(s.blurb || '')}</small>
            <span class="school-count-pill">${parts}</span>
          </button>`;
      }).join('');
    }
  } catch (e) { /* keep the defaults written in the page */ }

  // Clicking a school opens the Programmes tab at that school
  document.getElementById('home-schools').addEventListener('click', e => {
    const card = e.target.closest('[data-school]');
    if (!card) return;
    document.querySelector('.tab[data-tab="programmes"]').click();
    const target = () => document.getElementById(`school-${card.dataset.school}`);
    let tries = 0;
    const go = () => {
      if (target()) target().scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      else if (tries++ < 20) setTimeout(go, 100);
    };
    go();
  });

  // ---------- count-up numbers ----------
  function countUp(el) {
    const end = Number(el.dataset.count);
    if (!end || reduceMotion) { if (end) el.textContent = end; return; }
    const start = performance.now(), dur = 900;
    const step = now => {
      const t = Math.min((now - start) / dur, 1);
      el.textContent = Math.round(end * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------- reveal sections as they scroll into view ----------
  const reveals = document.querySelectorAll('.home-tab .reveal');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    reveals.forEach(el => el.classList.add('in'));
    document.querySelectorAll('#home-stats [data-count]').forEach(countUp);
    return;
  }
  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('in');
      if (entry.target.id === 'home-stats') entry.target.querySelectorAll('[data-count]').forEach(countUp);
      io.unobserve(entry.target);
    });
  }, { threshold: 0.15 });
  reveals.forEach(el => io.observe(el));
});
