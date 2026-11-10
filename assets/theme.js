// Startup has already resolved the first paint. No second media/storage owner.
const colorMode = window.fastNewsColorMode;
const button = document.getElementById('themeToggle');
function applyTheme() {
  const dark = colorMode.resolved === 'dark';
  if (!button) return;
  button.querySelector('.theme-sun').hidden = dark;
  button.querySelector('.theme-moon').hidden = !dark;
  button.title = dark ? '切换浅色模式' : '切换深色模式';
  button.setAttribute('aria-label', button.title);
}
applyTheme();
colorMode.subscribe(applyTheme);
button?.addEventListener('click', () => colorMode.setMode(colorMode.resolved === 'dark' ? 'light' : 'dark'));
