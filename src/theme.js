// Runs in <head>, before anything is drawn: applies the saved theme so the page never flashes the other one.
document.documentElement.dataset.theme = (window.api && window.api.initial && window.api.initial.theme) || 'dark';
