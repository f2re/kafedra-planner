export function setTextIfChanged(node, value) {
  if (!node) return false;
  const next = String(value ?? '');
  if (String(node.textContent ?? '') === next) return false;
  node.textContent = next;
  return true;
}

export function periodicPanelKey(task) {
  if (!task?.id || !task?.status) return '';
  return `${task.id}:${task.status}`;
}
