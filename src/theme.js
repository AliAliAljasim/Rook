// Runs in <head>, before anything is drawn: applies the saved theme so the page never flashes the other one.
document.documentElement.dataset.theme = (window.api && window.api.initial && window.api.initial.theme) || 'dark';
// Motion is decided here too, so the startup animation is not cut short by a late switch.
(function () {
  const m = (window.api && window.api.initial && window.api.initial.motion) || 'on';
  const reduce = m === 'off' || (m === 'system' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  document.documentElement.dataset.motion = reduce ? 'reduce' : 'full';
})();
