// No private view or pending mutation may survive an authentication boundary.
export function workspaceIdentity(actor) { return JSON.stringify([actor.userId, actor.role, [...actor.villages].sort(), actor.version || 1, actor.projectAdmin === true, actor.canCreateVillages === true, [...(actor.managedVillages || [])].sort()]); }
export function clearPrivateWorkspace(setters, retry) {
  for (const field of ['data', 'contact', 'selected', 'dialog', 'printCard']) setters[field](null);
  setters.notice(''); setters.error(''); retry.current = null;
}

export async function loadAuthorizedWorkspace(api, isCurrent) {
  const account = await api('/account/status');
  if (!isCurrent()) return null;
  if (account.status !== 'APPROVED') return { account, workspace: null };
  const workspace = await api('/workspace');
  return isCurrent() ? { account, workspace } : null;
}

// One private reveal at a time. A context change invalidates reads immediately,
// before React commits navigation; even a late failure cannot affect a new view.
export function createPrivateViewController({ api, views, setBusy, onError }) {
  let generation = 0;
  function abandon() { generation++; }
  function clear() {
    abandon();
    views.contact(null); views.printCard(null); setBusy(false);
  }
  return {
    abandon, clear,
    change(setter, value) { clear(); setter(value); },
    async load(kind, path) {
      clear(); const attempt = generation; setBusy(true);
      try {
        const value = await api(path);
        if (attempt !== generation) return;
        views[kind](value); return value;
      } catch (error) {
        if (attempt !== generation) return;
        onError(error); return { error };
      } finally { if (attempt === generation) setBusy(false); }
    },
  };
}
