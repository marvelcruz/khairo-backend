export const STAFF_PROFILE = "staff";
export const DOCTOR_PROFILE = "doctor";

// These older Khairo Diet Clinic roles remain readable during migration so existing
// accounts do not lose access. New and edited accounts use only staff/doctor.
export const LEGACY_STAFF_ROLES = ["admin", "coach", "sales"];
export const VISIBLE_ROLE_PROFILES = [STAFF_PROFILE, DOCTOR_PROFILE];

export function normalizedProfile(roles = []) {
  const values = Array.isArray(roles) ? roles : [];
  const hasStaffRole = values.some((role) =>
    [STAFF_PROFILE, ...LEGACY_STAFF_ROLES].includes(role)
  );

  if (!hasStaffRole && values.includes(DOCTOR_PROFILE)) {
    return DOCTOR_PROFILE;
  }

  return STAFF_PROFILE;
}

export function hasStaffAccess(roles = []) {
  return normalizedProfile(roles) === STAFF_PROFILE;
}

export function hasDoctorAccess(roles = []) {
  return normalizedProfile(roles) === DOCTOR_PROFILE;
}

export function allowedProfilesFromRouteRoles(allowedRoles = []) {
  const allowed = new Set();

  if (
    allowedRoles.some((role) =>
      [STAFF_PROFILE, ...LEGACY_STAFF_ROLES].includes(role)
    )
  ) {
    allowed.add(STAFF_PROFILE);
  }

  if (allowedRoles.includes(DOCTOR_PROFILE)) {
    allowed.add(DOCTOR_PROFILE);
  }

  return allowed;
}
