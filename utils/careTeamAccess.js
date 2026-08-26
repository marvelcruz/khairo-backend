const idOf = (value) => {
  if (!value) return "";
  return String(value._id || value.id || value);
};

export const rolesFor = (user) =>
  Array.isArray(user?.roles)
    ? user.roles
    : user?.role
      ? [user.role]
      : [];

export const isAdmin = (user) => rolesFor(user).includes("admin");

export function canAccessClient(
  user,
  client,
  { allowStaff = true, allowSales = false } = {}
) {
  if (!user || !client) return false;
  const roles = rolesFor(user);
  const userId = idOf(user);

  if (roles.includes("admin")) return true;
  if (allowStaff && roles.includes("staff")) return true;
  if (allowSales && roles.includes("sales")) return true;

  if (
    roles.includes("coach") &&
    idOf(client.assignedCoach) === userId
  ) return true;

  if (
    roles.includes("doctor") &&
    idOf(client.assignedDoctor) === userId
  ) return true;

  return false;
}

export function clientScopeForUser(
  user,
  { allowStaff = true, allowSales = false } = {}
) {
  const roles = rolesFor(user);
  const userId = idOf(user);

  if (roles.includes("admin")) return {};
  if (allowStaff && roles.includes("staff")) return {};
  if (allowSales && roles.includes("sales")) return {};

  const assignmentFilters = [];
  if (roles.includes("coach")) assignmentFilters.push({ assignedCoach: userId });
  if (roles.includes("doctor")) assignmentFilters.push({ assignedDoctor: userId });

  if (assignmentFilters.length === 1) return assignmentFilters[0];
  if (assignmentFilters.length > 1) return { $or: assignmentFilters };

  return { _id: null };
}
