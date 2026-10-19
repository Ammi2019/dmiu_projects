const tabs = document.querySelectorAll('.tab');
const contents = document.querySelectorAll('.tab-content');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    contents.forEach(c => c.classList.remove('active'));

    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
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
