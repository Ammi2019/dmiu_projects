// Redirects away if the visitor doesn't have one of the allowed roles.
// Also injects a persistent top ribbon showing the logged-in user's name.
// Usage: <script src="/js/guard.js" data-allow="administrator"></script>
(function () {
  const scriptTag = document.currentScript;
  const allowed = (scriptTag.dataset.allow || '').split(',').map(r => r.trim());

  const token = localStorage.getItem('token');
  const role = localStorage.getItem('role');
  const name = localStorage.getItem('name');

  if (!token || !allowed.includes(role)) {
    window.location.href = '/login.html';
    return;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const ribbon = document.createElement('div');
    ribbon.className = 'user-ribbon';
    ribbon.innerHTML = `
      <span class="user-ribbon-welcome">Welcome, <strong>${name || 'User'}</strong></span>
      <button type="button" id="ribbon-logout-btn" class="user-ribbon-logout">Log Out</button>
    `;
    document.body.insertBefore(ribbon, document.body.firstChild);

    document.getElementById('ribbon-logout-btn').addEventListener('click', () => {
      localStorage.clear();
      window.location.href = '/login.html';
    });

    // Support pages that still have a legacy #welcome-name span
    const legacyNameEl = document.getElementById('welcome-name');
    if (legacyNameEl) legacyNameEl.textContent = name || '';
  });
})();
