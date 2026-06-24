import type { ProductionAccessRole, ProductionEmployee } from "../types";

export const accessRoleLabels: Record<ProductionAccessRole, string> = {
  none: "Без доступа",
  leader: "Руководитель",
  technologist: "Сметчик / технолог",
  manager: "Менеджер",
  shopChief: "Начальник цеха",
  installationChief: "Начальник монтажей",
  maker: "Макетчик",
};

export function accessRoleFor(employee?: ProductionEmployee): ProductionAccessRole {
  return employee?.accessRole || "none";
}

export function canAccessCosting(employee?: ProductionEmployee) {
  const role = accessRoleFor(employee);
  return role === "leader" || role === "technologist";
}

export function canAccessProduction(employee?: ProductionEmployee) {
  const role = accessRoleFor(employee);
  return role === "leader" || role === "shopChief" || role === "maker";
}

export function canAssignProduction(employee?: ProductionEmployee) {
  const role = accessRoleFor(employee);
  return role === "leader" || role === "shopChief";
}

export function canManageEmployees(employee?: ProductionEmployee) {
  const role = accessRoleFor(employee);
  return role === "leader";
}

export function canCreateAccessRole(
  currentEmployee: ProductionEmployee | undefined,
  targetRole: ProductionAccessRole,
) {
  const currentRole = accessRoleFor(currentEmployee);
  if (currentRole === "leader") return true;
  if (currentRole === "shopChief") return targetRole === "maker" || targetRole === "none";
  if (currentRole === "installationChief") return targetRole === "maker" || targetRole === "none";
  return false;
}

export function isProductionWorker(employee?: ProductionEmployee) {
  return accessRoleFor(employee) === "maker";
}

export function employeeLoginCandidates(employee: ProductionEmployee) {
  return [employee.login, employee.phone, employee.name, employee.id]
    .map((value) => normalizedLogin(value))
    .filter(Boolean);
}

export function matchesEmployeeLogin(employee: ProductionEmployee, login: string) {
  const normalized = normalizedLogin(login);
  if (!normalized) return false;
  return employeeLoginCandidates(employee).includes(normalized);
}

export function normalizedLogin(value?: string) {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/[()+\-\s]/g, "");
}

export async function pinHashForEmployee(employeeId: string, pin: string) {
  const normalizedPin = pin.trim();
  const payload = `${employeeId}:${normalizedPin}`;

  if (crypto?.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  return fallbackHash(payload);
}

export async function verifyEmployeePin(employee: ProductionEmployee, pin: string) {
  if (employee.active === false || accessRoleFor(employee) === "none" || !employee.pinHash) {
    return false;
  }
  return employee.pinHash === (await pinHashForEmployee(employee.id, pin));
}

function fallbackHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv:${(hash >>> 0).toString(16)}`;
}
