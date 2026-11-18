// Back + Home bar shown at the top of every page (except the home page itself).
//   Back -> the previous page or dashboard tab; if there is nothing to go back to, the home page.
//   Home -> the public home page.
(function () {
  if (document.querySelector('.page-nav')) return;
  const style = document.createElement('style');
  style.textContent = `
    .page-nav { display: flex; gap: 8px; align-items: center; padding: 8px 16px; background: #e9eef5; border-bottom: 1px solid #d3dbe6; font-family: Arial, sans-serif; }
    .page-nav a, .page-nav button { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 4px; border: 1px solid #b9c6d8;
      background: #fff; color: #004080; font: inherit; font-size: 14px; text-decoration: none; cursor: pointer; }
    .page-nav a:hover, .page-nav button:hover { background: #004080; color: #fff; border-color: #004080; }
    @media print { .page-nav { display: none !important; } }`;
  document.head.appendChild(style);

  const bar = document.createElement('nav');
  bar.className = 'page-nav no-print';
  bar.setAttribute('aria-label', 'Page navigation');
  bar.innerHTML = `
    <button type="button" data-nav="back" title="Go back to the previous page">&larr; Back</button>
    <a href="/" title="Go to the home page">&#8962; Home</a>`;
  bar.querySelector('[data-nav="back"]').addEventListener('click', () => {
    const fromThisSite = document.referrer && new URL(document.referrer).origin === location.origin;
    if (history.length > 1 && (fromThisSite || history.state)) history.back();
    else location.href = '/';
  });

  const header = document.querySelector('.site-header');
  if (header) header.insertAdjacentElement('afterend', bar);
  else document.body.insertAdjacentElement('afterbegin', bar);
})();
