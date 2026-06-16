import { ChevronDown, ExternalLink, MessageCircle, Video } from "lucide-react";
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
  const profileCard = hydrateResponsibleCard(card, fallbackName);
  const name = displayResponsible(profileCard?.name || fallbackName);
  const phone = responsiblePhoneFromCard(profileCard, fallbackPhone);
  const internalPhone = responsibleInternalPhoneFromCard(profileCard, fallbackPhone);
  const visiblePhone = phone || internalPhone;
  const isUnresolved = isUnresolvedResponsible(profileCard?.name || fallbackName);
  const lastSeen = formatLastSeen(profileCard?.lastSeenText || profileCard?.lastSeenAt);
  const profileUrl = profileCard?.bitrixUrl;
  const chatUrl = profileCard?.chatUrl || profileUrl;
  const videoUrl = profileCard?.videoUrl || chatUrl;
  const hasDetails = Boolean(
    phone ||
      internalPhone ||
      profileCard?.email ||
      profileCard?.position ||
      profileCard?.department ||
      profileCard?.supervisor ||
      profileUrl ||
      lastSeen,
  );
  const classes = [
    "employee-card",
    compact ? "compact" : "",
    isUnresolved ? "unresolved" : "",
    hasDetails ? "has-details" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} onClick={(event) => event.stopPropagation()}>
      <button className="employee-card-chip" type="button" aria-label={`Карточка сотрудника: ${name}`}>
        <Avatar card={profileCard} name={name} />
        <span className="employee-card-name">{name}</span>
        {showPhone && visiblePhone ? <span className="employee-card-phone">{visiblePhone}</span> : null}
      </button>

      {hasDetails ? (
        <div className="employee-popover" role="dialog" aria-label={`Карточка сотрудника ${name}`}>
          {profileUrl ? (
            <a
              aria-label="Открыть профиль в Bitrix"
              className="employee-popover-open"
              href={profileUrl}
              rel="noreferrer"
              target="_blank"
            >
              <ExternalLink size={20} />
            </a>
          ) : null}

          <div className="employee-popover-head">
            <Avatar card={profileCard} name={name} large />
            <div className="employee-popover-title">
              <strong>{name}</strong>
              {profileCard?.position ? <span>{profileCard.position}</span> : null}
              {lastSeen ? <small>{lastSeen}</small> : null}
            </div>
          </div>

          <div className="employee-card-actions">
            <a
              className={`employee-card-action secondary${chatUrl ? "" : " disabled"}`}
              href={chatUrl || "#"}
              onClick={(event) => {
                if (!chatUrl) event.preventDefault();
              }}
              rel={chatUrl ? "noreferrer" : undefined}
              target={chatUrl ? "_blank" : undefined}
            >
              <MessageCircle size={18} />
              Чат
            </a>
            <a
              className={`employee-card-action primary${videoUrl ? "" : " disabled"}`}
              href={videoUrl || "#"}
              onClick={(event) => {
                if (!videoUrl) event.preventDefault();
              }}
              rel={videoUrl ? "noreferrer" : undefined}
              target={videoUrl ? "_blank" : undefined}
            >
              <Video size={18} />
              Видеозвонок
              <span className="employee-action-divider" />
              <ChevronDown size={18} />
            </a>
          </div>

          <div className="employee-popover-divider" />

          <div className="employee-profile-fields">
            <ProfileField href={phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : undefined} label="Мобильный телефон" value={phone} />
            <ProfileField label="Внутренний телефон" value={internalPhone} />
            <ProfileField href={profileCard?.email ? `mailto:${profileCard.email}` : undefined} label="E-mail" value={profileCard?.email} />
            <ProfileField label="Руководитель" value={profileCard?.supervisor} />
            <ProfileField label="Отдел" value={profileCard?.department} />
          </div>
        </div>
      ) : null}
    </div>
  );
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

function formatLastSeen(value?: string | null) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (!/\d{4}-\d{2}-\d{2}|T|\d{2}:\d{2}/.test(text)) return text;

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;

  const datePart = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Moscow",
  }).format(date);
  const timePart = new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(date);

  return `Был в сети ${datePart} в ${timePart}`;
}
