import {
  Bell,
  BriefcaseBusiness,
  Camera,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  Copy,
  Download,
  KeyRound,
  Link2,
  Images,
  LogOut,
  Menu,
  Moon,
  PackageCheck,
  Play,
  Plus,
  Search,
  ShieldOff,
  Sun,
  Trash2,
  UserRound,
  UsersRound,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, RefObject, TouchEvent } from "react";
import { formatMoney, positionTotal } from "../lib/costing";
import {
  completeProductionWork,
  deleteProductionPhoto,
  markProductionNotificationRead,
  moveDealToStage,
  sendProductionPush,
  startProductionWork,
  uploadProductionPhoto,
} from "../lib/saveApi";
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
  ProductionNotification,
  ProductionNotificationType,
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
  | "installationChiefs"
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

type PhotoUploadState = {
  message?: string;
  photoUrl?: string;
  progress?: number;
  status: "idle" | "selected" | "uploading" | "success" | "error";
};

type EmployeeAccessChoice = ProductionAccessRole | "installer";

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
const HORIZONTAL_SWIPE_MIN_FLICK_PX = 24;
const HORIZONTAL_SWIPE_SLOPE = 1.25;
const HORIZONTAL_SWIPE_VELOCITY_PX_MS = 0.38;
const WORKER_DEAL_TABS: WorkerDealTab[] = ["assigned", "inProgress", "ready"];

const employeeRoleLabels: Record<ProductionEmployeeRole, string> = {
  maker: "Макетчик",
  assembler: "Монтажник",
};

const statusLabels: Record<ProductionAssignmentStatus, string> = {
  assigned: "Назначено",
  inProgress: "На сборке",
  submitted: "На проверке",
  readyForShipment: "Готово к отгрузке",
};

const employeeGroupConfigs: Array<Omit<EmployeeGroup, "employees">> = [
  { id: "makers", label: "Макетчики", description: "Сборка изделий и фотоотчеты" },
  { id: "assemblers", label: "Монтажники", description: "Выезды, монтажи и фотоотчеты" },
  { id: "installationChiefs", label: "Начальники монтажей", description: "Планирование и проверка монтажей" },
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
  const workerTabsRef = useRef<HTMLDivElement>(null);
  const workerPagerRef = useRef<HTMLDivElement>(null);
  const workerActivePageRef = useRef<HTMLDivElement>(null);
  const pullStartYRef = useRef<number | undefined>(undefined);
  const pullActivatedRef = useRef(false);
  const swipeStartXRef = useRef<number | undefined>(undefined);
  const swipeStartYRef = useRef<number | undefined>(undefined);
  const swipeLastXRef = useRef<number | undefined>(undefined);
  const swipeLastYRef = useRef<number | undefined>(undefined);
  const swipeStartTimeRef = useRef<number | undefined>(undefined);
  const swipeLastTimeRef = useRef<number | undefined>(undefined);
  const horizontalSwipeIntentRef = useRef(false);
  const [supervisorTab, setSupervisorTab] = useState<SupervisorTab>("active");
  const [workerTab, setWorkerTab] = useState<WorkerTab>("assigned");
  const [lastWorkerDealTab, setLastWorkerDealTab] = useState<WorkerDealTab>("assigned");
  const [workerSwipeOffset, setWorkerSwipeOffset] = useState(0);
  const [workerSwipeDragging, setWorkerSwipeDragging] = useState(false);
  const [workerPagerHeight, setWorkerPagerHeight] = useState<number | undefined>(undefined);
  const [workerPagerWidth, setWorkerPagerWidth] = useState(0);
  const [workerTabSegmentWidth, setWorkerTabSegmentWidth] = useState(0);
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
  const [newEmployeeAccessRole, setNewEmployeeAccessRole] = useState<EmployeeAccessChoice>("maker");
  const [newEmployeePin, setNewEmployeePin] = useState("");
  const [registrationRoles, setRegistrationRoles] = useState<Record<string, EmployeeAccessChoice>>({});
  const [registrationLogins, setRegistrationLogins] = useState<Record<string, string>>({});
  const [registrationWorkerRoles, setRegistrationWorkerRoles] = useState<
    Record<string, ProductionEmployeeRole>
  >({});
  const [registrationPins, setRegistrationPins] = useState<Record<string, string>>({});
  const [employeeAccessRoles, setEmployeeAccessRoles] = useState<Record<string, EmployeeAccessChoice>>({});
  const [employeeLogins, setEmployeeLogins] = useState<Record<string, string>>({});
  const [employeeWorkerRoles, setEmployeeWorkerRoles] = useState<Record<string, ProductionEmployeeRole>>({});
  const [employeePins, setEmployeePins] = useState<Record<string, string>>({});
  const [employeePayouts, setEmployeePayouts] = useState<Record<string, string>>({});
  const [selectedEmployeeGroupId, setSelectedEmployeeGroupId] = useState<EmployeeGroupId>("makers");
  const [staffDetailEmployeeId, setStaffDetailEmployeeId] = useState("");
  const [credentialEditorEmployeeId, setCredentialEditorEmployeeId] = useState("");
  const [notificationPermission, setNotificationPermission] = useState(() => notificationPermissionState());
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
  const [photoUploadStates, setPhotoUploadStates] = useState<Record<string, PhotoUploadState>>({});
  const [notice, setNotice] = useState("");
  const currentAccessRole = accessRoleFor(currentUser);
  const canManageStaff = canManageEmployees(currentUser);
  const canAssignDeals = canAssignProduction(currentUser);
  const canSwitchProductionView = false;
  const effectiveView = currentAccessRole === "maker" ? "worker" : "supervisor";
  const pullRefreshActive = pullRefreshing || pullDistance > 0;
  const pullProgress = Math.min(1, pullDistance / PULL_REFRESH_TRIGGER_PX);
  const pullLogoOffset = pullRefreshing
    ? 12
    : Math.round(Math.min(PULL_REFRESH_MAX_PX, pullDistance) * 0.14);
  const pullLogoScale = pullRefreshing ? 1.04 : 1 + pullProgress * 0.035;
  const pullWaveAmplitude = Math.sin(pullProgress * Math.PI) * 6;
  const pullWaveOffset = (index: number) => {
    const localProgress = Math.max(0, Math.min(1, pullProgress * 1.75 - index * 0.085));
    return `${Math.round(Math.sin(localProgress * Math.PI) * pullWaveAmplitude)}px`;
  };

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
      const done = hasSupervisorDoneAssignments(deal.id, techSpecs.get(deal.id), storedProduction.assignments);
      if (supervisorTab === "done") return done;
      return hasSupervisorActiveAssignments(deal.id, techSpecs.get(deal.id), storedProduction.assignments) || !done;
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
  const visibleNotifications = useMemo(() => {
    const notifications = storedProduction.notifications || [];
    if (currentAccessRole !== "maker") {
      return notifications;
    }

    const workerDealIds = new Set(workerAssignments.map((assignment) => assignment.dealId));
    return notifications.filter((notification) => {
      if (!notification.dealId) return true;
      return workerDealIds.has(notification.dealId);
    });
  }, [currentAccessRole, storedProduction.notifications, workerAssignments]);
  const unreadProductionNotificationCount = useMemo(
    () =>
      visibleNotifications.filter((notification) => !notification.readBy?.includes(currentUser.id)).length,
    [currentUser.id, visibleNotifications],
  );
  const totalNotificationCount = unreadAssignmentCount + unreadProductionNotificationCount;
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
  const workerDealTabAssignments = useMemo(
    () =>
      WORKER_DEAL_TABS.reduce(
        (result, tab) => ({
          ...result,
          [tab]: assignmentsForWorkerTab(workerAssignments, tab),
        }),
        {} as Record<WorkerDealTab, ProductionAssignment[]>,
      ),
    [workerAssignments],
  );
  const workerDealTabIndex = WORKER_DEAL_TABS.indexOf(
    isWorkerDealTab(workerTab) ? workerTab : lastWorkerDealTab,
  );
  const workerTabActiveShift = Math.round(workerDealTabIndex * (workerTabSegmentWidth + 6));
  const workerPageActiveShift = Math.round(-workerDealTabIndex * workerPagerWidth);
  const workerTabsStyle = {
    "--worker-tab-width": workerTabSegmentWidth ? `${workerTabSegmentWidth}px` : undefined,
  } as CSSProperties;
  const workerTabGliderStyle = {
    transform: `translate3d(${workerTabActiveShift}px, 0, 0)`,
  } as CSSProperties;
  const workerPagerStyle = {
    "--worker-pager-height": workerPagerHeight ? `${workerPagerHeight}px` : "auto",
  } as CSSProperties;
  const workerPageTrackStyle = {
    "--worker-track-shift": `${workerPageActiveShift + workerSwipeOffset}px`,
  } as CSSProperties;
  const workerTabsClassName = [
    "worker-tabs",
    `tab-index-${Math.max(0, workerDealTabIndex)}`,
    workerSwipeDragging ? "dragging" : "",
    isWorkerDealTab(workerTab) ? "" : "no-active",
  ]
    .filter(Boolean)
    .join(" ");
  const workerPagerClassName = [
    "worker-pager",
    `tab-index-${Math.max(0, workerDealTabIndex)}`,
    workerSwipeDragging ? "dragging" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const pushButtonLabel =
    notificationPermission === "unsupported"
      ? "Push недоступны"
      : notificationPermission === "granted" && PUSH_PUBLIC_KEY
        ? "Push включены"
        : notificationPermission === "granted"
          ? "Push-уведомления"
          : "Push-уведомления";

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
    const updateSwipeMetrics = () => {
      const tabsWidth = workerTabsRef.current?.clientWidth || 0;
      if (tabsWidth) {
        setWorkerTabSegmentWidth(Math.max(0, Math.round((tabsWidth - 22) / WORKER_DEAL_TABS.length)));
      }

      const pagerWidth = workerPagerRef.current?.clientWidth || 0;
      if (pagerWidth) setWorkerPagerWidth(Math.round(pagerWidth));
    };

    updateSwipeMetrics();
    window.addEventListener("resize", updateSwipeMetrics);

    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(updateSwipeMetrics);
    if (workerTabsRef.current) observer?.observe(workerTabsRef.current);
    if (workerPagerRef.current) observer?.observe(workerPagerRef.current);

    return () => {
      window.removeEventListener("resize", updateSwipeMetrics);
      observer?.disconnect();
    };
  }, [effectiveView, workerTab]);

  useEffect(() => {
    if (!isWorkerDealTab(workerTab)) {
      setWorkerPagerHeight(undefined);
      return;
    }

    const page = workerActivePageRef.current;
    if (!page) return;

    const updateHeight = () => {
      setWorkerPagerHeight(Math.ceil(page.scrollHeight));
    };

    updateHeight();
    window.addEventListener("resize", updateHeight);

    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(updateHeight);
    observer?.observe(page);

    return () => {
      window.removeEventListener("resize", updateHeight);
      observer?.disconnect();
    };
  }, [expandedAssignmentIds, workerDealTabAssignments, workerTab]);

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
    if (!canCreateAccessChoice(currentUser, newEmployeeAccessRole)) {
      setNewEmployeeAccessRole("maker");
    }
  }, [currentUser, newEmployeeAccessRole]);

  useEffect(() => {
    const accessChoice = employeeAccessChoiceForGroup(selectedEmployeeGroupId);
    if (!canCreateAccessChoice(currentUser, accessChoice)) return;
    setNewEmployeeAccessRole(accessChoice);
    setNewEmployeeRole(accessChoice === "installer" ? "assembler" : "maker");
  }, [currentUser, selectedEmployeeGroupId]);

  function applyEmployeeGroupDefaults(groupId: EmployeeGroupId) {
    const accessChoice = employeeAccessChoiceForGroup(groupId);
    if (!canCreateAccessChoice(currentUser, accessChoice)) return;
    setNewEmployeeAccessRole(accessChoice);
    setNewEmployeeRole(accessChoice === "installer" ? "assembler" : "maker");
  }

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
    const normalizedAccess = normalizeEmployeeAccessChoice(newEmployeeAccessRole, newEmployeeRole);
    if (!canCreateAccessRole(currentUser, normalizedAccess.accessRole)) return;

    const pin = newEmployeePin.trim();
    if (normalizedAccess.accessRole !== "none" && pin.length < 4) {
      setNotice("Пароль сотрудника должен быть не короче 4 символов.");
      window.setTimeout(() => setNotice(""), 2600);
      return;
    }

    const id = createId();
    const employee: ProductionEmployee = {
      id,
      name,
      login,
      role: normalizedAccess.accessRole === "maker" ? normalizedAccess.workerRole : "maker",
      accessRole: normalizedAccess.accessRole,
      phone: newEmployeePhone.trim(),
      active: true,
      createdAt: new Date().toISOString(),
      pinHash: normalizedAccess.accessRole === "none" ? undefined : await pinHashForEmployee(id, pin),
    };

    commitProduction((current) => ({
      ...current,
      employees: [...current.employees, employee],
    }), { saveNow: true });
    setNewEmployeeName("");
    setNewEmployeePhone("");
    setNewEmployeeLogin("");
    setNewEmployeePin("");
    applyEmployeeGroupDefaults(selectedEmployeeGroupId);
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
    const accessChoice = registrationRoles[request.id] || "maker";
    const normalizedAccess = normalizeEmployeeAccessChoice(
      accessChoice,
      registrationWorkerRoles[request.id] || "maker",
    );
    const accessRole = normalizedAccess.accessRole;
    const login = (registrationLogins[request.id] || request.phone || request.name).trim();
    const workerRole = normalizedAccess.workerRole;
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
    const accessChoice = employeeAccessRoles[employee.id] ?? employeeAccessChoiceFor(employee);
    const normalizedAccess = normalizeEmployeeAccessChoice(
      accessChoice,
      employeeWorkerRoles[employee.id] ?? employee.role,
    );
    const accessRole = normalizedAccess.accessRole;
    const loginDraft = employeeLogins[employee.id];
    const login = (loginDraft === undefined ? employee.login ?? employee.phone ?? employee.name : loginDraft).trim();
    const workerRole = normalizedAccess.workerRole;
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
    if (pin.length > 0 && pin.length < 4) {
      setNotice("Пароль должен быть не короче 4 символов.");
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
    setCredentialEditorEmployeeId("");
    setNotice(`Доступ сохранен: ${employee.name}`);
    window.setTimeout(() => setNotice(""), 2200);
  }

  function toggleStaffDetailEmployee(employeeId: string) {
    setStaffDetailEmployeeId((current) => (current === employeeId ? "" : employeeId));
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
    const done = hasSupervisorDoneAssignments(deal.id, techSpecs.get(deal.id), storedProduction.assignments);
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

  function addProductionNotification(
    type: ProductionNotificationType,
    assignment: ProductionAssignment,
    message: string,
  ) {
    const deal = dealsById.get(assignment.dealId);
    return {
      actorId: currentUser.id,
      actorName: currentUser.name,
      createdAt: new Date().toISOString(),
      dealId: assignment.dealId,
      dealNumber: deal?.number,
      dealTitle: deal?.title,
      id: createId(),
      message,
      readBy: [],
      type,
    } satisfies ProductionNotification;
  }

  function commitNotification(notification: ProductionNotification) {
    commitProduction((current) => ({
      ...current,
      notifications: [notification, ...(current.notifications || [])].slice(0, 200),
    }), { saveNow: true });
  }

  function markNotificationRead(notification: ProductionNotification) {
    if (notification.readBy?.includes(currentUser.id)) return;

    commitProduction((current) => ({
      ...current,
      notifications: (current.notifications || []).map((item) =>
        item.id === notification.id
          ? { ...item, readBy: [...(item.readBy || []), currentUser.id] }
          : item,
      ),
    }), { saveNow: true });

    if (saveApiUrl) {
      void markProductionNotificationRead({ apiUrl: saveApiUrl }, notification.id, currentUser.id).catch(
        () => undefined,
      );
    }
  }

  function openNotification(notification: ProductionNotification) {
    markNotificationRead(notification);
    setNotificationCenterOpen(false);
    if (notification.dealId) {
      onOpenDeal?.(notification.dealId, canAccessCosting(currentUser) ? "cost" : "techSpec");
    }
  }

  function setPhotoUploadState(
    assignmentId: string,
    kind: ProductionPhotoKind,
    state: PhotoUploadState,
  ) {
    setPhotoUploadStates((current) => ({
      ...current,
      [photoUploadStateKey(assignmentId, kind)]: state,
    }));
  }

  async function startAssignment(assignment: ProductionAssignment) {
    markAssignmentSeen(assignment.id);
    const actor = employeesById.get(assignment.employeeId)?.name || "Макетчик";
    const deal = dealsById.get(assignment.dealId);

    if (saveApiUrl) {
      try {
        const result = await startProductionWork({ apiUrl: saveApiUrl }, {
          actor,
          assignmentId: assignment.id,
          dealId: assignment.dealId,
          dealNumber: deal?.number,
          dealTitle: deal?.title,
          employeeId: assignment.employeeId,
          techSpecItemId: assignment.techSpecItemId,
        });

        if (result.updated === false) {
          throw new Error("Сервер не нашел назначение сделки. Обновите страницу и попробуйте еще раз.");
        }

        if (result.data) {
          onChange(result.data);
        } else {
          patchAssignment(assignment.id, (current) => ({
            ...current,
            status: "inProgress",
            workerStatus: "inWork",
            startedAt: current.startedAt || new Date().toISOString(),
            history: [...current.history, createEvent("started", actor)],
          }), { saveNow: false });
        }

        setNotice("Сборка начата. Руководитель увидит уведомление.");
        window.setTimeout(() => setNotice(""), 2200);
      } catch (error) {
        const message = error instanceof Error && error.message
          ? error.message
          : "Не удалось отметить старт сборки. Проверьте интернет и попробуйте еще раз.";
        setNotice(message);
        window.setTimeout(() => setNotice(""), 3200);
      }
      return;
    }

    patchAssignment(assignment.id, (current) => ({
      ...current,
      status: "inProgress",
      workerStatus: "inWork",
      startedAt: current.startedAt || new Date().toISOString(),
      history: [...current.history, createEvent("started", actor)],
    }), { saveNow: true });

    commitNotification(addProductionNotification(
      "started",
      assignment,
      `Макетчик ${actor} приступил к сборке сделки #${deal?.number || assignment.dealId}.`,
    ));
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
    const deal = dealsById.get(assignment.dealId);
    setPhotoUploadState(assignment.id, kind, {
      message: "Загружаю фото...",
      progress: 12,
      status: "uploading",
    });
    try {
      const dataUrl = await readImageFileAsDataUrl(file, {
        maxHeight: 1600,
        maxWidth: 1600,
        quality: 0.82,
      });
      setPhotoUploadState(assignment.id, kind, {
        message: "Отправляю на сервер...",
        progress: 62,
        status: "uploading",
      });

      let nextPhoto: ProductionPhoto = {
        assignmentId: assignment.id,
        dealId: assignment.dealId,
        dealNumber: deal?.number || "",
        dealTitle: deal?.title || "",
        employeeId: assignment.employeeId,
        kind,
        name: file.name,
        originalName: file.name,
        techSpecItemId: assignment.techSpecItemId,
        uploadedAt: new Date().toISOString(),
        uploadedBy: currentUser.name,
      };

      if (saveApiUrl) {
        const uploadFile = dataUrlToFile(dataUrl, file.name || `${kind}.jpg`);
        const result = await uploadProductionPhoto({ apiUrl: saveApiUrl }, {
          assignmentId: assignment.id,
          dealId: assignment.dealId,
          dealNumber: deal?.number,
          dealTitle: deal?.title,
          employeeId: assignment.employeeId,
          file: uploadFile,
          kind,
          techSpecItemId: assignment.techSpecItemId,
          uploadedBy: currentUser.name,
        });
        nextPhoto = {
          ...nextPhoto,
          ...(result.photos[0] || {}),
          dataUrl: undefined,
        };
      } else {
        nextPhoto.dataUrl = dataUrl;
      }

      const completion = completionFor(assignment);
      patchAssignment(assignment.id, (current) => ({
        ...current,
        workerStatus: "photosAdded",
        photosAddedAt: new Date().toISOString(),
        completion: {
          ...emptyCompletion,
          ...current.completion,
          photos: [
            ...completion.photos.filter((photo) => photo.kind !== kind),
            nextPhoto,
          ],
        },
      }), {
        saveNow: true,
        onSaved: () => {
          setNotice("Фото сохранено на сайте.");
          window.setTimeout(() => setNotice(""), 1800);
        },
      });
      setPhotoUploadState(assignment.id, kind, {
        message: "Фото добавлено",
        photoUrl: productionPhotoSrc(nextPhoto),
        progress: 100,
        status: "success",
      });
      commitNotification(addProductionNotification(
        "photosAdded",
        assignment,
        `По сделке #${deal?.number || assignment.dealId} добавлены фото.`,
      ));
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : "Фото не загрузилось. Выберите JPG, PNG, WebP или HEIC и попробуйте еще раз.";
      setPhotoUploadState(assignment.id, kind, {
        message,
        progress: 0,
        status: "error",
      });
      setNotice(message);
      window.setTimeout(() => setNotice(""), 2600);
    }
  }

  function removePhoto(assignment: ProductionAssignment, kind: ProductionPhotoKind) {
    const completion = completionFor(assignment);
    updateCompletion(assignment.id, {
      photos: completion.photos.filter((photo) => photo.kind !== kind),
    }, { saveNow: true });
  }

  async function deleteAssignmentPhoto(assignment: ProductionAssignment, photo: ProductionPhoto) {
    const photoId = String(photo.id || "").trim();
    const photoSrc = productionPhotoSrc(photo);

    if (!photoId && !photoSrc) return;
    if (!window.confirm("Удалить фото из сделки?")) return;

    try {
      if (saveApiUrl && photoId) {
        await deleteProductionPhoto({ apiUrl: saveApiUrl }, {
          dealId: assignment.dealId,
          photoId,
        });
      }

      patchAssignment(assignment.id, (current) => {
        const currentCompletion = completionFor(current);
        const nextPhotos = currentCompletion.photos.filter((item) => {
          if (photoId) return item.id !== photoId;
          return !(item.kind === photo.kind && productionPhotoSrc(item) === photoSrc);
        });

        return {
          ...current,
          completion: {
            ...emptyCompletion,
            ...current.completion,
            photos: nextPhotos,
          },
        };
      }, {
        saveNow: true,
        onSaved: () => {
          setNotice("Фото удалено.");
          window.setTimeout(() => setNotice(""), 1800);
        },
      });
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : "Фото не удалось удалить. Проверьте соединение и попробуйте еще раз.";
      setNotice(message);
      window.setTimeout(() => setNotice(""), 2600);
    }
  }

  async function submitAssignment(assignment: ProductionAssignment) {
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
    const deal = dealsById.get(assignment.dealId);

    try {
      if (!saveApiUrl) {
        patchAssignment(assignment.id, (current) => ({
          ...current,
          status: "submitted",
          workerStatus: "reviewPending",
          submittedAt: new Date().toISOString(),
          completion,
          history: [...current.history, createEvent("submitted", actor)],
        }), { saveNow: true });

        commitNotification(addProductionNotification(
          "completed",
          assignment,
          `Сделка #${deal?.number || assignment.dealId} завершена. Нужно проверить.`,
        ));
        setNotice("Сделка отмечена локально. Для отправки руководителю нужен серверный API.");
        window.setTimeout(() => setNotice(""), 2800);
        return;
      }

      const result = await completeProductionWork({ apiUrl: saveApiUrl }, {
        actor,
        assignmentId: assignment.id,
        completion,
        dealId: assignment.dealId,
        dealNumber: deal?.number,
        dealTitle: deal?.title,
        employeeId: assignment.employeeId,
        techSpecItemId: assignment.techSpecItemId,
      });

      if (result.updated === false) {
        throw new Error("Сервер не нашел назначение сделки. Обновите страницу и попробуйте еще раз.");
      }

      if (result.data) {
        onChange(result.data);
      } else {
        patchAssignment(assignment.id, (current) => ({
          ...current,
          status: "submitted",
          workerStatus: "reviewPending",
          submittedAt: new Date().toISOString(),
          completion,
          history: [...current.history, createEvent("submitted", actor)],
        }), { saveNow: false });
      }

      setNotice("Сделка отправлена руководителю на проверку.");
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : "Сделка не отправилась руководителю. Проверьте интернет и попробуйте еще раз.";
      setNotice(message);
    }
    window.setTimeout(() => setNotice(""), 3200);
  }

  function markReadyForShipment(assignment: ProductionAssignment) {
    const deal = dealsById.get(assignment.dealId);
    patchAssignment(assignment.id, (current) => ({
      ...current,
      status: "readyForShipment",
      workerStatus: "checked",
      readyForShipmentAt: new Date().toISOString(),
      history: [...current.history, createEvent("readyForShipment", "Руководитель")],
    }), { saveNow: true });
    commitNotification(addProductionNotification(
      "checked",
      assignment,
      `Сделка #${deal?.number || assignment.dealId} проверена.`,
    ));
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
      swipeStartTimeRef.current = performance.now();
      swipeLastTimeRef.current = swipeStartTimeRef.current;
      horizontalSwipeIntentRef.current = false;
      resetWorkerSwipeFeedback();
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
      swipeLastTimeRef.current = performance.now();
    }

    if (shouldTreatAsHorizontalSwipe()) {
      horizontalSwipeIntentRef.current = true;
      pullStartYRef.current = undefined;
      pullActivatedRef.current = false;
      setPullDistance(0);
      updateWorkerSwipeFeedback();
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
    clearWorkerSwipeRefs();
    resetWorkerSwipeFeedback();
  }

  function clearWorkerSwipeRefs() {
    swipeStartXRef.current = undefined;
    swipeStartYRef.current = undefined;
    swipeLastXRef.current = undefined;
    swipeLastYRef.current = undefined;
    swipeStartTimeRef.current = undefined;
    swipeLastTimeRef.current = undefined;
    horizontalSwipeIntentRef.current = false;
  }

  function resetWorkerSwipeFeedback() {
    setWorkerSwipeDragging(false);
    setWorkerSwipeOffset(0);
  }

  function updateWorkerSwipeFeedback() {
    const startX = swipeStartXRef.current;
    const lastX = swipeLastXRef.current;
    if (startX === undefined || lastX === undefined) return;

    const deltaX = lastX - startX;
    if (!isWorkerDealTab(workerTab) && !(workerTab === "money" && deltaX > 0)) return;

    const pageWidth = workerPagerRef.current?.clientWidth || workerTabsRef.current?.clientWidth || 360;
    const currentDealTab = isWorkerDealTab(workerTab) ? workerTab : lastWorkerDealTab;
    const currentIndex = WORKER_DEAL_TABS.indexOf(currentDealTab);
    const isEdgeSwipe =
      (currentIndex <= 0 && deltaX > 0) ||
      (currentIndex >= WORKER_DEAL_TABS.length - 1 && deltaX < 0);
    const resistance = isEdgeSwipe ? 0.28 : 0.96;
    const offset = Math.max(-pageWidth, Math.min(pageWidth, deltaX * resistance));

    setWorkerSwipeDragging(true);
    setWorkerSwipeOffset(Math.round(offset));
  }

  function selectWorkerDealTab(tab: WorkerDealTab) {
    resetWorkerSwipeFeedback();
    setLastWorkerDealTab(tab);
    setWorkerTab(tab);
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
    const startTime = swipeStartTimeRef.current;
    const lastTime = swipeLastTimeRef.current;
    const wasHorizontal = horizontalSwipeIntentRef.current;
    clearWorkerSwipeRefs();

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
    const elapsedMs = Math.max(1, (lastTime || performance.now()) - (startTime || performance.now()));
    const velocity = Math.abs(deltaX) / elapsedMs;
    const pageWidth = workerPagerRef.current?.clientWidth || workerTabsRef.current?.clientWidth || 360;
    const triggerDistance = Math.min(110, Math.max(HORIZONTAL_SWIPE_TRIGGER_PX, pageWidth * 0.22));
    const isHorizontal =
      wasHorizontal ||
      (Math.abs(deltaX) > 12 &&
        Math.abs(deltaX) > Math.abs(deltaY) * HORIZONTAL_SWIPE_SLOPE);
    if (!isHorizontal) {
      resetWorkerSwipeFeedback();
      return false;
    }

    if (
      (Math.abs(deltaX) < triggerDistance &&
        (Math.abs(deltaX) < HORIZONTAL_SWIPE_MIN_FLICK_PX ||
          velocity < HORIZONTAL_SWIPE_VELOCITY_PX_MS)) ||
      Math.abs(deltaX) < Math.abs(deltaY) * HORIZONTAL_SWIPE_SLOPE
    ) {
      resetWorkerSwipeFeedback();
      return true;
    }

    if (workerTab === "money" && deltaX > 0) {
      setWorkerTab(lastWorkerDealTab);
      resetWorkerSwipeFeedback();
      return true;
    }

    if (!isWorkerDealTab(workerTab)) {
      resetWorkerSwipeFeedback();
      return true;
    }

    const currentIndex = WORKER_DEAL_TABS.indexOf(workerTab);
    const nextIndex = deltaX < 0 ? currentIndex + 1 : currentIndex - 1;
    const nextTab = WORKER_DEAL_TABS[nextIndex];
    if (nextTab) {
      setWorkerTab(nextTab);
    }
    resetWorkerSwipeFeedback();
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
      await new Promise<void>((resolve) => window.setTimeout(resolve, 260));
      setPullRefreshing(false);
      setPullDistance(0);
    }
  }

  function renderWorkerDealList(assignments: ProductionAssignment[]) {
    return (
      <div className="production-deal-list">
        {assignments.map((assignment) => {
          const deal = dealsById.get(assignment.dealId);
          if (!deal) return null;

          return (
            <WorkerDealCard
              assignment={assignment}
              deal={deal}
              diodeCatalogItems={diodeCatalogItems}
              expanded={expandedAssignmentIds.has(assignment.id)}
              key={assignment.id}
              photoUploadStates={photoSlots.reduce((states, slot) => ({
                ...states,
                [slot.kind]: photoUploadStates[photoUploadStateKey(assignment.id, slot.kind)],
              }), {} as Partial<Record<ProductionPhotoKind, PhotoUploadState>>)}
              powerSupplyCatalogItems={powerSupplyCatalogItems}
              techSpec={techSpecs.get(deal.id)}
              onAddPhoto={(kind, file) => void addPhoto(assignment, kind, file)}
              onRemovePhoto={(kind) => removePhoto(assignment, kind)}
              onStart={() => startAssignment(assignment)}
              onSubmit={() => void submitAssignment(assignment)}
              onToggle={() => openWorkerAssignment(assignment)}
              onUpdateCompletion={(patch) => updateCompletion(assignment.id, patch)}
            />
          );
        })}
        {productionWorkers.length && !assignments.length ? (
          <div className="production-empty">
            Сделок в этом разделе пока нет.
          </div>
        ) : null}
      </div>
    );
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
                type="button"
              >
                <Copy size={16} />
              </button>
              <button
                className="icon-button"
                onClick={() => revokeRegistrationLink(link.id)}
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
                        [request.id]: event.target.value as EmployeeAccessChoice,
                      }))
                    }
                    value={selectedAccessRole}
                  >
                    {employeeAccessChoiceOptions(false)
                      .filter((choice) => canCreateAccessChoice(currentUser, choice))
                      .map((choice) => (
                        <option key={choice} value={choice}>
                          {employeeAccessChoiceLabel(choice)}
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
            onChange={(event) => {
              const choice = event.target.value as EmployeeAccessChoice;
              setNewEmployeeAccessRole(choice);
              setNewEmployeeRole(choice === "installer" ? "assembler" : "maker");
            }}
            value={newEmployeeAccessRole}
          >
            {employeeAccessChoiceOptions(true)
              .filter((choice) => canCreateAccessChoice(currentUser, choice))
              .map((choice) => (
                <option key={choice} value={choice}>
                  {employeeAccessChoiceLabel(choice)}
                </option>
              ))}
          </select>
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
              onClick={() => {
                setSelectedEmployeeGroupId(group.id);
                applyEmployeeGroupDefaults(group.id);
                setStaffDetailEmployeeId("");
                setCredentialEditorEmployeeId("");
              }}
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
          {visibleEmployees.map((employee) => {
            const credentialsOpen = credentialEditorEmployeeId === employee.id;

            return (
              <div
                className={`production-employee-row employee-admin-row${credentialsOpen ? " credentials-open" : ""}`}
                key={employee.id}
              >
                <button
                  className="employee-row-summary"
                  onClick={() => toggleStaffDetailEmployee(employee.id)}
                  type="button"
                >
                  <span className="employee-row-avatar">{initials(employee.name)}</span>
                  <div>
                    <strong>{employee.name}</strong>
                    <small>
                      {employeeAccessChoiceLabel(employeeAccessChoiceFor(employee))}
                      {employee.login ? ` · ${employee.login}` : ""}
                      {employee.phone ? ` · ${employee.phone}` : ""}
                    </small>
                  </div>
                </button>
                <div className="employee-access-controls">
                  <select
                    aria-label={`Роль ${employee.name}`}
                    onChange={(event) =>
                      setEmployeeAccessRoles((current) => ({
                        ...current,
                        [employee.id]: event.target.value as EmployeeAccessChoice,
                      }))
                    }
                    value={employeeAccessRoles[employee.id] ?? employeeAccessChoiceFor(employee)}
                  >
                    {employeeAccessChoiceOptions(true)
                      .filter((choice) => canCreateAccessChoice(currentUser, choice))
                      .map((choice) => (
                        <option key={choice} value={choice}>
                          {employeeAccessChoiceLabel(choice)}
                        </option>
                      ))}
                  </select>
                  <div className="employee-access-actions">
                    <button className="secondary" onClick={() => toggleStaffDetailEmployee(employee.id)} type="button">
                      <ClipboardList size={16} />
                      Сделки
                    </button>
                    <button
                      aria-expanded={credentialsOpen}
                      className="secondary employee-credential-toggle"
                      onClick={() =>
                        setCredentialEditorEmployeeId((current) => (current === employee.id ? "" : employee.id))
                      }
                      type="button"
                    >
                      <KeyRound size={16} />
                      Сменить логин/пароль
                    </button>
                    <button className="secondary" onClick={() => void saveEmployeeAccess(employee)} type="button">
                      <CheckCircle2 size={16} />
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
                  {credentialsOpen ? (
                    <div className="employee-credentials-panel">
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
                    </div>
                  ) : null}
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
            );
          })}
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
            onDeletePhoto={deleteAssignmentPhoto}
            onOpenAssignment={openStaffAssignmentDeal}
          />
        ) : null}
      </div>
    );
  }

  if (mode === "employees") {
    return (
      <main className={`production-mobile employee-management-mobile production-theme-${theme}`}>
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
      className={`production-mobile production-theme-${theme}${pullRefreshActive ? " pull-refresh-active" : ""}${pullRefreshing ? " pull-refreshing" : ""}`}
      onTouchCancel={handleTouchEnd}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
      onTouchStart={handleTouchStart}
      style={{
        "--pull-progress": pullProgress,
        "--pull-logo-y": `${pullLogoOffset}px`,
        "--pull-logo-scale": pullLogoScale,
        "--pull-wave-1": pullWaveOffset(0),
        "--pull-wave-2": pullWaveOffset(1),
        "--pull-wave-3": pullWaveOffset(2),
        "--pull-wave-4": pullWaveOffset(3),
        "--pull-wave-5": pullWaveOffset(4),
        "--pull-wave-6": pullWaveOffset(5),
        "--pull-wave-7": pullWaveOffset(6),
        "--pull-wave-8": pullWaveOffset(7),
        "--pull-wave-9": pullWaveOffset(8),
        "--pull-wave-10": pullWaveOffset(9),
      } as CSSProperties}
    >
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
            <section className="workspace-page-hero production-page-hero">
              <span className="eyebrow">Производство</span>
              <h1>Сборка и фотоотчеты</h1>
              <p>Назначение макетчиков, контроль готовности и проверка выполненных сделок.</p>
            </section>
            <section className="production-kpis" aria-label="Сводка производства">
              <ProductionKpi label="К запуску" value={productionDeals.length} />
              <ProductionKpi label="На сборке" value={productionStats.inProgress} />
              <ProductionKpi label="На проверке" value={productionStats.submitted} />
              <ProductionKpi label="Готово к отгрузке" value={productionStats.readyForShipment} />
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
                На проверке
              </button>
            </div>

            <div className="production-batch-bar production-search-row">
              <label className="search production-search">
                <Search size={18} />
                <input
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Поиск по сделке, ТЗ, макетчику"
                  value={query}
                />
              </label>
            </div>

            <div className="production-deal-list">
              {visibleSupervisorDeals.map((deal) => {
                const currentAssignments = currentAssignmentsForDeal(storedProduction.assignments, deal.id, techSpecs.get(deal.id));
                const assignment = representativeAssignment(currentAssignments);
                const reviewAssignments = currentAssignments.filter(
                  (item) => item.status === "submitted" || item.status === "readyForShipment",
                );
                return (
                  <SupervisorDealCard
                    assignment={assignment}
                    employee={assignment ? employeesById.get(assignment.employeeId) : undefined}
                    assignmentsByPart={assignmentsByPart}
                    reviewAssignments={reviewAssignments}
                    employeesById={employeesById}
                    key={deal.id}
                    deal={deal}
                    expanded={expandedDealIds.has(deal.id)}
                    techSpec={techSpecs.get(deal.id)}
                    productionWorkers={productionWorkers}
                    onAssignPart={(itemId, employeeId) => assignDealPart(deal.id, itemId, employeeId)}
                    onStageChange={(stage) => void changeDealStage(deal, stage)}
                    onToggle={() => toggleDealExpanded(deal.id)}
                    onDeletePhoto={(reviewAssignment, photo) => void deleteAssignmentPhoto(reviewAssignment, photo)}
                    onMarkReady={(reviewAssignment) => markReadyForShipment(reviewAssignment)}
                    onOpenDeal={
                      canAccessCosting(currentUser) && onOpenDeal
                        ? () => onOpenDeal(deal.id, "techSpec")
                        : undefined
                    }
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
              <VerkupMobileLogo className="worker-mobile-logo" />
            </span>
          </div>

          {selectedWorker ? (
            <WorkerProfile
              employee={selectedWorker}
              galleryCount={workerGalleryPhotos.length}
              menuOpen={profileMenuOpen}
              menuRef={profileMenuRef}
              notificationCount={totalNotificationCount}
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
                resetWorkerSwipeFeedback();
                setWorkerTab("gallery");
                setProfileMenuOpen(false);
              }}
              onLogout={onLogout}
              onMoneyClick={() => {
                resetWorkerSwipeFeedback();
                setWorkerTab("money");
                setProfileMenuOpen(false);
              }}
              onMenuToggle={() => setProfileMenuOpen((current) => !current)}
              onNotificationClick={() => {
                selectWorkerDealTab("assigned");
                if (visibleNotifications.length) {
                  setNotificationCenterOpen((current) => !current);
                }
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

          {notificationCenterOpen ? (
            <ProductionNotificationCenter
              currentUserId={currentUser.id}
              notifications={visibleNotifications}
              onClose={() => setNotificationCenterOpen(false)}
              onOpen={openNotification}
              onRead={markNotificationRead}
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

          <div
            className={workerTabsClassName}
            ref={workerTabsRef}
            role="tablist"
            aria-label="Сборка"
            style={workerTabsStyle}
          >
            <span className="worker-tab-glider" aria-hidden="true" style={workerTabGliderStyle} />
            <div className="worker-tab-rail">
              <WorkerTabButton active={workerTab === "assigned"} count={workerDealTabAssignments.assigned.length} label="Новые" onClick={() => selectWorkerDealTab("assigned")} />
              <WorkerTabButton active={workerTab === "inProgress"} count={workerDealTabAssignments.inProgress.length} label="Сборка" onClick={() => selectWorkerDealTab("inProgress")} />
              <WorkerTabButton active={workerTab === "ready"} count={workerDealTabAssignments.ready.length} label="Готово" onClick={() => selectWorkerDealTab("ready")} />
            </div>
          </div>

          {!productionWorkers.length ? (
            <div className="production-empty">
              Руководитель еще не добавил макетчиков.
            </div>
          ) : null}

          <div className="worker-tab-content">
            {workerTab === "money" ? (
              <WorkerMoneyPanel money={workerMoney} payouts={storedProduction.payouts || []} workerId={selectedWorker?.id || ""} />
            ) : workerTab === "gallery" ? (
              <WorkerGalleryPanel galleryPhotos={workerGalleryPhotos} />
            ) : (
              <div
                className={workerPagerClassName}
                ref={workerPagerRef}
                style={workerPagerStyle}
              >
                <div className="worker-page-track" style={workerPageTrackStyle}>
                  {WORKER_DEAL_TABS.map((tab, index) => (
                    <div
                      aria-hidden={workerTab !== tab}
                      className={`worker-page${workerTab === tab ? " active" : ""}`}
                      key={tab}
                      ref={workerTab === tab ? workerActivePageRef : undefined}
                      style={{ "--worker-page-x": `${index * 100}%` } as CSSProperties}
                    >
                      <div className="worker-page-inner">
                        {renderWorkerDealList(workerDealTabAssignments[tab])}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
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
  techSpec,
  productionWorkers,
  onAssignPart,
  onDeletePhoto,
  onStageChange,
  onToggle,
  onMarkReady,
  onOpenDeal,
}: {
  assignment?: ProductionAssignment;
  assignmentsByPart: Map<string, ProductionAssignment>;
  deal: Deal;
  employee?: ProductionEmployee;
  employeesById: Map<string, ProductionEmployee>;
  expanded: boolean;
  reviewAssignments: ProductionAssignment[];
  techSpec?: DealTechSpec;
  productionWorkers: ProductionEmployee[];
  onAssignPart: (itemId: string, employeeId: string) => void;
  onDeletePhoto: (assignment: ProductionAssignment, photo: ProductionPhoto) => void;
  onStageChange: (stage: DealStageCode) => void;
  onToggle: () => void;
  onMarkReady: (assignment: ProductionAssignment) => void;
  onOpenDeal?: () => void;
}) {
  const currentStage = stageCodeForDeal(deal);

  return (
    <article
      className={`production-deal-card compact ${assignment?.status || "unassigned"}`}
      data-production-deal-id={deal.id}
    >
      <div className="production-compact-row">
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
          {onOpenDeal ? (
            <button className="secondary production-toggle-tech-spec" onClick={onOpenDeal} type="button">
              Перейти в ТЗ
            </button>
          ) : null}
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
            <PhotoStrip
              canDelete={reviewAssignment.status === "readyForShipment"}
              photos={photosWithAssignmentLink(reviewAssignment, deal)}
              onDeletePhoto={(photo) => onDeletePhoto(reviewAssignment, photo)}
            />
            {reviewAssignment.status === "readyForShipment" ? (
              <span className="production-review-ready">
                <PackageCheck size={16} />
                Готово к отгрузке
              </span>
            ) : (
            <button className="primary" onClick={() => onMarkReady(reviewAssignment)} type="button">
              <PackageCheck size={16} />
              Готово к отгрузке
            </button>
            )}
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
  return (
    <section className="part-assignment-panel">
      <h3>Назначение по изделиям</h3>
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
  onDeletePhoto,
  onOpenAssignment,
}: {
  assignments: ProductionAssignment[];
  calculations: Map<string, DealCalculation>;
  dealsById: Map<string, Deal>;
  employee: ProductionEmployee;
  techSpecs: Map<string, DealTechSpec>;
  onClose: () => void;
  onDeletePhoto: (assignment: ProductionAssignment, photo: ProductionPhoto) => void;
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
        onDeletePhoto={onDeletePhoto}
        onOpenAssignment={onOpenAssignment}
      />
      <EmployeeAssignmentSection
        assignments={completedAssignments}
        calculations={calculations}
        dealsById={dealsById}
        emptyText="Собранных сделок пока нет."
        techSpecs={techSpecs}
        title="Собранные сделки"
        onDeletePhoto={onDeletePhoto}
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
  onDeletePhoto,
  onOpenAssignment,
}: {
  assignments: ProductionAssignment[];
  calculations: Map<string, DealCalculation>;
  dealsById: Map<string, Deal>;
  emptyText: string;
  techSpecs: Map<string, DealTechSpec>;
  title: string;
  onDeletePhoto: (assignment: ProductionAssignment, photo: ProductionPhoto) => void;
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
            onDeletePhoto={(photo) => onDeletePhoto(assignment, photo)}
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
  onDeletePhoto,
  onOpen,
}: {
  assignment: ProductionAssignment;
  calculations: Map<string, DealCalculation>;
  deal?: Deal;
  techSpec?: DealTechSpec;
  techSpecs: Map<string, DealTechSpec>;
  onDeletePhoto: (photo: ProductionPhoto) => void;
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
      <PhotoStrip
        canDelete={assignment.status === "readyForShipment"}
        photos={photos}
        onDeletePhoto={onDeletePhoto}
      />
    </article>
  );
}

function VerkupMobileLogo({ className }: { className: string }) {
  return (
    <svg
      aria-label="Verkup"
      className={className}
      role="img"
      viewBox="-1 -1 546 120"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform="translate(0 117.6284) scale(1 -1)">
        <path className="verkup-logo-piece logo-wave-1" fill="#ff7500" d="M 140.2427 90.6313 L 121.1108 90.6313 L 90.4986 1.2515 L 109.6305 1.2515 Z" />
        <path className="verkup-logo-piece logo-wave-2" fill="#ff7500" d="M 84.3738 71.4141 L 108.4039 1.2515 L 89.2721 1.2515 L 68.9315 60.6407 C 72.8082 63.1188 79.6830 68.0179 84.3738 71.4141" />
        <path className="verkup-logo-piece logo-wave-3" fill="#7a3800" d="M 54.8765 52.6127 L 72.4674 1.2515 L 53.3356 1.2515 L 38.3406 45.0340 C 43.9994 47.3185 49.4884 49.8294 54.8765 52.6127" />
        <path className="verkup-logo-piece logo-wave-4" fill="#351800" d="M 23.3844 39.6363 L 36.5309 1.2515 L 17.3991 1.2515 L 5.9474 34.6884 C 11.9965 36.2001 17.7902 37.8369 23.3844 39.6363" />
        <path className="verkup-logo-piece logo-wave-5" fill="#ff7500" d="M 67.1998 99.0873 L 59.4884 106.7984 L 101.1634 117.6284 L 90.3336 75.9535 L 82.6226 83.6646 C 59.8581 65.5835 37.1843 53.2755 0.0000 44.4073 C 34.7632 65.8001 51.2399 74.5302 67.1998 99.0873" />
        <path className="verkup-logo-piece logo-wave-6" fill="#ff7500" d="M 202.9380 1.2515 L 151.4673 1.2515 L 151.4673 90.6313 L 202.9380 90.6313 L 202.9380 75.1085 L 170.4115 75.1085 L 170.4115 55.4553 L 200.6634 55.4553 L 200.6634 39.9328 L 170.4115 39.9328 L 170.4115 16.8996 L 202.9380 16.8996 Z" />
        <path className="verkup-logo-piece logo-wave-7" fill="#ff7500" d="M 240.5129 35.5516 L 240.5129 1.2515 L 221.5687 1.2515 L 221.5687 90.6313 L 247.6069 90.6313 C 259.7494 90.6313 268.7207 88.4197 274.5417 83.9968 C 280.3836 79.5739 283.2831 72.8555 283.2831 63.8634 C 283.2831 58.6057 281.8440 53.9320 278.9439 49.8220 C 276.0644 45.7330 271.9755 42.5200 266.6758 40.2041 C 280.1123 20.1127 288.8751 7.1141 292.9433 1.2515 L 271.9128 1.2515 L 250.5903 35.5516 Z M 240.5129 50.9488 L 246.6264 50.9488 C 252.6140 50.9488 257.0372 51.9500 259.8746 53.9529 C 262.7325 55.9349 264.1513 59.0856 264.1513 63.3626 C 264.1513 67.5978 262.6911 70.6229 259.7910 72.4173 C 256.8702 74.2119 252.3637 75.1085 246.2505 75.1085 L 240.5129 75.1085 Z" />
        <path className="verkup-logo-piece logo-wave-8" fill="#ff7500" d="M 376.0843 1.2515 L 354.5745 1.2515 L 331.1654 38.9106 L 323.1539 33.1727 L 323.1539 1.2515 L 304.2099 1.2515 L 304.2099 90.6313 L 323.1539 90.6313 L 323.1539 49.7387 L 330.6229 60.2541 L 354.8038 90.6313 L 375.8340 90.6313 L 344.6850 51.0741 Z" />
        <path className="verkup-logo-piece logo-wave-9" fill="#ff7500" d="M 460.0814 90.6313 L 460.0814 32.7767 C 460.0814 26.1836 458.6000 20.3834 455.6582 15.4182 C 452.6957 10.4318 448.4395 6.6345 442.8482 3.9849 C 437.2563 1.3351 430.6637 0.0000 423.0278 0.0000 C 411.5529 0.0000 402.6234 2.9415 396.2597 8.8461 C 389.8964 14.7294 386.7250 22.7829 386.7250 33.0270 L 386.7250 90.6313 L 405.6066 90.6313 L 405.6066 35.9065 C 405.6066 29.0004 407.0044 23.9513 409.7585 20.7383 C 412.5334 17.5045 417.1232 15.8978 423.5284 15.8978 C 429.7249 15.8978 434.2105 17.5255 437.0060 20.7592 C 439.8021 23.9930 441.1996 29.0837 441.1996 36.0105 L 441.1996 90.6313 Z" />
        <path className="verkup-logo-piece logo-wave-10" fill="#ff7500" d="M 543.6816 62.7576 C 543.6816 53.1391 540.6775 45.7744 534.6686 40.6837 C 528.6603 35.5929 520.1059 33.0480 509.0275 33.0480 L 500.8907 33.0480 L 500.8907 1.2515 L 481.9465 1.2515 L 481.9465 90.6313 L 510.4879 90.6313 C 521.3367 90.6313 529.5779 88.2947 535.2321 83.6422 C 540.8651 78.9687 543.6816 72.0000 543.6816 62.7576 Z M 500.8907 48.5705 L 507.1289 48.5705 C 512.9705 48.5705 517.3311 49.7177 520.2105 52.0336 C 523.1103 54.3285 524.5498 57.6876 524.5498 62.0901 C 524.5498 66.5340 523.3397 69.8094 520.9197 71.9376 C 518.4992 74.0446 514.7022 75.1085 509.5071 75.1085 L 500.8907 75.1085 Z" />
      </g>
    </svg>
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
      <label className="worker-avatar" aria-label="Сменить фото">
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
            <span>{employeeAccessChoiceLabel(employeeAccessChoiceFor(employee))}</span>
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
                <Menu size={20} />
              </button>
              {menuOpen ? (
                <div className="worker-profile-menu">
                <label>
                  <Camera size={16} />
                  <span>Фото</span>
                  <ChevronRight className="worker-menu-chevron" size={16} />
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
                  <span>Пароль</span>
                  <ChevronRight className="worker-menu-chevron" size={16} />
                </button>
                <button onClick={onGalleryClick} type="button">
                  <Images size={16} />
                  <span>Галерея работ</span>
                  {galleryCount ? <em>{galleryCount}</em> : null}
                  <ChevronRight className="worker-menu-chevron" size={16} />
                </button>
                <button onClick={onMoneyClick} type="button">
                  <Wallet size={16} />
                  <span>Выплаты</span>
                  <ChevronRight className="worker-menu-chevron" size={16} />
                </button>
                <button disabled={notificationDisabled} onClick={onEnableNotifications} type="button">
                  <Bell size={16} />
                  <span>{notificationLabel}</span>
                </button>
                <button onClick={onToggleTheme} type="button">
                  {theme === "night" ? <Sun size={16} /> : <Moon size={16} />}
                  <span>{theme === "night" ? "Светлая тема" : "Тёмная тема"}</span>
                </button>
                {onLogout ? (
                  <button className="worker-menu-danger" onClick={onLogout} type="button">
                    <LogOut size={16} />
                    <span>Выйти</span>
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
  const [galleryQuery, setGalleryQuery] = useState("");
  const [viewer, setViewer] = useState<{
    index: number;
    photos: ProductionPhoto[];
    title: string;
  } | null>(null);
  const dealGroups = useMemo(() => {
    const query = galleryQuery.trim().toLowerCase();
    const groups = new Map<
      string,
      {
        dealId: string;
        dealNumber: string;
        dealTitle: string;
        photos: ProductionPhoto[];
      }
    >();

    galleryPhotos.forEach((photo) => {
      const dealId = photo.dealId || photo.dealNumber || "unknown";
      const current = groups.get(dealId) || {
        dealId,
        dealNumber: photo.dealNumber || "",
        dealTitle: photo.dealTitle || "",
        photos: [],
      };
      current.dealNumber ||= photo.dealNumber || "";
      current.dealTitle ||= photo.dealTitle || "";
      current.photos.push(photo);
      groups.set(dealId, current);
    });

    return [...groups.values()]
      .filter((group) => {
        if (!query) return true;
        return `${group.dealNumber} ${group.dealTitle}`.toLowerCase().includes(query);
      })
      .sort((first, second) => {
        const firstNumber = Number(first.dealNumber);
        const secondNumber = Number(second.dealNumber);
        if (Number.isFinite(firstNumber) && Number.isFinite(secondNumber)) return secondNumber - firstNumber;
        return `${second.dealNumber} ${second.dealTitle}`.localeCompare(`${first.dealNumber} ${first.dealTitle}`, "ru");
      });
  }, [galleryPhotos, galleryQuery]);

  return (
    <section className="production-panel">
      <label className="search worker-gallery-search">
        <Search size={17} />
        <input
          onChange={(event) => setGalleryQuery(event.target.value)}
          placeholder="Поиск по сделке"
          value={galleryQuery}
        />
      </label>
      <div className="worker-gallery worker-gallery-list">
        {dealGroups.map((group) => {
          const firstPhoto = group.photos.find((photo) => productionPhotoSrc(photo));
          const thumbnail = firstPhoto ? productionPhotoSrc(firstPhoto) : "";
          const visiblePhotos = group.photos.filter((photo) => productionPhotoSrc(photo));
          const title = group.dealTitle || (group.dealNumber ? `Сделка #${group.dealNumber}` : "Готовая работа");

          return (
            <article className="worker-gallery-deal" key={group.dealId}>
              <div className="worker-gallery-thumb">
                {thumbnail ? (
                  <button
                    aria-label="Открыть фото сделки"
                    className="worker-gallery-thumb-button"
                    onClick={() => setViewer({ index: 0, photos: visiblePhotos, title })}
                    type="button"
                  >
                    <img alt={title} src={thumbnail} />
                  </button>
                ) : (
                  <Images size={18} />
                )}
              </div>
              <div>
                <strong>{group.dealNumber ? `#${group.dealNumber}` : "Сделка без номера"}</strong>
                <span>{title}</span>
                <small>{group.photos.length} фото</small>
              </div>
            </article>
          );
        })}
        {!dealGroups.length ? <span>Галерея готовых работ пока пустая</span> : null}
      </div>
      {viewer ? (
        <WorkerGalleryViewer
          index={viewer.index}
          onClose={() => setViewer(null)}
          onIndexChange={(index) => setViewer((current) => current ? { ...current, index } : current)}
          photos={viewer.photos}
          title={viewer.title}
        />
      ) : null}
    </section>
  );
}

function WorkerGalleryViewer({
  index,
  onClose,
  onIndexChange,
  photos,
  title,
}: {
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  photos: ProductionPhoto[];
  title: string;
}) {
  const safeIndex = Math.min(Math.max(index, 0), Math.max(photos.length - 1, 0));
  const photo = photos[safeIndex];
  const src = productionPhotoFullSrc(photo) || productionPhotoSrc(photo);
  const canNavigate = photos.length > 1;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && canNavigate) onIndexChange((safeIndex - 1 + photos.length) % photos.length);
      if (event.key === "ArrowRight" && canNavigate) onIndexChange((safeIndex + 1) % photos.length);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canNavigate, onClose, onIndexChange, photos.length, safeIndex]);

  if (!src) return null;

  return (
    <div className="worker-gallery-viewer-backdrop" onClick={onClose} role="presentation">
      <div
        aria-label="Просмотр фото"
        aria-modal="true"
        className="worker-gallery-viewer"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="worker-gallery-viewer-head">
          <div>
            <strong>{title}</strong>
            <span>{safeIndex + 1} из {photos.length}</span>
          </div>
          <button aria-label="Закрыть фото" onClick={onClose} type="button">
            <X size={22} />
          </button>
        </div>
        <div className="worker-gallery-viewer-stage">
          {canNavigate ? (
            <button
              aria-label="Предыдущее фото"
              className="worker-gallery-viewer-nav previous"
              onClick={() => onIndexChange((safeIndex - 1 + photos.length) % photos.length)}
              type="button"
            >
              <ChevronRight size={26} />
            </button>
          ) : null}
          <img alt={title} src={src} />
          {canNavigate ? (
            <button
              aria-label="Следующее фото"
              className="worker-gallery-viewer-nav next"
              onClick={() => onIndexChange((safeIndex + 1) % photos.length)}
              type="button"
            >
              <ChevronRight size={26} />
            </button>
          ) : null}
        </div>
        <div className="worker-gallery-viewer-footer">
          <span>{photo?.uploadedAt ? formatDate(photo.uploadedAt) : "Фото работы"}</span>
          <a href={src} rel="noreferrer" target="_blank">Открыть оригинал</a>
        </div>
      </div>
    </div>
  );
}

function ProductionNotificationCenter({
  currentUserId,
  notifications,
  onClose,
  onOpen,
  onRead,
}: {
  currentUserId: string;
  notifications: ProductionNotification[];
  onClose: () => void;
  onOpen: (notification: ProductionNotification) => void;
  onRead: (notification: ProductionNotification) => void;
}) {
  const visibleNotifications = notifications.slice(0, 30);

  return (
    <section className="production-notification-center" aria-label="Уведомления">
      <div className="production-notification-center-head">
        <div>
          <span>Уведомления</span>
          <strong>{notifications.filter((item) => !item.readBy?.includes(currentUserId)).length}</strong>
        </div>
        <button aria-label="Закрыть уведомления" onClick={onClose} type="button">
          <X size={18} />
        </button>
      </div>
      <div className="production-notification-list">
        {visibleNotifications.map((notification) => {
          const unread = !notification.readBy?.includes(currentUserId);
          return (
            <button
              className={unread ? "unread" : ""}
              key={notification.id}
              onClick={() => onOpen(notification)}
              type="button"
            >
              <span className={`production-notification-dot ${notification.type}`} />
              <span>
                <strong>{notification.message}</strong>
                <small>{formatDateTime(notification.createdAt)}</small>
              </span>
              {unread ? (
                <em
                  onClick={(event) => {
                    event.stopPropagation();
                    onRead(notification);
                  }}
                >
                  Прочитано
                </em>
              ) : null}
            </button>
          );
        })}
        {!visibleNotifications.length ? (
          <p>Новых событий пока нет.</p>
        ) : null}
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
      <strong>{label}</strong>
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
          На сборке
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
  photoUploadStates,
  powerSupplyCatalogItems,
  techSpec,
  onAddPhoto,
  onRemovePhoto,
  onStart,
  onSubmit,
  onToggle,
  onUpdateCompletion,
}: {
  assignment: ProductionAssignment;
  deal: Deal;
  diodeCatalogItems: CatalogItem[];
  expanded: boolean;
  photoUploadStates: Partial<Record<ProductionPhotoKind, PhotoUploadState>>;
  powerSupplyCatalogItems: CatalogItem[];
  techSpec?: DealTechSpec;
  onAddPhoto: (kind: ProductionPhotoKind, file?: File) => void;
  onRemovePhoto: (kind: ProductionPhotoKind) => void;
  onStart: () => void;
  onSubmit: () => void;
  onToggle: () => void;
  onUpdateCompletion: (patch: Partial<ProductionCompletion>) => void;
}) {
  const completion = completionFor(assignment);
  const canSubmit = canSubmitCompletion(completion);
  const itemLabel = assignment.techSpecItemId
    ? techSpecItemLabel(techSpec, assignment.techSpecItemId)
    : "";
  const deadlineBadge = deadlineBadgeFor(deal.expectedFinishDate);
  const detailRef = useRef<HTMLDivElement | null>(null);
  const [detailHeight, setDetailHeight] = useState(0);
  const detailShellStyle = {
    "--worker-detail-height": `${detailHeight}px`,
  } as CSSProperties;

  useEffect(() => {
    const node = detailRef.current;
    if (!node) return undefined;

    const updateHeight = () => setDetailHeight(node.scrollHeight);
    updateHeight();

    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(node);
    return () => observer.disconnect();
  }, [
    assignment.status,
    completion.diodeCatalogId,
    completion.diodeCount,
    completion.noPowerSupply,
    completion.note,
    completion.photos.length,
    completion.powerSupplyCatalogId,
    expanded,
    itemLabel,
    techSpec,
  ]);

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
        </div>
        <div className="production-compact-status worker-deadline-status">
          <span className="production-worker-date">{formatDate(deal.expectedFinishDate) || "Без срока"}</span>
          <span className={`production-deadline-chip ${deadlineBadge.tone}`}>{deadlineBadge.label}</span>
        </div>
      </button>

      <div
        className={`production-worker-detail-shell${expanded ? " open" : ""}`}
        aria-hidden={!expanded}
        style={detailShellStyle}
      >
        <div className="production-worker-detail" ref={detailRef}>
          <TechSpecInline
            compactForWorker
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
                      state={photoUploadStates[slot.kind]}
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
        </div>
      </div>
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
  compactForWorker = false,
  deal,
  itemId,
  spec,
  expanded = false,
}: {
  compactForWorker?: boolean;
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
    <section className={`production-tech-spec${compactForWorker ? " worker-compact" : ""}`}>
      {!compactForWorker ? (
        <>
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
            <SpecMeta label="Срок сдачи" value={formatDate(deal.expectedFinishDate || spec.draft.deadline)} />
          </div>
        </>
      ) : null}
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
  state,
  slot,
  onChange,
  onRemove,
}: {
  photo?: ProductionPhoto;
  state?: PhotoUploadState;
  slot: (typeof photoSlots)[number];
  onChange: (file?: File) => void;
  onRemove: () => void;
}) {
  const photoSrc = productionPhotoSrc(photo) || state?.photoUrl || "";
  const photoFullSrc = productionPhotoFullSrc(photo) || photoSrc;
  const isUploading = state?.status === "uploading";
  const isSuccess = state?.status === "success" || Boolean(photoSrc);
  const isError = state?.status === "error";

  return (
    <div className={photoSrc ? "production-photo-slot filled" : "production-photo-slot"}>
      <div className="production-photo-preview">
        {photoSrc ? (
          <>
            <a
              aria-label="Открыть фото"
              className="production-photo-preview-link"
              href={photoFullSrc}
              rel="noreferrer"
              target="_blank"
              title="Открыть фото"
            >
              <img alt={slot.title} src={photoSrc} />
            </a>
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
      {state?.message || isSuccess ? (
        <span
          className={[
            "production-photo-upload-state",
            isSuccess ? "success" : "",
            isError ? "error" : "",
            isUploading ? "uploading" : "",
          ].filter(Boolean).join(" ")}
        >
          {isSuccess ? <CheckCircle2 size={14} /> : null}
          {state?.message || "Фото добавлено"}
        </span>
      ) : null}
      <label className="secondary compact">
        <Camera size={15} />
        {photoSrc ? "Заменить" : isUploading ? "Загрузка..." : "Загрузить фото"}
        <input
          accept="image/jpeg,image/png,image/webp,image/*"
          disabled={isUploading}
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

function PhotoStrip({
  canDelete = false,
  photos,
  onDeletePhoto,
}: {
  canDelete?: boolean;
  photos: ProductionPhoto[];
  onDeletePhoto?: (photo: ProductionPhoto) => void;
}) {
  if (!photos.length) return null;

  return (
    <div className="production-photo-strip">
      {photoSlots.map((slot) => {
        const photo = photos.find((item) => item.kind === slot.kind);
        if (!photo) return null;
        const caption = photo.dealNumber ? `#${photo.dealNumber} · ${slot.title}` : slot.title;
        const photoSrc = productionPhotoSrc(photo);
        const photoFullSrc = productionPhotoFullSrc(photo) || photoSrc;
        if (!photoSrc) return null;
        return (
          <figure key={slot.kind}>
            <a aria-label="Открыть фото" href={photoFullSrc} rel="noreferrer" target="_blank" title="Открыть фото">
              <img alt={slot.title} src={photoSrc} />
            </a>
            {canDelete && onDeletePhoto ? (
              <button
                aria-label="Удалить фото"
                className="production-photo-strip-delete"
                onClick={() => onDeletePhoto(photo)}
                type="button"
              >
                <Trash2 size={14} />
              </button>
            ) : null}
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
  if (role === "installationChief") return "installationChiefs";
  if (role === "leader") return "leaders";
  return "noAccess";
}

function employeeAccessChoiceFor(employee: ProductionEmployee): EmployeeAccessChoice {
  const role = accessRoleFor(employee);
  if (role === "maker" && employee.role === "assembler") return "installer";
  return role;
}

function employeeAccessChoiceForGroup(groupId: EmployeeGroupId): EmployeeAccessChoice {
  const choices: Record<EmployeeGroupId, EmployeeAccessChoice> = {
    assemblers: "installer",
    installationChiefs: "installationChief",
    leaders: "leader",
    makers: "maker",
    managers: "manager",
    noAccess: "none",
    shopChiefs: "shopChief",
    technologists: "technologist",
  };
  return choices[groupId];
}

function employeeAccessChoiceOptions(includeNone: boolean): EmployeeAccessChoice[] {
  return [
    ...(includeNone ? (["none"] as EmployeeAccessChoice[]) : []),
    "maker",
    "installer",
    "installationChief",
    "shopChief",
    "technologist",
    "manager",
    "leader",
  ];
}

function employeeAccessChoiceLabel(choice: EmployeeAccessChoice) {
  if (choice === "installer") return "Монтажник";
  return accessRoleLabels[choice];
}

function canCreateAccessChoice(currentUser: ProductionEmployee | undefined, choice: EmployeeAccessChoice) {
  if (accessRoleFor(currentUser) === "installationChief") {
    return choice === "installer" || choice === "none";
  }
  return canCreateAccessRole(currentUser, choice === "installer" ? "maker" : choice);
}

function normalizeEmployeeAccessChoice(
  choice: EmployeeAccessChoice,
  fallbackWorkerRole: ProductionEmployeeRole = "maker",
): { accessRole: ProductionAccessRole; workerRole: ProductionEmployeeRole } {
  if (choice === "installer") {
    return { accessRole: "maker", workerRole: "assembler" };
  }
  if (choice === "maker") {
    return { accessRole: "maker", workerRole: "maker" };
  }
  return { accessRole: choice, workerRole: fallbackWorkerRole };
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

function hasSupervisorDoneAssignments(
  dealId: string,
  spec: DealTechSpec | undefined,
  assignments: ProductionAssignment[],
) {
  const currentAssignments = currentAssignmentsForDeal(assignments, dealId, spec);
  return currentAssignments.some(
    (assignment) => assignment.status === "submitted" || assignment.status === "readyForShipment",
  );
}

function hasSupervisorActiveAssignments(
  dealId: string,
  spec: DealTechSpec | undefined,
  assignments: ProductionAssignment[],
) {
  const currentAssignments = currentAssignmentsForDeal(assignments, dealId, spec);
  return currentAssignments.some(
    (assignment) => assignment.status === "assigned" || assignment.status === "inProgress",
  );
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
    icon: `${import.meta.env.BASE_URL}verkup-app-icon-v4-192.png`,
    badge: `${import.meta.env.BASE_URL}verkup-app-icon-v4-favicon-32.png`,
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

function photoUploadStateKey(assignmentId: string, kind: ProductionPhotoKind) {
  return `${assignmentId}:${kind}`;
}

function productionPhotoSrc(photo?: ProductionPhoto) {
  return normalizeProductionAssetUrl(photo?.thumbnailUrl || photo?.url || photo?.dataUrl || "");
}

function productionPhotoFullSrc(photo?: ProductionPhoto) {
  return normalizeProductionAssetUrl(photo?.url || photo?.dataUrl || photo?.thumbnailUrl || "");
}

function normalizeProductionAssetUrl(value: string) {
  if (!value) return "";
  if (/^(data:|blob:|https?:\/\/)/i.test(value)) return value;
  const base = import.meta.env.BASE_URL.replace(/\/+$/, "");
  if (value.startsWith("/uploads/") && base) return `${base}${value}`;
  if (base && value.startsWith(`${base}/`)) return value;
  if (value.startsWith("/")) return value;
  return `${import.meta.env.BASE_URL}${value.replace(/^\/+/, "")}`;
}

function dataUrlToFile(dataUrl: string, fileName: string) {
  const [header, payload] = dataUrl.split(",");
  const mime = header.match(/^data:([^;]+);/)?.[1] || "image/jpeg";
  const binary = window.atob(payload || "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const normalizedName = mime === "image/jpeg"
    ? fileName.replace(/\.[^.]+$/, "") + ".jpg"
    : fileName;

  return new File([bytes], normalizedName, { type: mime });
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
