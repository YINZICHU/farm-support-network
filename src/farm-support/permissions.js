export function grantCapabilities(grant = {}) {
  const writable = ['admin', 'coordinator'].includes(grant.role);
  return { projectAdmin: grant.role === 'admin' && grant.projectAdmin === true,
    canCreateVillages: writable && grant.canCreateVillages === true,
    managedVillages: writable && Array.isArray(grant.managedVillages) ? grant.managedVillages.filter(id => grant.villages?.includes(id)) : [],
    version: Number.isSafeInteger(grant.version) && grant.version > 0 ? grant.version : 1 };
}
export function requiresManagementMfa(grant = {}) {
  const c = grantCapabilities(grant);
  return grant.role === 'admin' || c.projectAdmin || c.canCreateVillages || c.managedVillages.length > 0;
}
export function mayManageVillage(grant, id) {
  const c = grantCapabilities(grant);
  return grant.villages?.includes(id) && (c.projectAdmin || c.managedVillages.includes(id));
}
export function applyPermissionBoundary(grant, boundary) {
  const current = grantCapabilities(grant);
  // A later, explicitly authorized grant incorporates this historical ceiling.
  // A failed commit or old backup still has the earlier version and is bounded.
  if (current.version >= boundary.version) return false;
  grant.projectAdmin = current.projectAdmin && boundary.projectAdmin === true;
  grant.canCreateVillages = current.canCreateVillages && boundary.canCreateVillages === true;
  grant.villages = (grant.villages || []).filter(id => boundary.villages.includes(id));
  grant.managedVillages = current.managedVillages.filter(id => boundary.managedVillages.includes(id) && grant.villages.includes(id));
  grant.version = Math.max(current.version, boundary.version);
  return true;
}
