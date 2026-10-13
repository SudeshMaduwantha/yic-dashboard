// Runs in <head> before the stylesheet paints, so a saved dark theme doesn't flash light first.
try {
  if (localStorage.getItem('yic-theme') === 'dark') document.documentElement.dataset.theme = 'dark';
} catch (e) { /* storage blocked — default light theme */ }
