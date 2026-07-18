let current = null; // { role: 'super_admin'|'administrator'|'coach', sport: string|null, email }

export function setCurrentRole(role) { current = role; }
export function getCurrentRole() { return current; }
export function isSuperAdmin() { return !!current && current.role === 'super_admin'; }
export function isAdministrator() { return !!current && current.role === 'administrator'; }
export function isCoach() { return !!current && current.role === 'coach'; }
