import {
  Bell,
  BriefcaseBusiness,
  Camera,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Copy,
  Download,
  KeyRound,
  Link2,
  Images,
  LogOut,
  Moon,
  MoreHorizontal,
  PackageCheck,
  Play,
  Plus,
  Search,
  Send,
  ShieldOff,
  Sun,
  Trash2,
  UserRound,
  UsersRound,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject, TouchEvent } from "react";
import { formatMoney, positionTotal } from "../lib/costing";
import { moveDealToStage, sendProductionPush } from "../lib/saveApi";
import type {
  Deal,
  DealCalculation,
  DealStageCode,
  DealTechSpec,
  CatalogItem,
  CostPosition,
  ProductionAssignment,
  ProductionAssignmentEventType,
  ProductionAssignmentStatus,
  ProductionCompletion,
  ProductionAccessRole,
  ProductionEmployee,
  ProductionEmployeeRole,
  ProductionPhoto,
  ProductionPhotoKind,
  ProductionPushSubscription,
  ProductionRegistrationLink,
  ProductionRegistrationRequest,
  ProductionPayout,
  StoredProduction,
  TechSpecItem,
} from "../types";
import {
  accessRoleFor,
  accessRoleLabels,
  canAccessCosting,
  canAssignProduction,
  canCreateAccessRole,
  canManageEmployees,
  isProductionWorker,
  pinHashForEmployee,
} from "../lib/access";
import { stageCodeForDeal, stageLabels } from "../lib/stages";
import {
  orderedTechSpecFieldIds,
  techSpecFieldLabel,
  techSpecTemplateTitle,
} from "./TechSpecBuilder";

type ProductionView = "supervisor" | "worker";
type SupervisorTab = "active" | "done";
type WorkerTab = "assigned" | "inProgress" | "ready" | "money" | "gallery";
type WorkerDealTab = Extract<WorkerTab, "assigned" | "inProgress" | "ready">;
type ProductionTheme = "day" | "night";
type EmployeeGroupId =
  | "makers"
  | "assemblers"
  | "managers"
  | "technologists"
  | "shopChiefs"
  | "leaders"
  | "noAccess";

type WorkerMoneySummary = {
  balance: number;
  completedCount: number;
  earned: number;
  paid: number;
  planned: number;
};

type ProductionDealOpenTarget = "cost" | "techSpec";

type ProductionCommitOptions = {
  onSaveError?: () => void;
  onSaved?: () => void;
  saveNow?: boolean;
};

type ProductionMobileAppProps = {
  calculations?: Map<string, DealCalculation>;
  catalogItems?: CatalogItem[];
  currentUser: ProductionEmployee;
  deals: Deal[];
  mode?: "production" | "employees";
  saveApiUrl?: string;
  techSpecs: Map<string, DealTechSpec>;
  storedProduction: StoredProduction;
  installAvailable?: boolean;
  onChange: (data: StoredProduction, options?: ProductionCommitOptions) => void;
  onCalculationChange?: (calculation: DealCalculation) => void;
  onDealStageChange?: (dealId: string, stage: DealStageCode) => void;
  onInstallApp?: () => void;
  onLogout?: () => void;
  onOpenDeal?: (dealId: string, target: ProductionDealOpenTarget) => void;
  onRefresh?: () => Promise<void> | void;
};

type EmployeeGroup = {
  id: EmployeeGroupId;
  label: string;
  description: string;
  employees: ProductionEmployee[];
};

const ROLE_STORAGE_KEY = "verkup-production-view";
const EMPLOYEE_STORAGE_KEY = "verkup-production-employee";
const THEME_STORAGE_KEY = "verkup-production-theme";
const ASSIGNMENT_NOTIFICATION_STORAGE_KEY = "verkup-production-notified-assignments";
const ASSIGNMENT_SEEN_STORAGE_KEY = "verkup-production-seen-assignments";
const DEFAULT_PUSH_PUBLIC_KEY =
  "BBu6x_Htq9sij2gtsdAtVA_xlmulyX8ZMjsHRJJAE0QgPnuDx1KL7thxzQeBV9NWIR5YLb1CDEXJiho-tlezVEk";
const PUSH_PUBLIC_KEY = (import.meta.env.VITE_PUSH_PUBLIC_KEY || DEFAULT_PUSH_PUBLIC_KEY).trim();
const PULL_REFRESH_TRIGGER_PX = 64;
const PULL_REFRESH_MAX_PX = 92;
const HORIZONTAL_SWIPE_TRIGGER_PX = 58;
const HORIZONTAL_SWIPE_SLOPE = 1.25;
const WORKER_DEAL_TABS: WorkerDealTab[] = ["assigned", "inProgress", "ready"];

const employeeRoleLabels: Record<ProductionEmployeeRole, string> = {
  maker: "Макетчик",
  assembler: "Сборщик",
};

const statusLabels: Record<ProductionAssignmentStatus, string> = {
  assigned: "Назначено",
  inProgress: "В работе",
  submitted: "На проверке",
  readyForShipment: "Готово к отгрузке",
};

const employeeGroupConfigs: Array<Omit<EmployeeGroup, "employees">> = [
  { id: "makers", label: "Макетчики", description: "Сборка изделий и фотоотчеты" },
  { id: "assemblers", label: "Сборщики", description: "Сборочные работы" },
  { id: "managers", label: "Менеджеры", description: "Свои сделки из Битрикс" },
  { id: "technologists", label: "Сметчики / технологи", description: "Себестоимость и ТЗ" },
  { id: "shopChiefs", label: "Начальники цеха", description: "Распределение в работу" },
  { id: "leaders", label: "Руководители", description: "Полный доступ" },
  { id: "noAccess", label: "Без доступа", description: "Зарегистрированы, но не допущены" },
];

const photoSlots: Array<{
  kind: ProductionPhotoKind;
  title: string;
  hint: string;
}> = [
  {
    kind: "lit",
    title: "Включено",
    hint: "Фото готового изделия во включенном состоянии на фоне брендированного баннера.",
  },
  {
    kind: "unlit",
    title: "Выключено",
    hint: "Фото готового изделия в выключенном состоянии на фоне брендированного баннера.",
  },
  {
    kind: "packed",
    title: "Упаковка",
    hint: "Фото упакованной вывески с ID сделки и примотанным блоком, если он нужен.",
  },
];

const emptyCompletion: ProductionCompletion = {
  diodeCount: 0,
  diodeCatalogId: "",
  diodeCatalogTitle: "",
  powerSupply: "",
  powerSupplyCatalogId: "",
  powerSupplyCatalogTitle: "",
  noPowerSupply: false,
  note: "",
  photos: [],
};

export function ProductionMobileApp({
  calculations = new Map(),
  catalogItems = [],
  currentUser,
  deals,
  mode = "production",
  saveApiUrl = "",
  techSpecs,
  storedProduction,
  installAvailable = false,
  onChange,
  onCalculationChange,
  onDealStageChange,
  onInstallApp,
  onLogout,
  onOpenDeal,
  onRefresh,
}: ProductionMobileAppProps) {
  const [view, setView] = useState<ProductionView>(() => readStoredView());
  const storedProductionRef = useRef(storedProduction);
  const notifiedAssignmentIdsRef = useRef<Set<string>>(readNotifiedAssignmentIds(currentUser.id));
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const pullStartYRef = useRef<number | undefined>(undefined);
  const pullActivatedRef = useRef(false);
  const swipeStartXRef = useRef<number | undefined>(undefined);
  const swipeStartYRef = useRef<number | undefined>(undefined);
  const swipeLastXRef = useRef<number | undefined>(undefined);
  const swipeLastYRef = useRef<number | undefined>(undefined);
  const horizontalSwipeIntentRef = useRef(false);
  const [supervisorTab, setSupervisorTab] = useState<SupervisorTab>("active");
  const [workerTab, setWorkerTab] = useState<WorkerTab>("assigned");
  const [lastWorkerDealTab, setLastWorkerDealTab] = useState<WorkerDealTab>("assigned");
  const [seenAssignmentIds, setSeenAssignmentIds] = useState<Set<string>>(() =>
    readSeenAssignmentIds(currentUser.id),
  );
  const [query, setQuery] = useState("");
  const [selectedDealIds, setSelectedDealIds] = useState<Set<string>>(() => new Set());
  const [expandedDealIds, setExpandedDealIds] = useState<Set<string>>(() => new Set());
  const [expandedAssignmentIds, setExpandedAssignmentIds] = useState<Set<string>>(() => new Set());
  const [targetEmployeeId, setTargetEmployeeId] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(() => readStoredEmployeeId());
  const [theme, setTheme] = useState<ProductionTheme>(() => readStoredTheme());
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [passwordPanelOpen, setPasswordPanelOpen] = useState(false);
  const [workerNewPassword, setWorkerNewPassword] = useState("");
  const [pullDistance, setPullDistance] = useState(0);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [newEmployeeName, setNewEmployeeName] = useState("");
  const [newEmployeePhone, setNewEmployeePhone] = useState("");
  const [newEmployeeLogin, setNewEmployeeLogin] = useState("");
  const [newEmployeeRole, setNewEmployeeRole] = useState<ProductionEmployeeRole>("maker");
  const [newEmployeeAccessRole, setNewEmployeeAccessRole] = useState<ProductionAccessRole>("maker");
  const [newEmployeePin, setNewEmployeePin] = useState("");
  const [registrationRoles, setRegistrationRoles] = useState<Record<string, ProductionAccessRole>>({});
  const [registrationLogins, setRegistrationLogins] = useState<Record<string, string>>({});
  const [registrationWorkerRoles, setRegistrationWorkerRoles] = useState<
    Record<string, ProductionEmployeeRole>
  >({});
  const [registrationPins, setRegistrationPins] = useState<Record<string, string>>({});
  const [employeeAccessRoles, setEmployeeAccessRoles] = useState<Record<string, ProductionAccessRole>>({});
  const [employeeLogins, setEmployeeLogins] = useState<Record<string, string>>({});
  const [employeeWorkerRoles, setEmployeeWorkerRoles] = useState<Record<string, ProductionEmployeeRole>>({});
  const [employeePins, setEmployeePins] = useState<Record<string, string>>({});
  const [employeePayouts, setEmployeePayouts] = useState<Record<string, string>>({});
  const [selectedEmployeeGroupId, setSelectedEmployeeGroupId] = useState<EmployeeGroupId>("makers");
  const [staffDetailEmployeeId, setStaffDetailEmployeeId] = useState("");
  const [notificationPermission, setNotificationPermission] = useState(() => notificationPermissionState());
  const [notice, setNotice] = useState("");
  const currentAccessRole = accessRoleFor(currentUser);
  const canManageStaff = canManageEmployees(currentUser);
  const canAssignDeals = canAssignProduction(currentUser);
  const canSwitchProductionView = false;
  const effectiveView = currentAccessRole === "maker" ? "worker" : "supervisor";

  useEffect(() => {
    storedProductionRef.current = storedProduction;
  }, [storedProduction]);

  useEffect(() => {
    notifiedAssignmentIdsRef.current = readNotifiedAssignmentIds(currentUser.id);
    setSeenAssignmentIds(readSeenAssignmentIds(currentUser.id));
  }, [currentUser.id]);

  useEffect(() => {
    if (!profileMenuOpen) return;

    const closeMenuOnOutsidePress = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && profileMenuRef.current?.contains(target)) return;
      setProfileMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeMenuOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeMenuOnOutsidePress);
  }, [profileMenuOpen]);

  const employees = useMemo(
    () => storedProduction.employees.filter((employee) => employee.active !== false),
    [storedProduction.employees],
  );

  const employeeGroups = useMemo(() => buildEmployeeGroups(employees), [employees]);
  const selectedEmployeeGroup =
    employeeGroups.find((group) => group.id === selectedEmployeeGroupId) || employeeGroups[0];
  const visibleEmployees = selectedEmployeeGroup?.employees || [];

  const employeesById = useMemo(
    () => new Map(employees.map((employee) => [employee.id, employee])),
    [employees],
  );

  const dealsById = useMemo(
    () => new Map(deals.map((deal) => [deal.id, deal])),
    [deals],
  );

  const productionWorkers = useMemo(
    () => employees.filter((employee) => isProductionWorker(employee)),
    [employees],
  );
  const diodeCatalogItems = useMemo(
    () => catalogItems.filter(isDiodeCatalogItem).sort(compareCatalogItems),
    [catalogItems],
  );
  const powerSupplyCatalogItems = useMemo(
    () => catalogItems.filter(isPowerSupplyCatalogItem).sort(compareCatalogItems),
    [catalogItems],
  );

  const pendingRegistrations = useMemo(
    () => (storedProduction.registrations || []).filter((request) => request.status === "pending"),
    [storedProduction.registrations],
  );

  const activeRegistrationLinks = useMemo(
    () => (storedProduction.registrationLinks || []).filter((link) => link.active),
    [storedProduction.registrationLinks],
  );

  const assignmentsByPart = useMemo(
    () => latestAssignmentByPart(storedProduction.assignments),
    [storedProduction.assignments],
  );

  const productionDeals = useMemo(() => {
    const assignedDealIds = new Set(storedProduction.assignments.map((assignment) => assignment.dealId));
    return deals
      .filter((deal) => {
        const stage = stageCodeForDeal(deal);
        if (assignedDealIds.has(deal.id)) return true;
        if (stage === "production") return true;
        return currentAccessRole === "leader" && stage === "launch";
      })
      .sort(compareDealsByDeadline);
  }, [currentAccessRole, deals, storedProduction.assignments]);

  const visibleSupervisorDeals = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const byTab = productionDeals.filter((deal) => {
      const done = isDealReadyForShipment(deal.id, techSpecs.get(deal.id), storedProduction.assignments);
      return supervisorTab === "done" ? done : !done;
    });
    if (!needle) return byTab;

    return byTab.filter((deal) => {
      const dealAssignments = assignmentsForDeal(storedProduction.assignments, deal.id);
      const employeeNames = dealAssignments
        .map((assignment) => employeesById.get(assignment.employeeId)?.name)
        .filter(Boolean);
      return [
        deal.number,
        deal.title,
        deal.classification,
        deal.type,
        deal.responsible,
        stageLabels[stageCodeForDeal(deal)],
        employeeNames.join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [employeesById, productionDeals, query, storedProduction.assignments, supervisorTab, techSpecs]);

  const workerAssignments = useMemo(() => {
    const employeeId = currentAccessRole === "maker" ? currentUser.id : selectedEmployeeId;
    if (!employeeId) return [];
    return storedProduction.assignments
      .filter((assignment) => assignment.employeeId === employeeId)
      .sort((first, second) => compareAssignmentsByDealDeadline(first, second, dealsById));
  }, [currentAccessRole, currentUser.id, dealsById, selectedEmployeeId, storedProduction.assignments]);

  const staffDetailEmployee = staffDetailEmployeeId ? employeesById.get(staffDetailEmployeeId) : undefined;
  const staffDetailAssignments = useMemo(() => {
    if (!staffDetailEmployeeId) return [];
    return storedProduction.assignments
      .filter((assignment) => assignment.employeeId === staffDetailEmployeeId)
      .sort((first, second) => compareAssignmentsByDealDeadline(first, second, dealsById));
  }, [dealsById, staffDetailEmployeeId, storedProduction.assignments]);

  const productionStats = useMemo(
    () => summarizeProduction(storedProduction.assignments),
    [storedProduction.assignments],
  );

  const selectedDeals = visibleSupervisorDeals.filter((deal) => selectedDealIds.has(deal.id));
  const selectedEmployee =
    currentAccessRole === "maker"
      ? currentUser
      : selectedEmployeeId
        ? employeesById.get(selectedEmployeeId)
        : undefined;
  const hasAssignedWorkerTasks = workerAssignments.some((assignment) => assignment.status === "assigned");
  const selectedWorker = selectedEmployee;
  const unreadAssignmentCount = useMemo(
    () =>
      currentAccessRole === "maker"
        ? workerAssignments.filter(
            (assignment) => assignment.status === "assigned" && !seenAssignmentIds.has(assignment.id),
          ).length
        : 0,
    [currentAccessRole, seenAssignmentIds, workerAssignments],
  );
  const workerMoney = useMemo(
    () =>
      selectedWorker
        ? moneyForEmployee(
            selectedWorker.id,
            storedProduction.assignments,
            storedProduction.payouts || [],
            techSpecs,
            calculations,
          )
        : emptyMoneySummary(),
    [calculations, selectedWorker, storedProduction.assignments, storedProduction.payouts, techSpecs],
  );
  const workerGalleryPhotos = useMemo(
    () => galleryPhotosForWorker(workerAssignments, dealsById),
    [dealsById, workerAssignments],
  );
  const workerTabAssignments = useMemo(
    () => assignmentsForWorkerTab(workerAssignments, workerTab),
    [workerAssignments, workerTab],
  );
  const pushButtonLabel =
    notificationPermission === "unsupported"
      ? "Уведомления недоступны"
      : notificationPermission === "granted" && PUSH_PUBLIC_KEY
        ? "Push включены"
        : notificationPermission === "granted"
          ? "Подключить push"
          : "Включить push";

  useEffect(() => {
    if (currentAccessRole !== "maker" || notificationPermission !== "granted") return;

    const nextNotifiedIds = new Set(notifiedAssignmentIdsRef.current);
    const freshAssignments = workerAssignments.filter(
      (assignment) => assignment.status === "assigned" && !nextNotifiedIds.has(assignment.id),
    );
    if (!freshAssignments.length) return;

    for (const assignment of freshAssignments) {
      nextNotifiedIds.add(assignment.id);
      void showAssignmentNotification(assignment.notificationText);
    }

    notifiedAssignmentIdsRef.current = nextNotifiedIds;
    writeNotifiedAssignmentIds(currentUser.id, nextNotifiedIds);
  }, [currentAccessRole, currentUser.id, notificationPermission, workerAssignments]);

  useEffect(() => {
    localStorage.setItem(ROLE_STORAGE_KEY, view);
  }, [view]);

  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (isWorkerDealTab(workerTab)) setLastWorkerDealTab(workerTab);
  }, [workerTab]);

  useEffect(() => {
    if (currentAccessRole === "maker") {
      setView("worker");
      setSelectedEmployeeId(currentUser.id);
    } else if (currentAccessRole === "shopChief") {
      setView("supervisor");
    }
  }, [currentAccessRole, currentUser.id]);

  useEffect(() => {
    if (selectedEmployeeId) localStorage.setItem(EMPLOYEE_STORAGE_KEY, selectedEmployeeId);
  }, [selectedEmployeeId]);

  useEffect(() => {
    if (staffDetailEmployeeId && !employeesById.has(staffDetailEmployeeId)) {
      setStaffDetailEmployeeId("");
    }
  }, [employeesById, staffDetailEmployeeId]);

  useEffect(() => {
    if (!productionWorkers.length) {
      setTargetEmployeeId("");
      if (currentAccessRole !== "maker") setSelectedEmployeeId("");
      return;
    }

    if (!targetEmployeeId || !productionWorkers.some((employee) => employee.id === targetEmployeeId)) {
      setTargetEmployeeId(productionWorkers[0].id);
    }

    if (
      currentAccessRole !== "maker" &&
      (!selectedEmployeeId || !productionWorkers.some((employee) => employee.id === selectedEmployeeId))
    ) {
      setSelectedEmployeeId(productionWorkers[0].id);
    }
  }, [currentAccessRole, productionWorkers, selectedEmployeeId, targetEmployeeId]);

  useEffect(() => {
    if (!canCreateAccessRole(currentUser, newEmployeeAccessRole)) {
      setNewEmployeeAccessRole("maker");
    }
  }, [currentUser, newEmployeeAccessRole]);

  function commitProduction(
    updater: (current: StoredProduction) => StoredProduction,
    options: ProductionCommitOptions = {},
  ) {
    const nextProduction = {
      ...updater(storedProductionRef.current),
      generatedAt: new Date().toISOString(),
    };
    storedProductionRef.current = nextProduction;
    onChange(nextProduction, options);
  }

  async function addEmployee() {
    const name = newEmployeeName.trim();
    const login = newEmployeeLogin.trim() || newEmployeePhone.trim() || name;
    if (!name) return;
    if (!canCreateAccessRole(currentUser, newEmployeeAccessRole)) return;

    const pin = newEmployeePin.trim();
    if (pin.length < 4) {
      setNotice("Пароль сотрудника должен быть не короче 4 символов.");
      window.setTimeout(() => setNotice(""), 2600);
      return;
    }

    const id = createId();
    const employee: ProductionEmployee = {
      id,
      name,
      login,
      role: newEmployeeAccessRole === "maker" ? newEmployeeRole : "maker",
      accessRole: newEmployeeAccessRole,
      phone: newEmployeePhone.trim(),
      active: true,
      createdAt: new Date().toISOString(),
      pinHash: await pinHashForEmployee(id, pin),
    };

    commitProduction((current) => ({
      ...current,
      employees: [...current.employees, employee],
    }), { saveNow: true });
    setNewEmployeeName("");
    setNewEmployeePhone("");
    setNewEmployeeLogin("");
    setNewEmployeePin("");
    setNewEmployeeAccessRole("maker");
    setTargetEmployeeId(employee.id);
    if (isProductionWorker(employee)) setSelectedEmployeeId(employee.id);
  }

  async function createRegistrationLink() {
    const link: ProductionRegistrationLink = {
      id: createId(),
      token: createInviteToken(),
      createdAt: new Date().toISOString(),
      createdBy: currentUser.id,
      active: true,
    };
    commitProduction((current) => ({
      ...current,
      registrationLinks: [...(current.registrationLinks || []), link],
    }), { saveNow: true });
    await copyText(registrationUrl(link));
    setNotice("Ссылка регистрации создана и скопирована.");
    window.setTimeout(() => setNotice(""), 2600);
  }

  function revokeRegistrationLink(linkId: string) {
    commitProduction((current) => ({
      ...current,
      registrationLinks: (current.registrationLinks || []).map((link) =>
        link.id === linkId ? { ...link, active: false } : link,
      ),
    }), { saveNow: true });
  }

  async function approveRegistration(request: ProductionRegistrationRequest) {
    const accessRole = registrationRoles[request.id] || "maker";
    const login = (registrationLogins[request.id] || request.phone || request.name).trim();
    const workerRole = registrationWorkerRoles[request.id] || "maker";
    const pin = (registrationPins[request.id] || "").trim();

    if (!canCreateAccessRole(currentUser, accessRole)) return;
    if (pin.length < 4) {
      setNotice("Для подтверждения заявки задайте пароль не короче 4 символов.");
      window.setTimeout(() => setNotice(""), 2600);
      return;
    }

    const id = request.employeeId || createId();
    const employee: ProductionEmployee = {
      id,
      name: request.name,
      login,
      phone: request.phone,
      role: accessRole === "maker" ? workerRole : "maker",
      accessRole,
      active: true,
      createdAt: new Date().toISOString(),
      pinHash: await pinHashForEmployee(id, pin),
    };

    commitProduction((current) => ({
      ...current,
      employees: current.employees.some((item) => item.id === id)
        ? current.employees.map((item) => (item.id === id ? { ...item, ...employee } : item))
        : [...current.employees, employee],
      registrations: (current.registrations || []).map((item) =>
        item.id === request.id
          ? {
              ...item,
              status: "approved",
              reviewedAt: new Date().toISOString(),
              reviewedBy: currentUser.id,
              employeeId: id,
            }
          : item,
      ),
    }), { saveNow: true });
    setRegistrationLogins((current) => ({ ...current, [request.id]: "" }));
    setRegistrationPins((current) => ({ ...current, [request.id]: "" }));
    setNotice(`Доступ выдан: ${request.name}`);
    window.setTimeout(() => setNotice(""), 2400);
  }

  function rejectRegistration(request: ProductionRegistrationRequest) {
    commitProduction((current) => ({
      ...current,
      registrations: (current.registrations || []).map((item) =>
        item.id === request.id
          ? {
              ...item,
              status: "rejected",
              reviewedAt: new Date().toISOString(),
              reviewedBy: currentUser.id,
            }
          : item,
      ),
    }), { saveNow: true });
  }

  async function saveEmployeeAccess(employee: ProductionEmployee) {
    const accessRole = employeeAccessRoles[employee.id] ?? accessRoleFor(employee);
    const loginDraft = employeeLogins[employee.id];
    const login = (loginDraft === undefined ? employee.login ?? employee.phone ?? employee.name : loginDraft).trim();
    const workerRole = employeeWorkerRoles[employee.id] ?? employee.role;
    const pin = (employeePins[employee.id] || "").trim();

    if (!canCreateAccessRole(currentUser, accessRole)) return;
    if (employee.id === currentUser.id && accessRole !== "leader") {
      setNotice("Нельзя закрыть себе руководящий доступ из текущей сессии.");
      window.setTimeout(() => setNotice(""), 2600);
      return;
    }
    if (accessRole !== "none" && !login) {
      setNotice("Чтобы выдать доступ, укажите логин сотрудника.");
      window.setTimeout(() => setNotice(""), 2600);
      return;
    }
    if (accessRole !== "none" && !employee.pinHash && pin.length < 4) {
      setNotice("Чтобы выдать доступ, задайте пароль не короче 4 символов.");
      window.setTimeout(() => setNotice(""), 2600);
      return;
    }

    const nextPinHash = pin.length ? await pinHashForEmployee(employee.id, pin) : employee.pinHash;
    commitProduction((current) => ({
      ...current,
      employees: current.employees.map((item) =>
        item.id === employee.id
          ? {
              ...item,
              login,
              accessRole,
              role: accessRole === "maker" ? workerRole : item.role,
              pinHash: accessRole === "none" ? undefined : nextPinHash,
              active: true,
            }
          : item,
      ),
    }), { saveNow: true });
    setEmployeeAccessRoles((current) => removeRecordValue(current, employee.id));
    setEmployeeLogins((current) => removeRecordValue(current, employee.id));
    setEmployeeWorkerRoles((current) => removeRecordValue(current, employee.id));
    setEmployeePins((current) => removeRecordValue(current, employee.id));
    setNotice(`Доступ сохранен: ${employee.name}`);
    window.setTimeout(() => setNotice(""), 2200);
  }

  function closeEmployeeAccess(employee: ProductionEmployee) {
    if (employee.id === currentUser.id) return;
    commitProduction((current) => ({
      ...current,
      employees: current.employees.map((item) =>
        item.id === employee.id
          ? {
              ...item,
              accessRole: "none",
              pinHash: undefined,
            }
          : item,
      ),
    }), { saveNow: true });
  }

  function deleteEmployee(employee: ProductionEmployee) {
    if (employee.id === currentUser.id) return;
    commitProduction((current) => ({
      ...current,
      employees: current.employees.map((item) =>
        item.id === employee.id
          ? {
              ...item,
              active: false,
              accessRole: "none",
              pinHash: undefined,
            }
          : item,
      ),
      assignments: current.assignments.filter((assignment) => assignment.employeeId !== employee.id),
    }), { saveNow: true });
  }

  async function updateEmployeeAvatar(employee: ProductionEmployee, file?: File) {
    if (!file) return;
    const avatarDataUrl = await readImageFileAsDataUrl(file, {
      maxHeight: 640,
      maxWidth: 640,
      quality: 0.86,
    });
    commitProduction((current) => ({
      ...current,
      employees: current.employees.map((item) =>
        item.id === employee.id ? { ...item, avatarDataUrl } : item,
      ),
    }), { saveNow: true });
  }

  async function updateCurrentWorkerPassword() {
    const pin = workerNewPassword.trim();
    if (pin.length < 4) {
      setNotice("Пароль должен быть не короче 4 символов.");
      window.setTimeout(() => setNotice(""), 2400);
      return;
    }

    const pinHash = await pinHashForEmployee(currentUser.id, pin);
    commitProduction((current) => ({
      ...current,
      employees: current.employees.map((item) =>
        item.id === currentUser.id ? { ...item, pinHash } : item,
      ),
    }), { saveNow: true });
    setWorkerNewPassword("");
    setPasswordPanelOpen(false);
    setProfileMenuOpen(false);
    setNotice("Пароль обновлен.");
    window.setTimeout(() => setNotice(""), 2200);
  }

  function addEmployeePayout(employee: ProductionEmployee) {
    const rawValue = employeePayouts[employee.id] || "";
    const amount = Number(rawValue.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      setNotice("Введите сумму выплаты.");
      window.setTimeout(() => setNotice(""), 2400);
      return;
    }

    const payout: ProductionPayout = {
      id: createId(),
      employeeId: employee.id,
      amount,
      paidAt: new Date().toISOString(),
      paidBy: currentUser.id,
    };

    commitProduction((current) => ({
      ...current,
      payouts: [...(current.payouts || []), payout],
    }), { saveNow: true });
    setEmployeePayouts((current) => ({ ...current, [employee.id]: "" }));
    setNotice(`Выплата сохранена: ${employee.name} · ${formatMoney(amount)}`);
    window.setTimeout(() => setNotice(""), 2400);
  }

  function assignSelectedDeals() {
    if (!canAssignDeals || !targetEmployeeId || !selectedDeals.length) return;
    assignDeals(selectedDeals.map((deal) => deal.id), targetEmployeeId);
  }

  function assignSingleDeal(dealId: string) {
    if (!canAssignDeals || !targetEmployeeId) return;
    assignDeals([dealId], targetEmployeeId);
  }

  function assignDealPart(dealId: string, techSpecItemId: string, employeeId: string) {
    if (!canAssignDeals || !employeeId) return;
    assignDeals([dealId], employeeId, techSpecItemId);
  }

  function assignDeals(dealIds: string[], employeeId: string, techSpecItemId?: string) {
    const employee = employeesById.get(employeeId);
    if (!employee || !isProductionWorker(employee)) return;

    const now = new Date().toISOString();
    const dealMap = new Map(deals.map((deal) => [deal.id, deal]));
    const pushMessages: string[] = [];

    commitProduction((current) => {
      const nextAssignments = [...current.assignments];

      for (const dealId of dealIds) {
        const deal = dealMap.get(dealId);
        const spec = deal ? techSpecs.get(deal.id) : undefined;
        const part = techSpecItemId ? spec?.draft.items.find((item) => item.id === techSpecItemId) : undefined;
        const partTitle = part ? techSpecItemTitle(part, spec?.draft.items.indexOf(part) ?? 0) : "";
        const notificationText = deal
          ? `Вам назначили на сборку ${partTitle || "изделие"} #${deal.number}: ${deal.title}`
          : "Вам назначили на сборку изделие";
        pushMessages.push(notificationText);
        const existingIndex = latestAssignmentIndex(nextAssignments, dealId, techSpecItemId);
        const event = createEvent("assigned", "Руководитель", employee.name);

        if (existingIndex >= 0) {
          const currentAssignment = nextAssignments[existingIndex];
          nextAssignments[existingIndex] = {
            ...currentAssignment,
            techSpecItemId,
            employeeId,
            status:
              currentAssignment.status === "readyForShipment" ? currentAssignment.status : "assigned",
            assignedAt: now,
            assignedBy: "Руководитель",
            notificationText,
            startedAt:
              currentAssignment.employeeId === employeeId ? currentAssignment.startedAt : undefined,
            submittedAt:
              currentAssignment.employeeId === employeeId ? currentAssignment.submittedAt : undefined,
            readyForShipmentAt: currentAssignment.readyForShipmentAt,
            completion:
              currentAssignment.employeeId === employeeId ? currentAssignment.completion : undefined,
            history: [...currentAssignment.history, event],
          };
        } else {
          nextAssignments.push({
            id: createId(),
            dealId,
            techSpecItemId,
            employeeId,
            status: "assigned",
            assignedAt: now,
            assignedBy: "Руководитель",
            notificationText,
            history: [event],
          });
        }
      }

      return {
        ...current,
        assignments: nextAssignments,
      };
    }, { saveNow: true });

    setSelectedDealIds(new Set());
    setNotice(`Назначено: ${dealIds.length} сделок -> ${employee.name}`);
    void sendAssignmentPush(employee, pushMessages);
    window.setTimeout(() => setNotice(""), 2400);
  }

  async function sendAssignmentPush(employee: ProductionEmployee, messages: string[]) {
    const subscriptions = employee.pushSubscriptions || [];
    if (!saveApiUrl || !subscriptions.length || !messages.length) return;

    try {
      await sendProductionPush(
        { apiUrl: saveApiUrl },
        {
          employeeId: employee.id,
          subscriptions,
          title: "Новая сборка Verkup",
          body: messages.length === 1 ? messages[0] : `Вам назначили ${messages.length} сделок на сборку.`,
          url: productionAppUrl(),
        },
      );
    } catch {
      // Назначение уже сохранено; push повторится после серверной настройки.
    }
  }

  async function changeDealStage(deal: Deal, stage: DealStageCode) {
    const currentStage = stageCodeForDeal(deal);
    if (currentStage === stage) return;

    try {
      if (saveApiUrl) {
        await moveDealToStage({ apiUrl: saveApiUrl }, deal.id, stage);
      }
      onDealStageChange?.(deal.id, stage);
      setNotice(`Стадия сделки #${deal.number}: ${stageLabels[stage]}`);
    } catch {
      setNotice("Стадию сделки не удалось изменить. Проверьте подключение к серверу.");
    }
    window.setTimeout(() => setNotice(""), 2600);
  }

  function openStaffAssignmentDeal(assignment: ProductionAssignment) {
    const deal = dealsById.get(assignment.dealId);
    if (!deal) return;

    if (currentAccessRole === "shopChief") {
      openDealTechSpecInProduction(deal);
      return;
    }

    onOpenDeal?.(deal.id, canAccessCosting(currentUser) ? "cost" : "techSpec");
  }

  function openDealTechSpecInProduction(deal: Deal) {
    const done = isDealReadyForShipment(deal.id, techSpecs.get(deal.id), storedProduction.assignments);
    setSupervisorTab(done ? "done" : "active");
    setExpandedDealIds((current) => {
      const next = new Set(current);
      next.add(deal.id);
      return next;
    });
    setSelectedDealIds(new Set());
    setQuery("");
    setNotice(`Открыто ТЗ сделки #${deal.number}`);
    window.setTimeout(() => setNotice(""), 2200);
    window.requestAnimationFrame(() => {
      const card = Array.from(document.querySelectorAll<HTMLElement>("[data-production-deal-id]")).find(
        (element) => element.dataset.productionDealId === deal.id,
      );
      card?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function patchAssignment(
    assignmentId: string,
    updater: (assignment: ProductionAssignment) => ProductionAssignment,
    options: ProductionCommitOptions = {},
  ) {
    commitProduction((current) => ({
      ...current,
      assignments: current.assignments.map((assignment) =>
        assignment.id === assignmentId ? updater(assignment) : assignment,
      ),
    }), options);
  }

  function startAssignment(assignment: ProductionAssignment) {
    markAssignmentSeen(assignment.id);
    const actor = employeesById.get(assignment.employeeId)?.name || "Макетчик";
    patchAssignment(assignment.id, (current) => ({
      ...current,
      status: "inProgress",
      startedAt: current.startedAt || new Date().toISOString(),
      history: [...current.history, createEvent("started", actor)],
    }), { saveNow: true });
  }

  function updateCompletion(
    assignmentId: string,
    patch: Partial<ProductionCompletion>,
    options: ProductionCommitOptions = {},
  ) {
    patchAssignment(assignmentId, (assignment) => ({
      ...assignment,
      completion: {
        ...emptyCompletion,
        ...assignment.completion,
        ...patch,
      },
    }), options);
  }

  async function addPhoto(
    assignment: ProductionAssignment,
    kind: ProductionPhotoKind,
    file?: File,
  ) {
    if (!file) return;
    try {
      const dataUrl = await readImageFileAsDataUrl(file, {
        maxHeight: 960,
        maxWidth: 960,
        quality: 0.62,
      });
      const deal = dealsById.get(assignment.dealId);
      const nextPhoto: ProductionPhoto = {
        assignmentId: assignment.id,
        dealId: assignment.dealId,
        dealNumber: deal?.number || "",
        dealTitle: deal?.title || "",
        employeeId: assignment.employeeId,
        kind,
        name: file.name,
        dataUrl,
        techSpecItemId: assignment.techSpecItemId,
        uploadedAt: new Date().toISOString(),
      };
      const completion = completionFor(assignment);
      setNotice("Фото добавлено. Сохраняю на сайте...");
      updateCompletion(assignment.id, {
        photos: [
          ...completion.photos.filter((photo) => photo.kind !== kind),
          nextPhoto,
        ],
      }, {
        saveNow: true,
        onSaved: () => {
          setNotice("Фото сохранено на сайте.");
          window.setTimeout(() => setNotice(""), 2200);
        },
        onSaveError: () => {
          setNotice("Фото видно в приложении, но пока не отправилось на сайт. Проверьте интернет и откройте приложение еще раз.");
          window.setTimeout(() => setNotice(""), 5200);
        },
      });
    } catch {
      setNotice("Фото не загрузилось. Выберите JPG, PNG или WebP и попробуйте еще раз.");
      window.setTimeout(() => setNotice(""), 2600);
    }
  }

  function removePhoto(assignment: ProductionAssignment, kind: ProductionPhotoKind) {
    const completion = completionFor(assignment);
    updateCompletion(assignment.id, {
      photos: completion.photos.filter((photo) => photo.kind !== kind),
    }, { saveNow: true });
  }

  function submitAssignment(assignment: ProductionAssignment) {
    const completion = completionWithCatalogItems(
      completionFor(assignment),
      diodeCatalogItems,
      powerSupplyCatalogItems,
    );
    if (!canSubmitCompletion(completion)) return;

    onCalculationChange?.(
      calculationWithProductionLighting(
        calculations.get(assignment.dealId),
        assignment,
        completion,
        diodeCatalogItems,
        powerSupplyCatalogItems,
      ),
    );

    const actor = employeesById.get(assignment.employeeId)?.name || "Макетчик";
    patchAssignment(assignment.id, (current) => ({
      ...current,
      status: "submitted",
      submittedAt: new Date().toISOString(),
      completion,
      history: [...current.history, createEvent("submitted", actor)],
    }), { saveNow: true });
  }

  function markReadyForShipment(assignment: ProductionAssignment) {
    patchAssignment(assignment.id, (current) => ({
      ...current,
      status: "readyForShipment",
      readyForShipmentAt: new Date().toISOString(),
      history: [...current.history, createEvent("readyForShipment", "Руководитель")],
    }), { saveNow: true });
  }

  function toggleDealSelection(dealId: string, checked: boolean) {
    setSelectedDealIds((current) => {
      const next = new Set(current);
      if (checked) next.add(dealId);
      else next.delete(dealId);
      return next;
    });
  }

  function toggleAllVisible(checked: boolean) {
    setSelectedDealIds(() =>
      checked ? new Set(visibleSupervisorDeals.map((deal) => deal.id)) : new Set(),
    );
  }

  function toggleDealExpanded(dealId: string) {
    setExpandedDealIds((current) => {
      const next = new Set(current);
      if (next.has(dealId)) next.delete(dealId);
      else next.add(dealId);
      return next;
    });
  }

  function toggleAssignmentExpanded(assignmentId: string) {
    setExpandedAssignmentIds((current) => {
      const next = new Set(current);
      if (next.has(assignmentId)) next.delete(assignmentId);
      else next.add(assignmentId);
      return next;
    });
  }

  function markAssignmentSeen(assignmentId: string) {
    setSeenAssignmentIds((current) => {
      if (current.has(assignmentId)) return current;
      const next = new Set(current);
      next.add(assignmentId);
      writeSeenAssignmentIds(currentUser.id, next);
      return next;
    });
  }

  function openWorkerAssignment(assignment: ProductionAssignment) {
    if (assignment.status === "assigned") markAssignmentSeen(assignment.id);
    toggleAssignmentExpanded(assignment.id);
  }

  async function enableBrowserNotifications() {
    if (!("Notification" in window)) {
      setNotice("Браузер не поддерживает уведомления.");
      return;
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);

    if (permission !== "granted") {
      setNotice("Уведомления не включены. Назначения будут видны внутри приложения.");
      window.setTimeout(() => setNotice(""), 3000);
      return;
    }

    const subscription = await subscribeCurrentDeviceToPush();
    if (subscription) {
      saveCurrentUserPushSubscription(subscription);
      setNotice("Push-уведомления включены для этого телефона.");
    } else {
      setNotice("Уведомления включены. Для push при закрытом приложении нужен серверный ключ.");
    }
    window.setTimeout(() => setNotice(""), 3000);
  }

  async function subscribeCurrentDeviceToPush() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !PUSH_PUBLIC_KEY) return undefined;

    try {
      const registration = await navigator.serviceWorker.ready;
      const existingSubscription = await registration.pushManager.getSubscription();
      const applicationServerKey = urlBase64ToUint8Array(PUSH_PUBLIC_KEY);
      if (existingSubscription) {
        if (subscriptionUsesApplicationServerKey(existingSubscription, applicationServerKey)) {
          return pushSubscriptionFromBrowser(existingSubscription);
        }
        await existingSubscription.unsubscribe();
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
      return pushSubscriptionFromBrowser(subscription);
    } catch {
      return undefined;
    }
  }

  function saveCurrentUserPushSubscription(subscription: ProductionPushSubscription) {
    commitProduction((current) => ({
      ...current,
      employees: current.employees.map((employee) =>
        employee.id === currentUser.id
          ? {
              ...employee,
              pushSubscriptions: mergePushSubscriptions(employee.pushSubscriptions || [], subscription),
            }
          : employee,
      ),
    }), { saveNow: true });
  }

  function handleTouchStart(event: TouchEvent<HTMLElement>) {
    const touch = event.touches[0];
    if (touch && canStartWorkerSwipe(event.target)) {
      swipeStartXRef.current = touch.clientX;
      swipeStartYRef.current = touch.clientY;
      swipeLastXRef.current = touch.clientX;
      swipeLastYRef.current = touch.clientY;
      horizontalSwipeIntentRef.current = false;
    } else {
      resetWorkerSwipe();
    }

    if (pullRefreshing || window.scrollY > 0) {
      pullStartYRef.current = undefined;
      return;
    }

    pullStartYRef.current = touch?.clientY;
    pullActivatedRef.current = false;
  }

  function handleTouchMove(event: TouchEvent<HTMLElement>) {
    const touch = event.touches[0];
    if (touch) {
      swipeLastXRef.current = touch.clientX;
      swipeLastYRef.current = touch.clientY;
    }

    if (shouldTreatAsHorizontalSwipe()) {
      horizontalSwipeIntentRef.current = true;
      pullStartYRef.current = undefined;
      pullActivatedRef.current = false;
      setPullDistance(0);
      if (event.cancelable) event.preventDefault();
      return;
    }

    const startY = pullStartYRef.current;
    if (startY === undefined || pullRefreshing || window.scrollY > 0) return;

    const touchY = touch?.clientY;
    if (touchY === undefined) return;

    const distance = touchY - startY;
    if (distance <= 0) {
      setPullDistance(0);
      return;
    }

    if (event.cancelable && distance > 8) event.preventDefault();

    const easedDistance = Math.min(PULL_REFRESH_MAX_PX, Math.round(distance * 0.46));
    setPullDistance(easedDistance);
    if (easedDistance >= PULL_REFRESH_TRIGGER_PX) pullActivatedRef.current = true;
  }

  function handleTouchEnd(event?: TouchEvent<HTMLElement>) {
    if (event?.changedTouches[0]) {
      swipeLastXRef.current = event.changedTouches[0].clientX;
      swipeLastYRef.current = event.changedTouches[0].clientY;
    }

    if (finishWorkerSwipe()) {
      pullStartYRef.current = undefined;
      pullActivatedRef.current = false;
      setPullDistance(0);
      return;
    }

    pullStartYRef.current = undefined;
    const shouldRefresh = pullActivatedRef.current || pullDistance >= PULL_REFRESH_TRIGGER_PX;
    pullActivatedRef.current = false;

    if (!shouldRefresh) {
      setPullDistance(0);
      return;
    }

    void refreshMobileData();
  }

  function resetWorkerSwipe() {
    swipeStartXRef.current = undefined;
    swipeStartYRef.current = undefined;
    swipeLastXRef.current = undefined;
    swipeLastYRef.current = undefined;
    horizontalSwipeIntentRef.current = false;
  }

  function canStartWorkerSwipe(target: EventTarget | null) {
    if (mode !== "production" || effectiveView !== "worker") return false;
    if (!(target instanceof Element)) return true;
    return !target.closest(
      "input, textarea, select, option, label, .worker-profile-menu, .worker-password-panel, .production-completion-form, .production-photo-slot",
    );
  }

  function shouldTreatAsHorizontalSwipe() {
    const startX = swipeStartXRef.current;
    const startY = swipeStartYRef.current;
    const lastX = swipeLastXRef.current;
    const lastY = swipeLastYRef.current;
    if (
      startX === undefined ||
      startY === undefined ||
      lastX === undefined ||
      lastY === undefined
    ) {
      return false;
    }

    const deltaX = lastX - startX;
    const deltaY = lastY - startY;
    return (
      Math.abs(deltaX) > 12 &&
      Math.abs(deltaX) > Math.abs(deltaY) * HORIZONTAL_SWIPE_SLOPE
    );
  }

  function finishWorkerSwipe() {
    const startX = swipeStartXRef.current;
    const startY = swipeStartYRef.current;
    const lastX = swipeLastXRef.current;
    const lastY = swipeLastYRef.current;
    const wasHorizontal = horizontalSwipeIntentRef.current;
    resetWorkerSwipe();

    if (
      startX === undefined ||
      startY === undefined ||
      lastX === undefined ||
      lastY === undefined
    ) {
      return false;
    }

    const deltaX = lastX - startX;
    const deltaY = lastY - startY;
    const isHorizontal =
      wasHorizontal ||
      (Math.abs(deltaX) > 12 &&
        Math.abs(deltaX) > Math.abs(deltaY) * HORIZONTAL_SWIPE_SLOPE);
    if (!isHorizontal) return false;

    if (
      Math.abs(deltaX) < HORIZONTAL_SWIPE_TRIGGER_PX ||
      Math.abs(deltaX) < Math.abs(deltaY) * HORIZONTAL_SWIPE_SLOPE
    ) {
      return true;
    }

    if (workerTab === "money" && deltaX > 0) {
      setWorkerTab(lastWorkerDealTab);
      return true;
    }

    if (!isWorkerDealTab(workerTab)) return true;

    const currentIndex = WORKER_DEAL_TABS.indexOf(workerTab);
    const nextIndex = deltaX < 0 ? currentIndex + 1 : currentIndex - 1;
    const nextTab = WORKER_DEAL_TABS[nextIndex];
    if (nextTab) {
      setWorkerTab(nextTab);
    }
    return true;
  }

  async function refreshMobileData() {
    setPullRefreshing(true);
    setPullDistance(PULL_REFRESH_TRIGGER_PX);

    try {
      if (onRefresh) await onRefresh();
      else window.location.reload();
    } catch {
      setNotice("Не удалось обновить данные.");
      window.setTimeout(() => setNotice(""), 2400);
    } finally {
      setPullRefreshing(false);
      setPullDistance(0);
    }
  }

  function renderEmployeeAccessPanel() {
    if (!canManageStaff) {
      return (
        <div className="production-empty">
          Для вашей роли управление сотрудниками недоступно.
        </div>
      );
    }

    return (
      <div className="production-panel production-staff-panel">
        <div className="production-panel-head">
          <UsersRound size={18} />
          <h2>Сотрудники</h2>
        </div>
        <section className="registration-links">
          <button className="primary" onClick={() => void createRegistrationLink()} type="button">
            <Link2 size={16} />
            Создать ссылку регистрации
          </button>
          {activeRegistrationLinks.map((link) => (
            <div className="registration-link-row" key={link.id}>
              <input readOnly value={registrationUrl(link)} />
              <button
                className="icon-button"
                onClick={() => void copyText(registrationUrl(link))}
                title="Скопировать ссылку"
                type="button"
              >
                <Copy size={16} />
              </button>
              <button
                className="icon-button"
                onClick={() => revokeRegistrationLink(link.id)}
                title="Закрыть ссылку"
                type="button"
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </section>
        {pendingRegistrations.length ? (
          <section className="registration-requests">
            <h3>Заявки на регистрацию</h3>
            {pendingRegistrations.map((request) => {
              const selectedAccessRole = registrationRoles[request.id] || "maker";

              return (
                <article className="registration-request" key={request.id}>
                  <div>
                    <strong>{request.name}</strong>
                    <span>{request.phone || "Телефон не указан"}</span>
                    {request.note ? <p>{request.note}</p> : null}
                  </div>
                  <select
                    onChange={(event) =>
                      setRegistrationRoles((current) => ({
                        ...current,
                        [request.id]: event.target.value as ProductionAccessRole,
                      }))
                    }
                    value={selectedAccessRole}
                  >
                    {(["maker", "shopChief", "technologist", "manager", "leader"] as ProductionAccessRole[])
                      .filter((role) => canCreateAccessRole(currentUser, role))
                      .map((role) => (
                        <option key={role} value={role}>
                          {accessRoleLabels[role]}
                        </option>
                      ))}
                  </select>
                  <input
                    onChange={(event) =>
                      setRegistrationLogins((current) => ({
                        ...current,
                        [request.id]: event.target.value,
                      }))
                    }
                    placeholder="Логин"
                    value={registrationLogins[request.id] || request.phone || request.name}
                  />
                  {selectedAccessRole === "maker" ? (
                    <select
                      onChange={(event) =>
                        setRegistrationWorkerRoles((current) => ({
                          ...current,
                          [request.id]: event.target.value as ProductionEmployeeRole,
                        }))
                      }
                      value={registrationWorkerRoles[request.id] || "maker"}
                    >
                      <option value="maker">Макетчик</option>
                      <option value="assembler">Сборщик</option>
                    </select>
                  ) : null}
                  <input
                    onChange={(event) =>
                      setRegistrationPins((current) => ({
                        ...current,
                        [request.id]: event.target.value,
                      }))
                    }
                    placeholder="Пароль для входа"
                    type="password"
                    value={registrationPins[request.id] || ""}
                  />
                  <div className="registration-request-actions">
                    <button className="primary" onClick={() => void approveRegistration(request)} type="button">
                      <CheckCircle2 size={16} />
                      Выдать доступ
                    </button>
                    <button className="secondary" onClick={() => rejectRegistration(request)} type="button">
                      <X size={16} />
                      Отклонить
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        ) : null}
        <div className="production-employee-form">
          <input
            onChange={(event) => setNewEmployeeName(event.target.value)}
            placeholder="Имя сотрудника"
            value={newEmployeeName}
          />
          <input
            onChange={(event) => setNewEmployeePhone(event.target.value)}
            placeholder="Телефон"
            value={newEmployeePhone}
          />
          <input
            autoComplete="username"
            onChange={(event) => setNewEmployeeLogin(event.target.value)}
            placeholder="Логин"
            value={newEmployeeLogin}
          />
          <select
            onChange={(event) => setNewEmployeeAccessRole(event.target.value as ProductionAccessRole)}
            value={newEmployeeAccessRole}
          >
            {(["maker", "shopChief", "technologist", "manager", "leader"] as ProductionAccessRole[])
              .filter((role) => canCreateAccessRole(currentUser, role))
              .map((role) => (
                <option key={role} value={role}>
                  {accessRoleLabels[role]}
                </option>
              ))}
          </select>
          {newEmployeeAccessRole === "maker" ? (
            <select
              onChange={(event) => setNewEmployeeRole(event.target.value as ProductionEmployeeRole)}
              value={newEmployeeRole}
            >
              <option value="maker">Макетчик</option>
              <option value="assembler">Сборщик</option>
            </select>
          ) : null}
          <input
            onChange={(event) => setNewEmployeePin(event.target.value)}
            placeholder="Пароль для входа"
            type="password"
            value={newEmployeePin}
          />
          <button className="primary" onClick={() => void addEmployee()} type="button">
            <Plus size={16} />
            Добавить вручную
          </button>
        </div>
        <div className="employee-group-grid" role="tablist" aria-label="Группы сотрудников">
          {employeeGroups.map((group) => (
            <button
              aria-selected={selectedEmployeeGroupId === group.id}
              className={selectedEmployeeGroupId === group.id ? "active" : ""}
              key={group.id}
              onClick={() => setSelectedEmployeeGroupId(group.id)}
              type="button"
            >
              <span>{group.label}</span>
              <strong>{group.employees.length}</strong>
              <small>{group.description}</small>
            </button>
          ))}
        </div>

        <div className="production-employee-list">
          {selectedEmployeeGroup ? (
            <div className="employee-list-head">
              <div>
                <strong>{selectedEmployeeGroup.label}</strong>
                <span>{selectedEmployeeGroup.description}</span>
              </div>
              <em>{selectedEmployeeGroup.employees.length}</em>
            </div>
          ) : null}
          {visibleEmployees.map((employee) => (
            <div className="production-employee-row employee-admin-row" key={employee.id}>
              <button
                className="employee-row-summary"
                onClick={() => setStaffDetailEmployeeId(employee.id)}
                type="button"
              >
                <span className="employee-row-avatar">{initials(employee.name)}</span>
                <div>
                  <strong>{employee.name}</strong>
                  <small>
                    {accessRoleLabels[accessRoleFor(employee)]}
                    {employee.login ? ` · ${employee.login}` : ""}
                    {accessRoleFor(employee) === "maker" ? ` · ${employeeRoleLabels[employee.role]}` : ""}
                    {employee.phone ? ` · ${employee.phone}` : ""}
                  </small>
                </div>
              </button>
              <div className="employee-access-controls">
                <select
                  onChange={(event) =>
                    setEmployeeAccessRoles((current) => ({
                      ...current,
                      [employee.id]: event.target.value as ProductionAccessRole,
                    }))
                  }
                  value={employeeAccessRoles[employee.id] ?? accessRoleFor(employee)}
                >
                  {(["none", "maker", "shopChief", "technologist", "manager", "leader"] as ProductionAccessRole[])
                    .filter((role) => canCreateAccessRole(currentUser, role))
                    .map((role) => (
                      <option key={role} value={role}>
                        {accessRoleLabels[role]}
                      </option>
                    ))}
                </select>
                <input
                  autoComplete="username"
                  onChange={(event) =>
                    setEmployeeLogins((current) => ({
                      ...current,
                      [employee.id]: event.target.value,
                    }))
                  }
                  placeholder="Логин"
                  value={employeeLogins[employee.id] ?? employee.login ?? ""}
                />
                {(employeeAccessRoles[employee.id] ?? accessRoleFor(employee)) === "maker" ? (
                  <select
                    onChange={(event) =>
                      setEmployeeWorkerRoles((current) => ({
                        ...current,
                        [employee.id]: event.target.value as ProductionEmployeeRole,
                      }))
                    }
                    value={employeeWorkerRoles[employee.id] ?? employee.role}
                  >
                    <option value="maker">Макетчик</option>
                    <option value="assembler">Сборщик</option>
                  </select>
                ) : null}
                <input
                  onChange={(event) =>
                    setEmployeePins((current) => ({
                      ...current,
                      [employee.id]: event.target.value,
                    }))
                  }
                  placeholder={employee.pinHash ? "Новый пароль" : "Пароль для входа"}
                  type="password"
                  value={employeePins[employee.id] || ""}
                />
                <div className="employee-access-actions">
                  <button className="secondary" onClick={() => setStaffDetailEmployeeId(employee.id)} type="button">
                    <ClipboardList size={16} />
                    Сделки
                  </button>
                  <button className="secondary" onClick={() => void saveEmployeeAccess(employee)} type="button">
                    <KeyRound size={16} />
                    Сохранить
                  </button>
                  <button
                    className="secondary"
                    disabled={employee.id === currentUser.id}
                    onClick={() => closeEmployeeAccess(employee)}
                    type="button"
                  >
                    <ShieldOff size={16} />
                    Закрыть
                  </button>
                  <button
                    className="danger"
                    disabled={employee.id === currentUser.id}
                    onClick={() => deleteEmployee(employee)}
                    type="button"
                  >
                    <Trash2 size={16} />
                    Удалить
                  </button>
                </div>
                {isProductionWorker(employee) ? (
                  <div className="employee-payout-controls">
                    <span>
                      Баланс:{" "}
                      <strong>
                        {formatMoney(
                          moneyForEmployee(
                            employee.id,
                            storedProduction.assignments,
                            storedProduction.payouts || [],
                            techSpecs,
                            calculations,
                          ).balance,
                        )}
                      </strong>
                    </span>
                    <input
                      inputMode="decimal"
                      onChange={(event) =>
                        setEmployeePayouts((current) => ({
                          ...current,
                          [employee.id]: event.target.value,
                        }))
                      }
                      placeholder="Сумма выплаты"
                      value={employeePayouts[employee.id] || ""}
                    />
                    <button className="secondary" onClick={() => addEmployeePayout(employee)} type="button">
                      Выплатить
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          {employees.length && !visibleEmployees.length ? (
            <p className="production-muted">
              В этом блоке пока нет сотрудников.
            </p>
          ) : null}
          {!employees.length ? (
            <p className="production-muted">
              Добавьте сотрудников, чтобы выдать им доступ и назначать сделки.
            </p>
          ) : null}
        </div>
        {staffDetailEmployee ? (
          <EmployeeProductionDetail
            assignments={staffDetailAssignments}
            calculations={calculations}
            dealsById={dealsById}
            employee={staffDetailEmployee}
            techSpecs={techSpecs}
            onClose={() => setStaffDetailEmployeeId("")}
            onOpenAssignment={openStaffAssignmentDeal}
          />
        ) : null}
      </div>
    );
  }

  if (mode === "employees") {
    return (
      <main
        className={`production-mobile employee-management-mobile production-theme-${theme}`}
        onTouchCancel={handleTouchEnd}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
        onTouchStart={handleTouchStart}
      >
        <PullRefreshIndicator distance={pullDistance} refreshing={pullRefreshing} />
        <header className="production-topbar">
          <div>
            <span className="eyebrow">Права доступа</span>
            <h1>Сотрудники</h1>
          </div>
          <div className="production-fixed-role">
            <UsersRound size={17} />
            {accessRoleLabels[currentAccessRole]}
          </div>
        </header>

        {notice ? <div className="production-toast">{notice}</div> : null}

        <section className="employee-management-shell">
          {renderEmployeeAccessPanel()}
        </section>
      </main>
    );
  }

  return (
    <main
      className={`production-mobile production-theme-${theme}`}
      onTouchCancel={handleTouchEnd}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
      onTouchStart={handleTouchStart}
    >
      <PullRefreshIndicator distance={pullDistance} refreshing={pullRefreshing} />
      {canSwitchProductionView ? (
        <header className="production-topbar compact">
          <div className="production-view-switch" role="tablist" aria-label="Вид производства">
            <button
              aria-selected={view === "supervisor"}
              className={view === "supervisor" ? "active" : ""}
              onClick={() => setView("supervisor")}
              type="button"
            >
              <BriefcaseBusiness size={17} />
              Начальник
            </button>
            <button
              aria-selected={view === "worker"}
              className={view === "worker" ? "active" : ""}
              onClick={() => setView("worker")}
              type="button"
            >
              <UserRound size={17} />
              Макетчик
            </button>
          </div>
        </header>
      ) : null}

      {notice ? <div className="production-toast">{notice}</div> : null}

      {installAvailable ? (
        <div className="worker-device-actions">
          <button className="secondary" onClick={onInstallApp} type="button">
            <Download size={16} />
            Установить приложение
          </button>
        </div>
      ) : null}

      {effectiveView === "supervisor" ? (
        <section className="production-layout production-only-layout">
          <section className="production-main-column">
            <section className="production-kpis" aria-label="Сводка производства">
              <ProductionKpi label="К запуску" value={productionDeals.length} />
              <ProductionKpi label="В работе" value={productionStats.inProgress} />
              <ProductionKpi label="На проверке" value={productionStats.submitted} />
              <ProductionKpi label="К отгрузке" value={productionStats.readyForShipment} />
            </section>

            <div className="production-section-tabs" role="tablist" aria-label="Сделки">
              <button
                aria-selected={supervisorTab === "active"}
                className={supervisorTab === "active" ? "active" : ""}
                onClick={() => setSupervisorTab("active")}
                type="button"
              >
                Сделки в работе
              </button>
              <button
                aria-selected={supervisorTab === "done"}
                className={supervisorTab === "done" ? "active" : ""}
                onClick={() => setSupervisorTab("done")}
                type="button"
              >
                Завершенные сделки
              </button>
            </div>

            <div className="production-batch-bar">
              <label className="search production-search">
                <Search size={18} />
                <input
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Поиск по сделке, ТЗ, макетчику"
                  value={query}
                />
              </label>
              <label className="production-select-all">
                <input
                  checked={
                    visibleSupervisorDeals.length > 0 &&
                    visibleSupervisorDeals.every((deal) => selectedDealIds.has(deal.id))
                  }
                  onChange={(event) => toggleAllVisible(event.target.checked)}
                  type="checkbox"
                />
                Все
              </label>
              <select
                disabled={!productionWorkers.length || !canAssignDeals}
                onChange={(event) => setTargetEmployeeId(event.target.value)}
                value={targetEmployeeId}
              >
                {productionWorkers.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name}
                  </option>
                ))}
              </select>
              <button
                className="primary"
                disabled={!canAssignDeals || !targetEmployeeId || !selectedDeals.length}
                onClick={assignSelectedDeals}
                type="button"
              >
                <Send size={16} />
                Назначить {selectedDeals.length || ""}
              </button>
            </div>

            <div className="production-deal-list">
              {visibleSupervisorDeals.map((deal) => {
                const currentAssignments = currentAssignmentsForDeal(storedProduction.assignments, deal.id, techSpecs.get(deal.id));
                const assignment = representativeAssignment(currentAssignments);
                const submittedAssignments = currentAssignments.filter((item) => item.status === "submitted");
                return (
                  <SupervisorDealCard
                    assignment={assignment}
                    employee={assignment ? employeesById.get(assignment.employeeId) : undefined}
                    assignmentsByPart={assignmentsByPart}
                    reviewAssignments={submittedAssignments}
                    employeesById={employeesById}
                    key={deal.id}
                    deal={deal}
                    expanded={expandedDealIds.has(deal.id)}
                    selected={selectedDealIds.has(deal.id)}
                    techSpec={techSpecs.get(deal.id)}
                    productionWorkers={productionWorkers}
                    targetEmployeeId={targetEmployeeId}
                    onAssign={() => assignSingleDeal(deal.id)}
                    onAssignPart={(itemId, employeeId) => assignDealPart(deal.id, itemId, employeeId)}
                    onStageChange={(stage) => void changeDealStage(deal, stage)}
                    onToggle={() => toggleDealExpanded(deal.id)}
                    onMarkReady={(reviewAssignment) => markReadyForShipment(reviewAssignment)}
                    onSelect={(checked) => toggleDealSelection(deal.id, checked)}
                  />
                );
              })}
              {!visibleSupervisorDeals.length ? (
                <div className="production-empty">
                  Сделки для запуска или производства не найдены.
                </div>
              ) : null}
            </div>
          </section>
        </section>
      ) : (
        <section className="production-worker-view">
          <div className="worker-mobile-brand" aria-label="Verkup">
            <span>
              <img alt="Verkup" src={`${import.meta.env.BASE_URL}verkup-logo-vector.svg`} />
            </span>
          </div>

          {selectedWorker ? (
            <WorkerProfile
              employee={selectedWorker}
              galleryCount={workerGalleryPhotos.length}
              menuOpen={profileMenuOpen}
              menuRef={profileMenuRef}
              notificationCount={unreadAssignmentCount}
              notificationDisabled={
                notificationPermission === "unsupported" ||
                (notificationPermission === "granted" && Boolean(PUSH_PUBLIC_KEY))
              }
              notificationLabel={pushButtonLabel}
              theme={theme}
              onAvatarChange={(file) => void updateEmployeeAvatar(selectedWorker, file)}
              onEnableNotifications={() => {
                setProfileMenuOpen(false);
                void enableBrowserNotifications();
              }}
              onGalleryClick={() => {
                setWorkerTab("gallery");
                setProfileMenuOpen(false);
              }}
              onLogout={onLogout}
              onMoneyClick={() => {
                setWorkerTab("money");
                setProfileMenuOpen(false);
              }}
              onMenuToggle={() => setProfileMenuOpen((current) => !current)}
              onNotificationClick={() => {
                setWorkerTab("assigned");
                setProfileMenuOpen(false);
              }}
              onPasswordClick={() => {
                setPasswordPanelOpen(true);
                setProfileMenuOpen(false);
              }}
              onToggleTheme={() => {
                setTheme((current) => (current === "night" ? "day" : "night"));
                setProfileMenuOpen(false);
              }}
            />
          ) : null}

          {passwordPanelOpen ? (
            <section className="worker-password-panel">
              <label>
                <span>Новый пароль</span>
                <input
                  autoComplete="new-password"
                  onChange={(event) => setWorkerNewPassword(event.target.value)}
                  placeholder="Минимум 4 символа"
                  type="password"
                  value={workerNewPassword}
                />
              </label>
              <div>
                <button className="primary" onClick={() => void updateCurrentWorkerPassword()} type="button">
                  <KeyRound size={16} />
                  Сохранить
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    setPasswordPanelOpen(false);
                    setWorkerNewPassword("");
                  }}
                  type="button"
                >
                  <X size={16} />
                  Закрыть
                </button>
              </div>
            </section>
          ) : null}

          {hasAssignedWorkerTasks && selectedEmployee ? (
            <div className="production-notification" role="status">
              <Bell size={18} />
              <span>
                {selectedEmployee.name}, вам назначили на сборку изделие. Откройте карточку и нажмите
                "Приступить".
              </span>
            </div>
          ) : null}

          <div className="worker-tabs" role="tablist" aria-label="Работа">
            <WorkerTabButton active={workerTab === "assigned"} count={assignmentsForWorkerTab(workerAssignments, "assigned").length} label="Назначенные сделки" onClick={() => setWorkerTab("assigned")} />
            <WorkerTabButton active={workerTab === "inProgress"} count={assignmentsForWorkerTab(workerAssignments, "inProgress").length} label="Сделки в работе" onClick={() => setWorkerTab("inProgress")} />
            <WorkerTabButton active={workerTab === "ready"} count={assignmentsForWorkerTab(workerAssignments, "ready").length} label="Готовые сделки" onClick={() => setWorkerTab("ready")} />
          </div>

          {!productionWorkers.length ? (
            <div className="production-empty">
              Руководитель еще не добавил макетчиков.
            </div>
          ) : null}

          {workerTab === "money" ? (
            <WorkerMoneyPanel money={workerMoney} payouts={storedProduction.payouts || []} workerId={selectedWorker?.id || ""} />
          ) : workerTab === "gallery" ? (
            <WorkerGalleryPanel galleryPhotos={workerGalleryPhotos} />
          ) : (
            <div className="production-deal-list">
              {workerTabAssignments.map((assignment) => {
                const deal = dealsById.get(assignment.dealId);
                if (!deal) return null;

                return (
                  <WorkerDealCard
                    assignment={assignment}
                    deal={deal}
                    diodeCatalogItems={diodeCatalogItems}
                    expanded={expandedAssignmentIds.has(assignment.id)}
                    key={assignment.id}
                    powerSupplyCatalogItems={powerSupplyCatalogItems}
                    techSpec={techSpecs.get(deal.id)}
                    onAddPhoto={(kind, file) => void addPhoto(assignment, kind, file)}
                    onRemovePhoto={(kind) => removePhoto(assignment, kind)}
                    onStart={() => startAssignment(assignment)}
                    onSubmit={() => submitAssignment(assignment)}
                    onToggle={() => openWorkerAssignment(assignment)}
                    onUpdateCompletion={(patch) => updateCompletion(assignment.id, patch)}
                    workAmount={earningForAssignment(assignment, techSpecs, calculations)}
                  />
                );
              })}
              {productionWorkers.length && !workerTabAssignments.length ? (
                <div className="production-empty">
                  Сделок в этом разделе пока нет.
                </div>
              ) : null}
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function SupervisorDealCard({
  assignment,
  assignmentsByPart,
  deal,
  employee,
  employeesById,
  expanded,
  reviewAssignments,
  selected,
  techSpec,
  productionWorkers,
  targetEmployeeId,
  onAssign,
  onAssignPart,
  onStageChange,
  onToggle,
  onMarkReady,
  onSelect,
}: {
  assignment?: ProductionAssignment;
  assignmentsByPart: Map<string, ProductionAssignment>;
  deal: Deal;
  employee?: ProductionEmployee;
  employeesById: Map<string, ProductionEmployee>;
  expanded: boolean;
  reviewAssignments: ProductionAssignment[];
  selected: boolean;
  techSpec?: DealTechSpec;
  productionWorkers: ProductionEmployee[];
  targetEmployeeId: string;
  onAssign: () => void;
  onAssignPart: (itemId: string, employeeId: string) => void;
  onStageChange: (stage: DealStageCode) => void;
  onToggle: () => void;
  onMarkReady: (assignment: ProductionAssignment) => void;
  onSelect: (checked: boolean) => void;
}) {
  const currentStage = stageCodeForDeal(deal);

  return (
    <article
      className={`production-deal-card compact ${assignment?.status || "unassigned"}`}
      data-production-deal-id={deal.id}
    >
      <div className="production-compact-row">
        <label className="production-card-check">
          <input
            checked={selected}
            onChange={(event) => onSelect(event.target.checked)}
            onClick={(event) => event.stopPropagation()}
            type="checkbox"
          />
        </label>

        <button
          aria-expanded={expanded}
          className="production-deal-summary"
          onClick={onToggle}
          type="button"
        >
          <TechSpecThumbnail spec={techSpec} />
          <div className="production-compact-info">
            <div className="production-card-title compact-title">
              <div>
                <strong>#{deal.number}</strong>
                <h2>{deal.title}</h2>
              </div>
            </div>
            <div className="production-compact-meta">
              <span>{deal.classification || "Без классификации"}</span>
              <span>Срок: {formatDate(deal.expectedFinishDate) || "не указан"}</span>
              <span>{employee?.name ? `Макетчик: ${employee.name}` : "Не назначено"}</span>
            </div>
          </div>
          <div className="production-compact-status">
            <StatusBadge status={assignment?.status} />
            <span>{expanded ? "Свернуть ТЗ" : "Открыть ТЗ"}</span>
          </div>
        </button>

        <div className="production-row-actions">
          {assignment ? (
            <div className="production-assignment-line">
              <UserRound size={16} />
              <span>
                {employee?.name || "Макетчик не найден"} · {statusLabels[assignment.status]}
              </span>
            </div>
          ) : (
            <div className="production-assignment-line muted">
              <Clock3 size={16} />
              <span>Не назначена</span>
            </div>
          )}
          <button className="secondary" disabled={!targetEmployeeId} onClick={onAssign} type="button">
            <Send size={16} />
            {assignment ? "Переназначить" : "Назначить"}
          </button>
          <select
            aria-label="Изменить стадию сделки"
            onChange={(event) => onStageChange(event.target.value as DealStageCode)}
            value={currentStage}
          >
            {(["tz", "tzApproval", "launch", "production", "defect"] as DealStageCode[]).map((stage) => (
              <option key={stage} value={stage}>
                {stageLabels[stage]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {expanded ? (
        <>
          <TechSpecInline deal={deal} spec={techSpec} expanded />
          {techSpec?.draft.items.length ? (
            <PartAssignmentPanel
              assignmentsByPart={assignmentsByPart}
              deal={deal}
              employeesById={new Map(productionWorkers.map((worker) => [worker.id, worker]))}
              productionWorkers={productionWorkers}
              spec={techSpec}
              onAssign={onAssignPart}
            />
          ) : null}
        </>
      ) : null}

      {reviewAssignments.map((reviewAssignment) => {
        const completion = completionFor(reviewAssignment);
        const reviewerEmployee = employeesById.get(reviewAssignment.employeeId);
        return (
          <div className="production-review" key={reviewAssignment.id}>
            <div className="production-review-head">
              <strong>{techSpecItemLabel(techSpec, reviewAssignment.techSpecItemId)}</strong>
              <span>{reviewerEmployee?.name || "Макетчик не найден"}</span>
            </div>
            <div className="production-result-grid">
              <span>
                Диоды
                <strong>{completion.diodeCatalogTitle || completion.diodeCatalogId || "-"}</strong>
                <em>{completion.diodeCount} шт</em>
              </span>
              <span>
                Блок
                <strong>{completion.noPowerSupply ? "Не нужен" : completion.powerSupplyCatalogTitle || completion.powerSupply || "-"}</strong>
              </span>
            </div>
            {completion.note ? <p>{completion.note}</p> : null}
            <PhotoStrip photos={photosWithAssignmentLink(reviewAssignment, deal)} />
            <button className="primary" onClick={() => onMarkReady(reviewAssignment)} type="button">
              <PackageCheck size={16} />
              Готово к отгрузке
            </button>
          </div>
        );
      })}
    </article>
  );
}

function PartAssignmentPanel({
  assignmentsByPart,
  deal,
  employeesById,
  productionWorkers,
  spec,
  onAssign,
}: {
  assignmentsByPart: Map<string, ProductionAssignment>;
  deal: Deal;
  employeesById: Map<string, ProductionEmployee>;
  productionWorkers: ProductionEmployee[];
  spec: DealTechSpec;
  onAssign: (itemId: string, employeeId: string) => void;
}) {
  if (spec.draft.items.length < 2) return null;

  return (
    <section className="part-assignment-panel">
      <h3>Исполнители по частям ТЗ</h3>
      {spec.draft.items.map((item, index) => {
        const assignment = assignmentsByPart.get(assignmentPartKey(deal.id, item.id));
        const employee = assignment ? employeesById.get(assignment.employeeId) : undefined;

        return (
          <div className="part-assignment-row" key={item.id}>
            <TechSpecThumbnail itemId={item.id} spec={spec} />
            <div>
              <strong>{techSpecItemTitle(item, index)}</strong>
              <span>{employee ? `Назначен: ${employee.name}` : "Не назначено"}</span>
            </div>
            <select
              disabled={!productionWorkers.length}
              onChange={(event) => onAssign(item.id, event.target.value)}
              value={assignment?.employeeId || ""}
            >
              <option value="" disabled>
                Выберите
              </option>
              {productionWorkers.map((worker) => (
                <option key={worker.id} value={worker.id}>
                  {worker.name}
                </option>
              ))}
            </select>
            <StatusBadge status={assignment?.status} />
          </div>
        );
      })}
    </section>
  );
}

function EmployeeProductionDetail({
  assignments,
  calculations,
  dealsById,
  employee,
  techSpecs,
  onClose,
  onOpenAssignment,
}: {
  assignments: ProductionAssignment[];
  calculations: Map<string, DealCalculation>;
  dealsById: Map<string, Deal>;
  employee: ProductionEmployee;
  techSpecs: Map<string, DealTechSpec>;
  onClose: () => void;
  onOpenAssignment: (assignment: ProductionAssignment) => void;
}) {
  const activeAssignments = assignments.filter(
    (assignment) => assignment.status === "assigned" || assignment.status === "inProgress",
  );
  const completedAssignments = assignments.filter(
    (assignment) => assignment.status === "submitted" || assignment.status === "readyForShipment",
  );

  return (
    <section className="production-panel">
      <div className="production-review-head">
        <div>
          <span className="eyebrow">Сделки сотрудника</span>
          <h2>{employee.name}</h2>
        </div>
        <button className="secondary" onClick={onClose} type="button">
          <X size={16} />
          Закрыть
        </button>
      </div>

      <div className="production-kpis" aria-label="Сводка сотрудника">
        <ProductionKpi label="Назначено" value={activeAssignments.length} />
        <ProductionKpi label="Собрано" value={completedAssignments.length} />
        <ProductionKpi label="Всего" value={assignments.length} />
      </div>

      <EmployeeAssignmentSection
        assignments={activeAssignments}
        calculations={calculations}
        dealsById={dealsById}
        emptyText="Активных назначений пока нет."
        techSpecs={techSpecs}
        title="Назначены и в работе"
        onOpenAssignment={onOpenAssignment}
      />
      <EmployeeAssignmentSection
        assignments={completedAssignments}
        calculations={calculations}
        dealsById={dealsById}
        emptyText="Собранных сделок пока нет."
        techSpecs={techSpecs}
        title="Собранные сделки"
        onOpenAssignment={onOpenAssignment}
      />
    </section>
  );
}

function EmployeeAssignmentSection({
  assignments,
  calculations,
  dealsById,
  emptyText,
  techSpecs,
  title,
  onOpenAssignment,
}: {
  assignments: ProductionAssignment[];
  calculations: Map<string, DealCalculation>;
  dealsById: Map<string, Deal>;
  emptyText: string;
  techSpecs: Map<string, DealTechSpec>;
  title: string;
  onOpenAssignment: (assignment: ProductionAssignment) => void;
}) {
  return (
    <section className="production-review">
      <div className="production-review-head">
        <strong>{title}</strong>
        <span>{assignments.length}</span>
      </div>
      <div className="production-deal-list">
        {assignments.map((assignment) => (
          <EmployeeAssignmentCard
            assignment={assignment}
            calculations={calculations}
            deal={dealsById.get(assignment.dealId)}
            key={assignment.id}
            techSpec={techSpecs.get(assignment.dealId)}
            techSpecs={techSpecs}
            onOpen={() => onOpenAssignment(assignment)}
          />
        ))}
        {!assignments.length ? <div className="production-empty">{emptyText}</div> : null}
      </div>
    </section>
  );
}

function EmployeeAssignmentCard({
  assignment,
  calculations,
  deal,
  techSpec,
  techSpecs,
  onOpen,
}: {
  assignment: ProductionAssignment;
  calculations: Map<string, DealCalculation>;
  deal?: Deal;
  techSpec?: DealTechSpec;
  techSpecs: Map<string, DealTechSpec>;
  onOpen: () => void;
}) {
  const completion = completionFor(assignment);
  const photos = photosWithAssignmentLink(assignment, deal);
  const title = deal ? `#${deal.number} ${deal.title}` : `Сделка ${assignment.dealId}`;

  return (
    <article className={`production-deal-card compact ${assignment.status}`}>
      <button
        className="production-deal-summary worker-summary"
        onClick={onOpen}
        type="button"
      >
        <TechSpecThumbnail itemId={assignment.techSpecItemId} spec={techSpec} />
        <div className="production-compact-info">
          <div className="production-card-title compact-title">
            <div>
              <strong>{title}</strong>
              <h2>{techSpecItemLabel(techSpec, assignment.techSpecItemId)}</h2>
            </div>
          </div>
          <div className="production-compact-meta">
            <span>Назначена: {formatDateTime(assignment.assignedAt)}</span>
            <span>Старт: {formatDateTime(assignment.startedAt) || "не приступил"}</span>
            <span>Время: {formatAssignmentDuration(assignment)}</span>
            <span>{deal ? `Срок: ${formatDate(deal.expectedFinishDate) || "не указан"}` : "Сделка не найдена"}</span>
          </div>
        </div>
        <div className="production-compact-status">
          <StatusBadge status={assignment.status} />
          <span>{formatMoney(earningForAssignment(assignment, techSpecs, calculations))}</span>
        </div>
      </button>

      <div className="production-result-grid">
        <span>
          Диоды
          <strong>{completion.diodeCatalogTitle || completion.diodeCatalogId || "-"}</strong>
          <em>{completion.diodeCount ? `${completion.diodeCount} шт` : "не указано"}</em>
        </span>
        <span>
          Блок
          <strong>{completion.noPowerSupply ? "Не нужен" : completion.powerSupplyCatalogTitle || completion.powerSupply || "-"}</strong>
        </span>
      </div>
      <PhotoStrip photos={photos} />
    </article>
  );
}

function PullRefreshIndicator({
  distance,
  refreshing,
}: {
  distance: number;
  refreshing: boolean;
}) {
  const visible = refreshing || distance > 0;
  const progress = Math.min(1, distance / PULL_REFRESH_TRIGGER_PX);

  return (
    <div
      aria-hidden={!visible}
      className={`production-pull-refresh${visible ? " visible" : ""}${refreshing ? " refreshing" : ""}`}
      style={{
        opacity: visible ? 1 : 0,
        transform: `translate3d(-50%, ${visible ? Math.max(18, distance) : 0}px, 0)`,
      }}
    >
      <span style={{ transform: refreshing ? undefined : `rotate(${Math.round(progress * 280)}deg)` }} />
    </div>
  );
}

function WorkerProfile({
  employee,
  galleryCount,
  menuOpen,
  menuRef,
  notificationCount,
  notificationDisabled,
  notificationLabel,
  theme,
  onAvatarChange,
  onEnableNotifications,
  onGalleryClick,
  onLogout,
  onMoneyClick,
  onMenuToggle,
  onNotificationClick,
  onPasswordClick,
  onToggleTheme,
}: {
  employee: ProductionEmployee;
  galleryCount: number;
  menuOpen: boolean;
  menuRef: RefObject<HTMLDivElement>;
  notificationCount: number;
  notificationDisabled: boolean;
  notificationLabel: string;
  theme: ProductionTheme;
  onAvatarChange: (file?: File) => void;
  onEnableNotifications: () => void;
  onGalleryClick: () => void;
  onLogout?: () => void;
  onMoneyClick: () => void;
  onMenuToggle: () => void;
  onNotificationClick: () => void;
  onPasswordClick: () => void;
  onToggleTheme: () => void;
}) {
  return (
    <section className="worker-profile">
      <label className="worker-avatar" title="Сменить фото">
        {employee.avatarDataUrl ? (
          <img alt={employee.name} src={employee.avatarDataUrl} />
        ) : (
          <span>{initials(employee.name)}</span>
        )}
        <input
          accept="image/*"
          onChange={(event) => {
            onAvatarChange(event.target.files?.[0]);
            event.target.value = "";
          }}
          type="file"
        />
      </label>
      <div className="worker-profile-main">
        <div className="worker-profile-title">
          <div>
            <h2>{employee.name}</h2>
            <span>{accessRoleLabels[accessRoleFor(employee)]}</span>
          </div>
          <div className="worker-profile-actions">
            {notificationCount ? (
              <button
                aria-label={`Новых назначений: ${notificationCount}`}
                className="worker-notification-badge"
                onClick={onNotificationClick}
                type="button"
              >
                <Bell size={18} />
                <span>{notificationCount}</span>
              </button>
            ) : null}
            <div className="worker-profile-menu-wrap" ref={menuRef}>
              <button
                aria-expanded={menuOpen}
                aria-label="Настройки профиля"
                className="worker-profile-menu-trigger"
                onClick={onMenuToggle}
                type="button"
              >
                <MoreHorizontal size={20} />
              </button>
              {menuOpen ? (
                <div className="worker-profile-menu">
                <label>
                  <Camera size={16} />
                  Сменить фото
                  <input
                    accept="image/*"
                    onChange={(event) => {
                      onAvatarChange(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                    type="file"
                  />
                </label>
                <button onClick={onPasswordClick} type="button">
                  <KeyRound size={16} />
                  Сменить пароль
                </button>
                <button onClick={onGalleryClick} type="button">
                  <Images size={16} />
                  Галерея работ
                  {galleryCount ? <em>{galleryCount}</em> : null}
                </button>
                <button onClick={onMoneyClick} type="button">
                  <Wallet size={16} />
                  Выплаты и баланс
                </button>
                <button disabled={notificationDisabled} onClick={onEnableNotifications} type="button">
                  <Bell size={16} />
                  {notificationLabel}
                </button>
                <button onClick={onToggleTheme} type="button">
                  {theme === "night" ? <Sun size={16} /> : <Moon size={16} />}
                  {theme === "night" ? "Дневная тема" : "Ночная тема"}
                </button>
                {onLogout ? (
                  <button onClick={onLogout} type="button">
                    <LogOut size={16} />
                    Выйти
                  </button>
                ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function WorkerGalleryPanel({ galleryPhotos }: { galleryPhotos: ProductionPhoto[] }) {
  return (
    <section className="production-panel">
      <div className="worker-gallery">
        {galleryPhotos.map((photo, index) => {
          const label = photo.dealNumber
            ? `Готовая работа по сделке #${photo.dealNumber}`
            : `Готовая работа ${index + 1}`;
          return (
            <img
              alt={label}
              key={`${photo.assignmentId || photo.uploadedAt}-${photo.kind}-${index}`}
              src={photo.dataUrl}
              title={label}
            />
          );
        })}
        {!galleryPhotos.length ? <span>Галерея готовых работ пока пустая</span> : null}
      </div>
    </section>
  );
}

function WorkerTabButton({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count?: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button aria-selected={active} className={active ? "active" : ""} onClick={onClick} type="button">
      {label}
      {typeof count === "number" ? <span>{count}</span> : null}
    </button>
  );
}

function WorkerMoneyPanel({
  money,
  payouts,
  workerId,
}: {
  money: WorkerMoneySummary;
  payouts: ProductionPayout[];
  workerId: string;
}) {
  const workerPayouts = payouts.filter((payout) => payout.employeeId === workerId);

  return (
    <section className="worker-money-panel">
      <div className="production-panel-head">
        <Wallet size={18} />
        <h2>Выплаты и баланс</h2>
      </div>
      <div className="worker-money-grid">
        <span>
          Начислено
          <strong>{formatMoney(money.earned)}</strong>
        </span>
        <span>
          Выплачено
          <strong>{formatMoney(money.paid)}</strong>
        </span>
        <span>
          Остаток
          <strong>{formatMoney(money.balance)}</strong>
        </span>
        <span>
          В работе
          <strong>{formatMoney(money.planned)}</strong>
        </span>
      </div>
      <div className="worker-payout-list">
        <h3>История выплат</h3>
        {workerPayouts.map((payout) => (
          <div key={payout.id}>
            <span>{formatDate(payout.paidAt)}</span>
            <strong>{formatMoney(payout.amount)}</strong>
          </div>
        ))}
        {!workerPayouts.length ? <p>Выплат пока нет.</p> : null}
      </div>
    </section>
  );
}

function TechSpecThumbnail({ itemId, spec }: { itemId?: string; spec?: DealTechSpec }) {
  const image = firstTechSpecImage(spec, itemId);

  return (
    <span className={image ? "production-thumb" : "production-thumb empty"}>
      {image ? <img alt={image.name || "Миниатюра ТЗ"} src={image.dataUrl} /> : <ClipboardList size={20} />}
    </span>
  );
}

function WorkerDealCard({
  assignment,
  deal,
  diodeCatalogItems,
  expanded,
  powerSupplyCatalogItems,
  techSpec,
  onAddPhoto,
  onRemovePhoto,
  onStart,
  onSubmit,
  onToggle,
  onUpdateCompletion,
  workAmount,
}: {
  assignment: ProductionAssignment;
  deal: Deal;
  diodeCatalogItems: CatalogItem[];
  expanded: boolean;
  powerSupplyCatalogItems: CatalogItem[];
  techSpec?: DealTechSpec;
  onAddPhoto: (kind: ProductionPhotoKind, file?: File) => void;
  onRemovePhoto: (kind: ProductionPhotoKind) => void;
  onStart: () => void;
  onSubmit: () => void;
  onToggle: () => void;
  onUpdateCompletion: (patch: Partial<ProductionCompletion>) => void;
  workAmount: number;
}) {
  const completion = completionFor(assignment);
  const canSubmit = canSubmitCompletion(completion);
  const itemLabel = assignment.techSpecItemId
    ? techSpecItemLabel(techSpec, assignment.techSpecItemId)
    : "";
  const deadlineBadge = deadlineBadgeFor(deal.expectedFinishDate);

  return (
    <article className={`production-deal-card compact worker ${assignment.status}`}>
      <button
        aria-expanded={expanded}
        className="production-deal-summary worker-summary"
        onClick={onToggle}
        type="button"
      >
        <TechSpecThumbnail itemId={assignment.techSpecItemId} spec={techSpec} />
        <div className="production-compact-info">
          <div className="production-card-title compact-title">
            <div>
              <strong>#{deal.number}</strong>
              <h2>{itemLabel || deal.title}</h2>
            </div>
          </div>
          <div className="production-compact-meta">
            <span>{deal.title}</span>
            <span>Срок: {formatDate(deal.expectedFinishDate) || "не указан"}</span>
            {workAmount > 0 ? <span>Работы: {formatMoney(workAmount)}</span> : null}
          </div>
        </div>
        <div className="production-compact-status">
          <StatusBadge status={assignment.status} />
          <span className={`production-deadline-chip ${deadlineBadge.tone}`}>{deadlineBadge.label}</span>
          <span>{expanded ? "Свернуть" : "Открыть"}</span>
        </div>
      </button>

      {expanded ? (
        <>
          <DealMeta deal={deal} />
          <TechSpecInline
            deal={deal}
            itemId={assignment.techSpecItemId}
            spec={techSpec}
            expanded
          />

          {assignment.status === "assigned" ? (
            <button className="primary production-start-button" onClick={onStart} type="button">
              <Play size={18} />
              Приступить
            </button>
          ) : null}

          {assignment.status === "inProgress" ? (
            <section className="production-completion-form">
              <div className="production-form-grid">
                <label>
                  <span>Диоды / модули*</span>
                  <select
                    onChange={(event) => {
                      const item = diodeCatalogItems.find((option) => option.id === event.target.value);
                      onUpdateCompletion({
                        diodeCatalogId: item?.id || "",
                        diodeCatalogTitle: item?.title || "",
                      });
                    }}
                    value={completion.diodeCatalogId || ""}
                  >
                    <option value="">Выберите из справочника</option>
                    {diodeCatalogItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title} - {formatMoney(item.unitCost)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Количество диодов*</span>
                  <input
                    min={0}
                    onChange={(event) =>
                      onUpdateCompletion({ diodeCount: Number(event.target.value) || 0 })
                    }
                    placeholder="Например 126"
                    type="number"
                    value={completion.diodeCount || ""}
                  />
                </label>
                <label>
                  <span>Блок питания*</span>
                  <select
                    disabled={completion.noPowerSupply}
                    onChange={(event) => {
                      const item = powerSupplyCatalogItems.find((option) => option.id === event.target.value);
                      onUpdateCompletion({
                        powerSupply: item?.title || "",
                        powerSupplyCatalogId: item?.id || "",
                        powerSupplyCatalogTitle: item?.title || "",
                      });
                    }}
                    value={completion.powerSupplyCatalogId || ""}
                  >
                    <option value="">Выберите из справочника</option>
                    {powerSupplyCatalogItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title} - {formatMoney(item.unitCost)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="production-checkbox-line">
                <input
                  checked={completion.noPowerSupply}
                  onChange={(event) =>
                    onUpdateCompletion({
                      noPowerSupply: event.target.checked,
                      powerSupply: event.target.checked ? "" : completion.powerSupply,
                      powerSupplyCatalogId: event.target.checked ? "" : completion.powerSupplyCatalogId,
                      powerSupplyCatalogTitle: event.target.checked ? "" : completion.powerSupplyCatalogTitle,
                    })
                  }
                  type="checkbox"
                />
                Блок питания не нужен
              </label>

              <div className="production-photo-grid">
                {photoSlots.map((slot) => {
                  const photo = completion.photos.find((item) => item.kind === slot.kind);
                  return (
                    <PhotoInput
                      key={slot.kind}
                      photo={photo}
                      slot={slot}
                      onChange={(file) => onAddPhoto(slot.kind, file)}
                      onRemove={() => onRemovePhoto(slot.kind)}
                    />
                  );
                })}
              </div>

              <label className="production-note-field">
                <span>Комментарий</span>
                <textarea
                  onChange={(event) => onUpdateCompletion({ note: event.target.value })}
                  placeholder="Что важно знать руководителю перед проверкой"
                  value={completion.note}
                />
              </label>

              <button className="primary production-submit-button" disabled={!canSubmit} onClick={onSubmit} type="button">
                <CheckCircle2 size={18} />
                Завершить и отправить на проверку
              </button>
            </section>
          ) : null}

          {assignment.status === "submitted" ? (
            <div className="production-state-note">
              <ClipboardList size={18} />
              Отправлено на проверку.
            </div>
          ) : null}

          {assignment.status === "readyForShipment" ? (
            <div className="production-state-note ready">
              <PackageCheck size={18} />
              Сделка готова.
            </div>
          ) : null}
        </>
      ) : null}
    </article>
  );
}

function firstTechSpecImage(spec?: DealTechSpec, itemId?: string) {
  if (!spec) return undefined;

  const items = itemId
    ? spec.draft.items.filter((item) => item.id === itemId)
    : spec.draft.items;

  for (const item of items) {
    const image = item.attachments.find((attachment) => attachment.dataUrl.startsWith("data:image"));
    if (image) return image;
  }

  return undefined;
}

function TechSpecInline({
  deal,
  itemId,
  spec,
  expanded = false,
}: {
  deal: Deal;
  itemId?: string;
  spec?: DealTechSpec;
  expanded?: boolean;
}) {
  if (!spec) {
    return (
      <section className="production-tech-spec missing">
        <ClipboardList size={16} />
        <span>ТЗ еще не прикреплено к сделке.</span>
      </section>
    );
  }

  return (
    <section className="production-tech-spec">
      <div className="production-tech-spec-head">
        <ClipboardList size={16} />
        <span>ТЗ: {spec.draft.projectName || `#${spec.draft.dealNumber}`}</span>
      </div>
      <div className="production-spec-deal-grid">
        <SpecMeta label="Сделка" value={`#${deal.number} · ${deal.title}`} />
        <SpecMeta label="Классификация" value={deal.classification} />
        <SpecMeta label="Тип" value={deal.type} />
        <SpecMeta label="Источник" value={deal.source} />
        <SpecMeta label="Ответственный" value={spec.draft.manager || deal.responsible} />
        <SpecMeta label="Телефон ответственного" value={spec.draft.responsiblePhone || deal.responsiblePhone} />
        <SpecMeta label="Срок сдачи" value={formatDate(spec.draft.deadline || deal.expectedFinishDate)} />
        <SpecMeta label="Дата ТЗ" value={formatDate(spec.draft.date)} />
      </div>
      {spec.draft.globalNote ? (
        <div className="production-spec-note">
          <strong>Общее примечание</strong>
          <p>{spec.draft.globalNote}</p>
        </div>
      ) : null}
      <div className="production-spec-items">
        {itemsForSpecDisplay(spec, itemId, expanded).map(({ item, index }) => (
          <SpecItemSummary item={item} index={index} key={item.id} />
        ))}
      </div>
      {!itemId && !expanded && spec.draft.items.length > 2 ? (
        <small>Еще изделий: {spec.draft.items.length - 2}</small>
      ) : null}
    </section>
  );
}

function itemsForSpecDisplay(spec: DealTechSpec, itemId: string | undefined, expanded: boolean) {
  const indexedItems = spec.draft.items.map((item, index) => ({ item, index }));
  const filtered = itemId ? indexedItems.filter(({ item }) => item.id === itemId) : indexedItems;
  return expanded ? filtered : filtered.slice(0, 2);
}

function SpecItemSummary({ item, index }: { item: TechSpecItem; index: number }) {
  const visibleFields = orderedTechSpecFieldIds(item)
    .map((fieldId) => [fieldId, String(item.fields[fieldId] || "").trim()] as const)
    .filter(([, value]) => value);

  return (
    <div className="production-spec-item">
      <strong>
        Изделие {index + 1}: {techSpecTemplateTitle(item.templateId)}
      </strong>
      <dl>
        {visibleFields.map(([fieldId, value]) => (
          <div key={fieldId}>
            <dt>{techSpecFieldLabel(item.templateId, fieldId)}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {item.attachments.length ? <SpecAttachmentGrid item={item} /> : null}
    </div>
  );
}

function SpecMeta({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <span>
      {label}
      <strong>{value}</strong>
    </span>
  );
}

function SpecAttachmentGrid({ item }: { item: TechSpecItem }) {
  return (
    <div className="production-spec-attachments">
      {item.attachments.map((attachment) => (
        <figure key={attachment.id}>
          {attachment.dataUrl.startsWith("data:image") ? (
            <img alt={attachment.name} src={attachment.dataUrl} />
          ) : (
            <div className="production-spec-file">
              <ClipboardList size={18} />
              <span>{attachment.type || "Файл"}</span>
            </div>
          )}
          <figcaption>
            <strong>{attachment.name}</strong>
            {attachment.note ? <span>{attachment.note}</span> : null}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function PhotoInput({
  photo,
  slot,
  onChange,
  onRemove,
}: {
  photo?: ProductionPhoto;
  slot: (typeof photoSlots)[number];
  onChange: (file?: File) => void;
  onRemove: () => void;
}) {
  return (
    <div className={photo ? "production-photo-slot filled" : "production-photo-slot"}>
      <div className="production-photo-preview">
        {photo ? (
          <>
            <img alt={slot.title} src={photo.dataUrl} />
            <button aria-label="Удалить фото" onClick={onRemove} type="button">
              <X size={15} />
            </button>
          </>
        ) : (
          <Camera size={24} />
        )}
      </div>
      <strong>{slot.title}*</strong>
      <small>{slot.hint}</small>
      <label className="secondary compact">
        <Camera size={15} />
        {photo ? "Заменить" : "Загрузить фото"}
        <input
          accept="image/jpeg,image/png,image/webp,image/*"
          onChange={(event) => {
            onChange(event.target.files?.[0]);
            event.target.value = "";
          }}
          type="file"
        />
      </label>
    </div>
  );
}

function PhotoStrip({ photos }: { photos: ProductionPhoto[] }) {
  if (!photos.length) return null;

  return (
    <div className="production-photo-strip">
      {photoSlots.map((slot) => {
        const photo = photos.find((item) => item.kind === slot.kind);
        if (!photo) return null;
        const caption = photo.dealNumber ? `#${photo.dealNumber} · ${slot.title}` : slot.title;
        return (
          <figure key={slot.kind}>
            <img alt={slot.title} src={photo.dataUrl} />
            <figcaption>{caption}</figcaption>
          </figure>
        );
      })}
    </div>
  );
}

function isWorkerDealTab(tab: WorkerTab): tab is WorkerDealTab {
  return (WORKER_DEAL_TABS as readonly WorkerTab[]).includes(tab);
}

function StatusBadge({ status }: { status?: ProductionAssignmentStatus }) {
  return (
    <span className={`production-status ${status || "unassigned"}`}>
      {status ? statusLabels[status] : "Не назначено"}
    </span>
  );
}

function DealMeta({ deal }: { deal: Deal }) {
  return (
    <div className="production-deal-meta">
      <span>{deal.classification || "Без классификации"}</span>
      <span>{deal.type || "Тип не указан"}</span>
      <span>{stageLabels[stageCodeForDeal(deal)]}</span>
      <span>Срок: {formatDate(deal.expectedFinishDate) || "не указан"}</span>
    </div>
  );
}

function ProductionKpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="production-kpi">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function buildEmployeeGroups(employees: ProductionEmployee[]): EmployeeGroup[] {
  return employeeGroupConfigs.map((config) => ({
    ...config,
    employees: employees.filter((employee) => employeeGroupIdFor(employee) === config.id),
  }));
}

function employeeGroupIdFor(employee: ProductionEmployee): EmployeeGroupId {
  const role = accessRoleFor(employee);
  if (role === "maker") return employee.role === "assembler" ? "assemblers" : "makers";
  if (role === "manager") return "managers";
  if (role === "technologist") return "technologists";
  if (role === "shopChief") return "shopChiefs";
  if (role === "leader") return "leaders";
  return "noAccess";
}

function latestAssignmentByPart(assignments: ProductionAssignment[]) {
  const map = new Map<string, ProductionAssignment>();
  for (const assignment of assignments) {
    const key = assignmentPartKey(assignment.dealId, assignment.techSpecItemId);
    const current = map.get(key);
    if (!current || Date.parse(assignment.assignedAt) >= Date.parse(current.assignedAt)) {
      map.set(key, assignment);
    }
  }
  return map;
}

function latestAssignmentIndex(assignments: ProductionAssignment[], dealId: string, techSpecItemId?: string) {
  let index = -1;
  let assignedAt = 0;
  const key = assignmentPartKey(dealId, techSpecItemId);

  assignments.forEach((assignment, currentIndex) => {
    const value = Date.parse(assignment.assignedAt) || 0;
    if (assignmentPartKey(assignment.dealId, assignment.techSpecItemId) === key && value >= assignedAt) {
      index = currentIndex;
      assignedAt = value;
    }
  });

  return index;
}

function assignmentPartKey(dealId: string, techSpecItemId?: string) {
  return `${dealId}::${techSpecItemId || "deal"}`;
}

function assignmentsForDeal(assignments: ProductionAssignment[], dealId: string) {
  return assignments.filter((assignment) => assignment.dealId === dealId);
}

function latestDealAssignment(assignments: ProductionAssignment[]) {
  return [...assignments].sort((first, second) => Date.parse(second.assignedAt) - Date.parse(first.assignedAt))[0];
}

function currentAssignmentsForDeal(
  assignments: ProductionAssignment[],
  dealId: string,
  spec?: DealTechSpec,
) {
  const byPart = latestAssignmentByPart(assignments);
  const partAssignments =
    spec && spec.draft.items.length > 1
      ? spec.draft.items
          .map((item) => byPart.get(assignmentPartKey(dealId, item.id)))
          .filter((assignment): assignment is ProductionAssignment => Boolean(assignment))
      : [];

  if (partAssignments.length) return partAssignments;

  const dealAssignment = byPart.get(assignmentPartKey(dealId));
  if (dealAssignment) return [dealAssignment];

  const latestAssignment = latestDealAssignment(assignmentsForDeal(assignments, dealId));
  return latestAssignment ? [latestAssignment] : [];
}

function isDealReadyForShipment(
  dealId: string,
  spec: DealTechSpec | undefined,
  assignments: ProductionAssignment[],
) {
  if (spec && spec.draft.items.length > 1) {
    const byPart = latestAssignmentByPart(assignments);
    const partAssignments = spec.draft.items
      .map((item) => byPart.get(assignmentPartKey(dealId, item.id)))
      .filter((assignment): assignment is ProductionAssignment => Boolean(assignment));

    if (partAssignments.length) {
      return (
        partAssignments.length === spec.draft.items.length &&
        partAssignments.every((assignment) => assignment.status === "readyForShipment")
      );
    }
  }

  const currentAssignments = currentAssignmentsForDeal(assignments, dealId, spec);
  return currentAssignments.length > 0 && currentAssignments.every((assignment) => assignment.status === "readyForShipment");
}

function representativeAssignment(assignments: ProductionAssignment[]) {
  const statusOrder: ProductionAssignmentStatus[] = ["submitted", "inProgress", "assigned", "readyForShipment"];
  for (const status of statusOrder) {
    const assignment = latestDealAssignment(assignments.filter((item) => item.status === status));
    if (assignment) return assignment;
  }
  return latestDealAssignment(assignments);
}

function assignmentsForWorkerTab(assignments: ProductionAssignment[], tab: WorkerTab) {
  if (tab === "assigned") return assignments.filter((assignment) => assignment.status === "assigned");
  if (tab === "inProgress") {
    return assignments.filter((assignment) => assignment.status === "inProgress" || assignment.status === "submitted");
  }
  if (tab === "ready") return assignments.filter((assignment) => assignment.status === "readyForShipment");
  return [];
}

function photosWithAssignmentLink(assignment: ProductionAssignment, deal?: Deal) {
  return completionFor(assignment).photos.map((photo) => ({
    ...photo,
    assignmentId: photo.assignmentId || assignment.id,
    dealId: photo.dealId || assignment.dealId,
    dealNumber: photo.dealNumber || deal?.number || "",
    dealTitle: photo.dealTitle || deal?.title || "",
    employeeId: photo.employeeId || assignment.employeeId,
    techSpecItemId: photo.techSpecItemId || assignment.techSpecItemId,
  }));
}

function galleryPhotosForWorker(assignments: ProductionAssignment[], dealsById: Map<string, Deal>) {
  return assignments
    .filter((assignment) => assignment.status === "readyForShipment")
    .flatMap((assignment) => photosWithAssignmentLink(assignment, dealsById.get(assignment.dealId)))
    .filter((photo) => photo.kind === "lit" || photo.kind === "unlit");
}

function emptyMoneySummary(): WorkerMoneySummary {
  return {
    balance: 0,
    completedCount: 0,
    earned: 0,
    paid: 0,
    planned: 0,
  };
}

function moneyForEmployee(
  employeeId: string,
  assignments: ProductionAssignment[],
  payouts: ProductionPayout[],
  techSpecs: Map<string, DealTechSpec>,
  calculations: Map<string, DealCalculation>,
): WorkerMoneySummary {
  const employeeAssignments = assignments.filter((assignment) => assignment.employeeId === employeeId);
  const completedAssignments = employeeAssignments.filter((assignment) => assignment.status === "readyForShipment");
  const plannedAssignments = employeeAssignments.filter((assignment) => assignment.status !== "readyForShipment");
  const earned = completedAssignments.reduce(
    (sum, assignment) => sum + earningForAssignment(assignment, techSpecs, calculations),
    0,
  );
  const planned = plannedAssignments.reduce(
    (sum, assignment) => sum + earningForAssignment(assignment, techSpecs, calculations),
    0,
  );
  const paid = payouts
    .filter((payout) => payout.employeeId === employeeId)
    .reduce((sum, payout) => sum + (Number(payout.amount) || 0), 0);

  return {
    balance: Math.max(0, earned - paid),
    completedCount: completedAssignments.length,
    earned,
    paid,
    planned,
  };
}

function earningForAssignment(
  assignment: ProductionAssignment,
  techSpecs: Map<string, DealTechSpec>,
  calculations: Map<string, DealCalculation>,
) {
  const spec = techSpecs.get(assignment.dealId);
  const calculation = calculations.get(assignment.dealId);
  if (!spec || !calculation) return 0;

  const items = assignment.techSpecItemId
    ? spec.draft.items.filter((item) => item.id === assignment.techSpecItemId)
    : spec.draft.items;
  const selectedIds = new Set(items.flatMap((item) => item.workCostPositionIds || []));

  return calculation.positions
    .filter((position) => selectedIds.has(position.id))
    .reduce((sum, position) => sum + positionTotal(position), 0);
}

function techSpecItemTitle(item: TechSpecItem, index: number) {
  const name = String(item.fields.name || "").trim();
  return name || `Изделие ${index + 1}: ${techSpecTemplateTitle(item.templateId)}`;
}

function techSpecItemLabel(spec: DealTechSpec | undefined, itemId?: string) {
  if (!itemId) return "Вся сделка";
  if (!spec) return "";
  const index = spec.draft.items.findIndex((item) => item.id === itemId);
  if (index < 0) return "";
  return techSpecItemTitle(spec.draft.items[index], index);
}

function compareAssignmentsByDealDeadline(
  first: ProductionAssignment,
  second: ProductionAssignment,
  dealsById: Map<string, Deal>,
) {
  const firstDeal = dealsById.get(first.dealId);
  const secondDeal = dealsById.get(second.dealId);
  if (firstDeal && secondDeal) return compareDealsByDeadline(firstDeal, secondDeal);
  if (firstDeal) return -1;
  if (secondDeal) return 1;
  return Date.parse(first.assignedAt) - Date.parse(second.assignedAt);
}

function compareDealsByDeadline(first: Deal, second: Deal) {
  const firstTime = deadlineTime(first);
  const secondTime = deadlineTime(second);
  if (firstTime !== secondTime) return firstTime - secondTime;
  return first.number.localeCompare(second.number, "ru", { numeric: true });
}

function deadlineTime(deal: Deal) {
  const time = Date.parse(deal.expectedFinishDate || "");
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

function deadlineBadgeFor(value?: string) {
  const deadline = parseDeadlineDate(value);
  if (!deadline) return { tone: "muted", label: "Срок не указан" };

  const today = startOfLocalDay(new Date());
  const deadlineDay = startOfLocalDay(deadline);
  const daysLeft = Math.ceil((deadlineDay.getTime() - today.getTime()) / 86400000);

  if (daysLeft < 0) return { tone: "red", label: `Просрочено ${Math.abs(daysLeft)} д` };
  if (daysLeft === 0) return { tone: "red", label: "Сегодня" };
  if (daysLeft <= 2) return { tone: "yellow", label: daysLeft === 1 ? "1 день" : "2 дня" };
  return { tone: "green", label: `${daysLeft} дн` };
}

function parseDeadlineDate(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const match = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (!match) return undefined;

  const day = Number(match[1]);
  const month = Number(match[2]) - 1;
  const yearValue = Number(match[3]);
  const year = yearValue < 100 ? 2000 + yearValue : yearValue;
  const date = new Date(year, month, day);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function summarizeProduction(assignments: ProductionAssignment[]) {
  return assignments.reduce(
    (acc, assignment) => {
      acc[assignment.status] += 1;
      return acc;
    },
    {
      assigned: 0,
      inProgress: 0,
      submitted: 0,
      readyForShipment: 0,
    } as Record<ProductionAssignmentStatus, number>,
  );
}

function canSubmitCompletion(completion: ProductionCompletion) {
  const photoKinds = new Set(completion.photos.map((photo) => photo.kind));
  return (
    completion.diodeCount > 0 &&
    Boolean(completion.diodeCatalogId) &&
    (completion.noPowerSupply || Boolean(completion.powerSupplyCatalogId)) &&
    photoSlots.every((slot) => photoKinds.has(slot.kind))
  );
}

function completionFor(assignment: ProductionAssignment): ProductionCompletion {
  return {
    ...emptyCompletion,
    ...assignment.completion,
    photos: assignment.completion?.photos || [],
  };
}

function completionWithCatalogItems(
  completion: ProductionCompletion,
  diodeCatalogItems: CatalogItem[],
  powerSupplyCatalogItems: CatalogItem[],
): ProductionCompletion {
  const diode = diodeCatalogItems.find((item) => item.id === completion.diodeCatalogId);
  const powerSupply = powerSupplyCatalogItems.find((item) => item.id === completion.powerSupplyCatalogId);

  return {
    ...completion,
    diodeCatalogTitle: diode?.title || completion.diodeCatalogTitle || "",
    powerSupply: completion.noPowerSupply ? "" : powerSupply?.title || completion.powerSupply || "",
    powerSupplyCatalogTitle: completion.noPowerSupply
      ? ""
      : powerSupply?.title || completion.powerSupplyCatalogTitle || "",
  };
}

function calculationWithProductionLighting(
  calculation: DealCalculation | undefined,
  assignment: ProductionAssignment,
  completion: ProductionCompletion,
  diodeCatalogItems: CatalogItem[],
  powerSupplyCatalogItems: CatalogItem[],
): DealCalculation {
  const currentCalculation: DealCalculation = calculation || {
    dealId: assignment.dealId,
    positions: [],
    updatedAt: new Date().toISOString(),
  };
  const autoIds = productionLightingPositionIds(assignment.id);
  const nextPositions = currentCalculation.positions.filter((position) => !autoIds.has(position.id));
  const diode = diodeCatalogItems.find((item) => item.id === completion.diodeCatalogId);
  const powerSupply = powerSupplyCatalogItems.find((item) => item.id === completion.powerSupplyCatalogId);

  if (diode && completion.diodeCount > 0) {
    nextPositions.unshift(catalogPositionForCompletion(assignment.id, "diodes", diode, completion.diodeCount));
  }

  if (powerSupply && !completion.noPowerSupply) {
    nextPositions.unshift(catalogPositionForCompletion(assignment.id, "power-supply", powerSupply, 1));
  }

  return {
    ...currentCalculation,
    updatedAt: new Date().toISOString(),
    positions: nextPositions,
  };
}

function catalogPositionForCompletion(
  assignmentId: string,
  kind: "diodes" | "power-supply",
  item: CatalogItem,
  qty: number,
): CostPosition {
  return {
    id: `production-${assignmentId}-${kind}`,
    section: "lighting",
    title: item.title,
    qty,
    unit: item.unit || "шт",
    unitCost: Number(item.unitCost) || 0,
    note: "Добавлено макетчиком из приложения",
    catalogId: item.id,
    calcMode: "pieces",
  };
}

function productionLightingPositionIds(assignmentId: string) {
  return new Set([
    `production-${assignmentId}-diodes`,
    `production-${assignmentId}-power-supply`,
  ]);
}

function createEvent(type: ProductionAssignmentEventType, actor: string, note?: string) {
  return {
    id: createId(),
    type,
    at: new Date().toISOString(),
    actor,
    note,
  };
}

function createId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createInviteToken() {
  const bytes = new Uint8Array(18);
  if (crypto?.getRandomValues) {
    crypto.getRandomValues(bytes);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now()}${Math.random().toString(16).slice(2)}`;
}

function registrationUrl(link: ProductionRegistrationLink) {
  const url = new URL(window.location.href);
  url.searchParams.set("mode", "production");
  url.searchParams.set("invite", link.token);
  return url.toString();
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
}

function notificationPermissionState() {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

async function showAssignmentNotification(body: string) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const options: NotificationOptions = {
    body,
    icon: `${import.meta.env.BASE_URL}verkup-mark-v3-icon-192.png`,
    badge: `${import.meta.env.BASE_URL}verkup-mark-v3-favicon-32.png`,
    data: {
      url: productionAppUrl(),
    },
    tag: "verkup-production-assignment",
  };

  if ("serviceWorker" in navigator) {
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification("Новая сборка Verkup", options);
      return;
    } catch {
      // Fall back to a regular browser notification below.
    }
  }

  new Notification("Новая сборка Verkup", options);
}

function pushSubscriptionFromBrowser(subscription: PushSubscription): ProductionPushSubscription {
  const json = subscription.toJSON();
  return {
    endpoint: subscription.endpoint,
    keys: {
      auth: json.keys?.auth,
      p256dh: json.keys?.p256dh,
    },
    subscribedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
  };
}

function mergePushSubscriptions(
  current: ProductionPushSubscription[],
  subscription: ProductionPushSubscription,
) {
  return [
    ...current.filter((item) => item.endpoint !== subscription.endpoint),
    subscription,
  ];
}

function subscriptionUsesApplicationServerKey(
  subscription: PushSubscription,
  applicationServerKey: Uint8Array,
) {
  const currentKey = subscription.options?.applicationServerKey;
  if (!currentKey) return false;

  const currentKeyBytes = new Uint8Array(currentKey);
  if (currentKeyBytes.length !== applicationServerKey.length) return false;
  return currentKeyBytes.every((byte, index) => byte === applicationServerKey[index]);
}

function removeRecordValue<T>(record: Record<string, T>, key: string) {
  const nextRecord = { ...record };
  delete nextRecord[key];
  return nextRecord;
}

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

function productionAppUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("mode", "production");
  url.searchParams.delete("invite");
  return url.toString();
}

function readNotifiedAssignmentIds(employeeId: string) {
  try {
    const value = localStorage.getItem(`${ASSIGNMENT_NOTIFICATION_STORAGE_KEY}:${employeeId}`);
    const parsed = value ? JSON.parse(value) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function writeNotifiedAssignmentIds(employeeId: string, ids: Set<string>) {
  localStorage.setItem(
    `${ASSIGNMENT_NOTIFICATION_STORAGE_KEY}:${employeeId}`,
    JSON.stringify([...ids].slice(-150)),
  );
}

function readSeenAssignmentIds(employeeId: string) {
  try {
    const value = localStorage.getItem(`${ASSIGNMENT_SEEN_STORAGE_KEY}:${employeeId}`);
    const parsed = value ? JSON.parse(value) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function writeSeenAssignmentIds(employeeId: string, ids: Set<string>) {
  localStorage.setItem(
    `${ASSIGNMENT_SEEN_STORAGE_KEY}:${employeeId}`,
    JSON.stringify([...ids].slice(-300)),
  );
}

function readStoredView(): ProductionView {
  const value = localStorage.getItem(ROLE_STORAGE_KEY);
  return value === "worker" || value === "supervisor" ? value : "supervisor";
}

function readStoredTheme(): ProductionTheme {
  const value = localStorage.getItem(THEME_STORAGE_KEY);
  return value === "night" ? "night" : "day";
}

function readStoredEmployeeId() {
  return localStorage.getItem(EMPLOYEE_STORAGE_KEY) || "";
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "?") + (parts[1]?.[0] || "");
}

function formatDateTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatAssignmentDuration(assignment: ProductionAssignment) {
  if (!assignment.startedAt) return "не начата";
  const startTime = Date.parse(assignment.startedAt);
  if (Number.isNaN(startTime)) return "не начата";
  const finishedAt =
    assignment.status === "readyForShipment"
      ? assignment.readyForShipmentAt || assignment.submittedAt
      : assignment.status === "submitted"
        ? assignment.submittedAt
        : undefined;
  const finishTime = Date.parse(finishedAt || new Date().toISOString());
  if (Number.isNaN(finishTime) || finishTime <= startTime) return "меньше минуты";

  const totalMinutes = Math.max(1, Math.floor((finishTime - startTime) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days) return `${days} д ${hours} ч`;
  if (hours) return `${hours} ч ${minutes} мин`;
  return `${minutes} мин`;
}

function formatDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU").format(date);
}

function isPowerSupplyCatalogItem(item: CatalogItem) {
  if (item.section !== "lighting" && item.section !== "consumables") return false;
  const text = catalogItemSearchText(item);
  return (
    text.includes("блок") ||
    text.includes("бп") ||
    text.includes("power supply") ||
    text.includes("sanpu") ||
    text.includes("normal ip") ||
    text.includes("light ip")
  );
}

function isDiodeCatalogItem(item: CatalogItem) {
  if (item.section !== "lighting" && item.section !== "consumables") return false;
  const text = catalogItemSearchText(item);
  if (isPowerSupplyCatalogItem(item)) return false;
  return (
    text.includes("светодиод") ||
    text.includes("модул") ||
    text.includes("лента") ||
    text.includes("led") ||
    text.includes("cob")
  );
}

function catalogItemSearchText(item: CatalogItem) {
  return [
    item.title,
    item.materialGroup,
    item.materialFamily,
    item.materialSubgroup,
    item.source,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function compareCatalogItems(first: CatalogItem, second: CatalogItem) {
  return first.title.localeCompare(second.title, "ru", { numeric: true });
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Не удалось прочитать файл"));
    reader.readAsDataURL(file);
  });
}

async function readImageFileAsDataUrl(
  file: File,
  options: { maxHeight: number; maxWidth: number; quality: number },
) {
  if (!file.type.startsWith("image/")) return readFileAsDataUrl(file);

  try {
    const image = await loadImageElement(file);
    const ratio = Math.min(
      1,
      options.maxWidth / image.naturalWidth,
      options.maxHeight / image.naturalHeight,
    );
    const width = Math.max(1, Math.round(image.naturalWidth * ratio));
    const height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return readFileAsDataUrl(file);

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", options.quality);
  } catch {
    return readFileAsDataUrl(file);
  }
}

function loadImageElement(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Image load failed"));
    };
    image.src = objectUrl;
  });
}
