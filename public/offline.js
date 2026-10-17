// External so the deployed Content Security Policy (no inline scripts) allows it.
(() => {
  try {
    const light = localStorage.getItem('wehouse:appearance') === 'light';
    document.documentElement.dataset.whTheme = light ? 'light' : 'dark';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#F7F8FB' : '#090B10');
  } catch (_) {
    document.documentElement.dataset.whTheme = 'dark';
  }
  const reload = () => location.reload();
  window.addEventListener('online', reload);
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('retry')?.addEventListener('click', reload);
  });
})();
