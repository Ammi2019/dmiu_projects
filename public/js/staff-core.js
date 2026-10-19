// Staff dashboard core: role-based tabs, identity banner, shared helpers (window.Staff).
// Runs before tabs.js so tabs this role can't use are removed before tab switching is wired up.
(function () {
  const role = localStorage.getItem('role');
  const token = localStorage.getItem('token');
  const authHeaders = { 'Authorization': `Bearer ${token}` };

  // ---------- remove tabs + sections this role doesn't get ----------
  document.querySelectorAll('.tab[data-roles]').forEach(tab => {
    const allowed = tab.dataset.roles === '*' || tab.dataset.roles.split(',').includes(role);
    if (!allowed) {
      const section = document.getElementById(tab.dataset.tab);
      if (section) section.remove();
      tab.remove();
    }
  });

  // ---------- shared helpers ----------
  const escapeHtml = v => String(v ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));

  async function api(url, options = {}) {
    const res = await fetch(url, { ...options, headers: { ...authHeaders, ...(options.headers || {}) } });
    if (res.status === 401 || (res.status === 403 && (await res.clone().text()).includes('token'))) {
      localStorage.clear();
      window.location.href = '/login.html?portal=staff';
      throw new Error('Your session has expired. Please log in again.');
    }
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    const body = isJson ? await res.json() : await res.text();
    if (!res.ok) throw new Error(typeof body === 'string' ? body : (body.message || 'Request failed.'));
    return body;
  }

  async function download(url, fallbackName, inline = false) {
    const res = await fetch(url, { headers: authHeaders });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    if (inline) { window.open(href, '_blank'); return; }
    const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get('content-disposition') || '');
    const a = document.createElement('a');
    a.href = href;
    a.download = m ? decodeURIComponent(m[1]) : fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60000);
  }

  function say(id, text, type) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = `message show ${type}`;
  }
  const hush = id => { const el = document.getElementById(id); if (el) el.className = 'message'; };

  // Whole kwacha show no decimals (K2,500); anything with ngwee shows two (K4,750.50)
  const kwacha = n => {
    const v = Number(n || 0);
    const d = Number.isInteger(Math.round(v * 100) / 100) ? 0 : 2;
    return 'K' + v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: 2 });
  };

  const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // Switch to a tab from anywhere (e.g. clicking an overview card)
  function openTab(id) {
    const tab = document.querySelector(`.tab[data-tab="${id}"]`);
    if (tab) { tab.click(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  }

  let programmesCache = null;
  async function programmes() {
    if (!programmesCache) programmesCache = await api('/api/programmes');
    return programmesCache;
  }

  window.Staff = { role, api, download, say, hush, escapeHtml, kwacha, debounce, openTab, programmes, me: null };

  // ---------- identity banner ----------
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const me = await api('/api/staff/me');
      window.Staff.me = me;
      document.getElementById('banner-name').textContent = me.name;
      document.getElementById('banner-role').textContent = me.role_label;
      document.getElementById('banner-school').textContent =
        me.school_scoped ? (me.school || 'School not assigned yet') : 'DMISEU Chipata Campus';
      document.getElementById('dash-title').textContent = `${me.role_label} Dashboard`;
      document.title = `${me.role_label} Dashboard — DMISEU Chipata Campus`;

      // Banner photo (same photo as the Profile tab)
      fetch('/api/profile/photo', { headers: authHeaders }).then(async r => {
        if (r.ok) document.getElementById('banner-photo').src = URL.createObjectURL(await r.blob());
      }).catch(() => {});

      document.dispatchEvent(new CustomEvent('staff:loaded', { detail: me }));
    } catch (err) {
      document.getElementById('banner-name').textContent = 'Could not load your account';
    }
  });
})();
