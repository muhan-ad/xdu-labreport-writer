/* Layout preference only: never saves, clears or reloads measurement forms. */
(() => {
  'use strict';
  const app = document.querySelector('.app');
  const sidebar = document.getElementById('experimentSidebar');
  const button = document.getElementById('btnToggleSidebar');
  if (!app || !sidebar || !button) return;
  const storageKey = 'labreport.sidebarCollapsed';
  const apply = collapsed => {
    if (collapsed && sidebar.contains(document.activeElement)) button.focus();
    app.classList.toggle('sidebar-collapsed', collapsed);
    sidebar.inert = collapsed;
    sidebar.setAttribute('aria-hidden', String(collapsed));
    button.setAttribute('aria-expanded', String(!collapsed));
    const label = collapsed ? '展开实验导航' : '收起实验导航';
    button.setAttribute('aria-label', label);
    button.title = label;
  };
  let saved = false;
  try { saved = localStorage.getItem(storageKey) === 'true'; } catch (_) { /* Storage unavailable. */ }
  apply(saved);
  button.addEventListener('click', () => {
    const collapsed = !app.classList.contains('sidebar-collapsed');
    apply(collapsed);
    try { localStorage.setItem(storageKey, String(collapsed)); } catch (_) { /* Layout still works. */ }
  });
})();
