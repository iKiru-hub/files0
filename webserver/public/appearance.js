// Apply preferences before first paint. Storage is optional (private browsing).
(() => {
  let theme, font;
  try { theme = localStorage.getItem('files0:theme'); font = Number(localStorage.getItem('files0:font-size')); } catch {}
  document.documentElement.dataset.theme = theme === 'dark' || theme === 'light' ? theme : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  if ([10, 12, 14, 16, 18].includes(font)) document.documentElement.style.setProperty('--note-font-size', `${font}px`);
})();
