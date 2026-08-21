function cleanOrganizationLayout() {
  document.querySelectorAll('.topbar-actions [data-organization-open]').forEach((node) => node.remove());
  document.querySelectorAll('.organization-indent[style]').forEach((node) => node.removeAttribute('style'));
}

cleanOrganizationLayout();
new MutationObserver(cleanOrganizationLayout).observe(document.body, { childList: true, subtree: true });
