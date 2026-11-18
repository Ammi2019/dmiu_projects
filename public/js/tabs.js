const tabs = document.querySelectorAll('.tab');
const contents = document.querySelectorAll('.tab-content');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    contents.forEach(c => c.classList.remove('active'));

    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');

    // Remember each tab in the browser history, so Back returns to the previous tab
    const hash = '#' + tab.dataset.tab;
    if (window.location.hash !== hash) history.pushState({ tab: tab.dataset.tab }, '', hash);
  });
});

// Open the tab named in the address (e.g. /#programmes) on load, and whenever the hash changes
function openTabFromHash() {
  const id = decodeURIComponent(window.location.hash.slice(1));
  const tab = id && document.querySelector(`.tab[data-tab="${CSS.escape(id)}"]`);
  if (tab) {
    tab.click();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
openTabFromHash();
window.addEventListener('hashchange', openTabFromHash);
// Back / Forward: open the tab for that history entry (the first tab when the entry has no tab)
window.addEventListener('popstate', () => {
  if (window.location.hash) return openTabFromHash();
  const first = document.querySelector('.tab');
  if (!first) return;
  tabs.forEach(t => t.classList.remove('active'));
  contents.forEach(c => c.classList.remove('active'));
  first.classList.add('active');
  const panel = document.getElementById(first.dataset.tab);
  if (panel) panel.classList.add('active');
});
