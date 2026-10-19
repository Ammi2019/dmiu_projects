// Notification bell in the top ribbon (students, lecturers, staff).
// Loads after guard.js, which builds the ribbon on DOMContentLoaded.
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('token');
  const ribbon = document.querySelector('.user-ribbon');
  if (!token || !ribbon) return;
  const auth = { 'Authorization': `Bearer ${token}` };
  const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  const ICONS = { assignment: '📝', notes: '📚', results: '📊', fees: '💳', reminder: '⏰', announcement: '📢', account: '👤', exams: '🎫' };

  // ---------- build bell + panel ----------
  const wrap = document.createElement('div');
  wrap.className = 'notif-wrap';
  wrap.innerHTML = `
    <button type="button" class="notif-bell" aria-haspopup="true" aria-expanded="false" aria-label="Notifications">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 16v-5a6 6 0 10-12 0v5l-2 2h16l-2-2zM10 20a2 2 0 004 0" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span class="notif-count" hidden></span>
    </button>
    <div class="notif-panel" role="dialog" aria-label="Notifications" hidden>
      <div class="notif-head">
        <strong>Notifications</strong>
        <button type="button" class="notif-readall">Mark all as read</button>
      </div>
      <ul class="notif-list"></ul>
    </div>`;
  const logout = ribbon.querySelector('.user-ribbon-logout');
  ribbon.insertBefore(wrap, logout);
  const right = document.createElement('div');
  right.className = 'user-ribbon-right';
  ribbon.insertBefore(right, wrap);
  right.appendChild(wrap);
  right.appendChild(logout);

  const bell = wrap.querySelector('.notif-bell');
  const panel = wrap.querySelector('.notif-panel');
  const countEl = wrap.querySelector('.notif-count');
  const list = wrap.querySelector('.notif-list');
  let items = [];

  function timeAgo(iso) {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
    if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} d ago`;
    return new Date(iso).toLocaleDateString();
  }

  function render(unread) {
    countEl.hidden = !unread;
    countEl.textContent = unread > 99 ? '99+' : unread;
    bell.setAttribute('aria-label', unread ? `Notifications, ${unread} unread` : 'Notifications');
    list.innerHTML = items.length ? items.map(n => `
      <li class="notif-item ${n.is_read ? '' : 'unread'}" data-id="${n.notification_id}" data-link="${esc(n.link || '')}" tabindex="0">
        <span class="notif-icon" aria-hidden="true">${ICONS[n.category] || '🔔'}</span>
        <span class="notif-text">
          <strong>${esc(n.title)}</strong>
          ${n.body ? `<span>${esc(n.body)}</span>` : ''}
          <small>${timeAgo(n.created_at)}</small>
        </span>
      </li>`).join('') : '<li class="notif-empty">You\'re all caught up.</li>';
  }

  async function load() {
    try {
      const res = await fetch('/api/notifications', { headers: auth });
      if (!res.ok) return;
      const data = await res.json();
      items = data.notifications;
      render(data.unread);
    } catch (e) { /* offline — try again later */ }
  }

  function toggle(open) {
    panel.hidden = !open;
    bell.setAttribute('aria-expanded', String(open));
  }
  bell.addEventListener('click', e => { e.stopPropagation(); toggle(panel.hidden); });
  document.addEventListener('click', e => { if (!wrap.contains(e.target)) toggle(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') toggle(false); });

  async function openItem(li) {
    const id = li.dataset.id;
    const item = items.find(n => String(n.notification_id) === id);
    if (item && !item.is_read) {
      item.is_read = true;
      fetch(`/api/notifications/${id}/read`, { method: 'PUT', headers: auth }).catch(() => {});
      render(items.filter(n => !n.is_read).length);
    }
    const tab = li.dataset.link && document.querySelector(`.tab[data-tab="${li.dataset.link}"]`);
    if (tab) { tab.click(); toggle(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  }
  list.addEventListener('click', e => { const li = e.target.closest('.notif-item'); if (li) openItem(li); });
  list.addEventListener('keydown', e => { const li = e.target.closest('.notif-item'); if (li && e.key === 'Enter') openItem(li); });

  wrap.querySelector('.notif-readall').addEventListener('click', async () => {
    await fetch('/api/notifications/read-all', { method: 'PUT', headers: auth }).catch(() => {});
    items.forEach(n => { n.is_read = true; });
    render(0);
  });

  load();
  setInterval(load, 60 * 1000);
});
