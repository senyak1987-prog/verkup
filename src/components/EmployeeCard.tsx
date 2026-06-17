import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ExternalLink } from "lucide-react";
import type { ResponsibleCard } from "../types";
import {
  displayResponsible,
  hydrateResponsibleCard,
  isUnresolvedResponsible,
  responsibleInternalPhoneFromCard,
  responsiblePhoneFromCard,
} from "../lib/responsible";

type EmployeeCardProps = {
  card?: ResponsibleCard;
  fallbackName?: string;
  fallbackPhone?: string;
  compact?: boolean;
  showPhone?: boolean;
  className?: string;
};

export function EmployeeCard({
  card,
  fallbackName,
  fallbackPhone,
  compact = false,
  showPhone = false,
  className = "",
}: EmployeeCardProps) {
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({ left: -9999, top: -9999, visibility: "hidden" });
  const [arrowLeft, setArrowLeft] = useState(170);
  const [placement, setPlacement] = useState<"above" | "below">("below");
  const chipRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const profileCard = hydrateResponsibleCard(card, fallbackName);
  const name = displayResponsible(profileCard?.name || fallbackName);
  const phone = responsiblePhoneFromCard(profileCard, fallbackPhone);
  const internalPhone = responsibleInternalPhoneFromCard(profileCard, fallbackPhone);
  const visiblePhone = phone || internalPhone;
  const isUnresolved = isUnresolvedResponsible(profileCard?.name || fallbackName);
  const profileUrl = profileCard?.bitrixUrl;
  const hasDetails = Boolean(!isUnresolved && (visiblePhone || profileCard?.email || profileUrl));
  const classes = [
    "employee-card",
    compact ? "compact" : "",
    isUnresolved ? "unresolved" : "",
    hasDetails ? "has-details" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const popoverCssVars = {
    ...popoverStyle,
    "--employee-arrow-left": `${arrowLeft}px`,
  } as CSSProperties;

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
    }, 180);
  }, [clearCloseTimer]);

  const openCard = useCallback(() => {
    if (!hasDetails) return;
    clearCloseTimer();
    setOpen(true);
  }, [clearCloseTimer, hasDetails]);

  const updatePopoverPosition = useCallback(() => {
    const chip = chipRef.current;
    const popover = popoverRef.current;
    if (!chip || !popover) return;

    const viewportGap = 14;
    const arrowGap = 18;
    const chipRect = chip.getBoundingClientRect();
    const width = Math.min(320, Math.max(260, window.innerWidth - viewportGap * 2));
    const height = Math.min(popover.offsetHeight || 220, window.innerHeight - viewportGap * 2);
    const centeredLeft = chipRect.left + chipRect.width / 2 - width / 2;
    const left = clamp(centeredLeft, viewportGap, window.innerWidth - width - viewportGap);
    const spaceBelow = window.innerHeight - chipRect.bottom;
    const spaceAbove = chipRect.top;
    const nextPlacement = spaceBelow < height + arrowGap && spaceAbove > spaceBelow ? "above" : "below";
    const preferredTop = nextPlacement === "above" ? chipRect.top - height - arrowGap : chipRect.bottom + arrowGap;
    const top = clamp(preferredTop, viewportGap, window.innerHeight - height - viewportGap);
    const nextArrowLeft = clamp(chipRect.left + chipRect.width / 2 - left, 34, width - 34);

    setPlacement(nextPlacement);
    setArrowLeft(nextArrowLeft);
    setPopoverStyle({
      left,
      top,
      width,
      visibility: "visible",
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePopoverPosition();
    const frameId = window.requestAnimationFrame(updatePopoverPosition);
    return () => window.cancelAnimationFrame(frameId);
  }, [open, updatePopoverPosition]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (chipRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [open, updatePopoverPosition]);

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

  return (
    <div
      ref={chipRef}
      className={classes}
      onClick={(event) => event.stopPropagation()}
      onPointerEnter={openCard}
      onPointerLeave={scheduleClose}
    >
      <button
        className="employee-card-chip"
        type="button"
        aria-expanded={open}
        aria-label={`Карточка сотрудника: ${name}`}
        onClick={() => {
          if (!hasDetails) return;
          clearCloseTimer();
          setOpen((current) => !current);
        }}
        onFocus={openCard}
      >
        <Avatar card={profileCard} name={name} />
        <span className="employee-card-name">{name}</span>
        {showPhone && visiblePhone ? <span className="employee-card-phone">{visiblePhone}</span> : null}
      </button>

      {open && hasDetails && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popoverRef}
              className={`employee-popover is-${placement}`}
              style={popoverCssVars}
              role="dialog"
              aria-label={`Карточка сотрудника ${name}`}
              onClick={(event) => event.stopPropagation()}
              onPointerEnter={clearCloseTimer}
              onPointerLeave={scheduleClose}
            >
              <div className="employee-popover-surface">
                <div className="employee-popover-head">
                  <Avatar card={profileCard} name={name} large />
                  <div className="employee-popover-title">
                    <strong>{name}</strong>
                  </div>
                </div>

                <div className="employee-popover-divider" />

                <div className="employee-profile-fields">
                  <ProfileField
                    href={visiblePhone ? `tel:${visiblePhone.replace(/[^\d+]/g, "")}` : undefined}
                    label="Телефон"
                    value={visiblePhone}
                  />
                  <ProfileField
                    href={profileCard?.email ? `mailto:${profileCard.email}` : undefined}
                    label="E-mail"
                    value={profileCard?.email}
                  />
                  {profileUrl ? (
                    <a className="employee-bitrix-link" href={profileUrl} rel="noreferrer" target="_blank">
                      <ExternalLink size={16} />
                      Контакт в Bitrix
                    </a>
                  ) : null}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function Avatar({ card, name, large = false }: { card?: ResponsibleCard; name: string; large?: boolean }) {
  if (card?.avatarUrl) {
    return <img className={large ? "employee-avatar large" : "employee-avatar"} src={card.avatarUrl} alt="" />;
  }

  return (
    <span className={large ? "employee-avatar large placeholder" : "employee-avatar placeholder"}>
      {initials(name)}
    </span>
  );
}

function ProfileField({ label, value, href }: { label: string; value?: string | null; href?: string }) {
  if (!value) return null;

  const content = (
    <>
      <span className="employee-profile-label">{label}</span>
      <span className="employee-profile-value">{value}</span>
    </>
  );

  return href ? (
    <a className="employee-profile-field" href={href}>
      {content}
    </a>
  ) : (
    <div className="employee-profile-field">{content}</div>
  );
}

function initials(name: string) {
  const cleanName = name.replace(/^ID\s+/, "").replace(/\(.*?\)/g, "").trim();
  const parts = cleanName.split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}
