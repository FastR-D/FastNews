// This adapter is bundled after the verified foundation ESM by supply_fastui.py.
// The resulting classic script runs before gate.js and before page content.
try {
  if (localStorage.getItem('fastresearch-theme') === null) {
    const old = localStorage.getItem('fastnews.theme');
    if (old === 'light' || old === 'dark') localStorage.setItem('fastresearch-theme', old);
  }
} catch { /* Preference storage is optional. */ }
const colorMode = initColorMode({ storageKey: 'fastresearch-theme' });
colorMode.subscribe(({ resolved }) => {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
});
window.fastNewsColorMode = colorMode;
