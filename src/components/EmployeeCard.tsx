import { Building2, ExternalLink, Mail, Phone, UserRound } from "lucide-react";
import type { ResponsibleCard } from "../types";
import { displayResponsible, isUnresolvedResponsible, responsiblePhoneFromCard } from "../lib/responsible";

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
  const name = displayResponsible(card?.name || fallbackName);
  const phone = responsiblePhoneFromCard(card, fallbackPhone);
  const isUnresolved = isUnresolvedResponsible(card?.name || fallbackName);
  const hasDetails = Boolean(
    phone || card?.email || card?.position || card?.department || card?.supervisor || card?.bitrixUrl,
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
        <Avatar card={card} name={name} />
        <span className="employee-card-name">{name}</span>
        {showPhone && phone ? <span className="employee-card-phone">{phone}</span> : null}
      </button>

      {hasDetails ? (
        <div className="employee-popover" role="dialog" aria-label={`Карточка сотрудника ${name}`}>
          <div className="employee-popover-head">
            <Avatar card={card} name={name} large />
            <div>
              <strong>{name}</strong>
              {card?.position ? <span>{card.position}</span> : null}
            </div>
          </div>
          <div className="employee-popover-list">
            {phone ? (
              <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>
                <Phone size={15} />
                <span>{phone}</span>
              </a>
            ) : null}
            {card?.email ? (
              <a href={`mailto:${card.email}`}>
                <Mail size={15} />
                <span>{card.email}</span>
              </a>
            ) : null}
            {card?.supervisor ? (
              <div>
                <UserRound size={15} />
                <span>Руководитель: {card.supervisor}</span>
              </div>
            ) : null}
            {card?.department ? (
              <div>
                <Building2 size={15} />
                <span>{card.department}</span>
              </div>
            ) : null}
            {card?.bitrixUrl ? (
              <a href={card.bitrixUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={15} />
                <span>Открыть в Bitrix</span>
              </a>
            ) : null}
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

function initials(name: string) {
  const cleanName = name.replace(/^ID\s+/, "").replace(/\(.*?\)/g, "").trim();
  const parts = cleanName.split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}
