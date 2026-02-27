export function isAdmin(profile) {
  return profile?.role === "admin";
}

export function isHelper(profile) {
  return profile?.role === "helper";
}
