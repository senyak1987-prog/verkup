import { useMemo, useState, type ReactNode } from "react";
import { CircleDollarSign, ReceiptText, TrendingDown, TrendingUp, WalletCards } from "lucide-react";
import {
  finalCost,
  formatMoney,
  formatPercent,
  margin,
  positionTotal,
  profit,
  saleAmountForDeal,
} from "../lib/costing";
import type {
  CostSection,
  Deal,
  DealCalculation,
  StoredInstallations,
  StoredProduction,
} from "../types";

type FinanceAppProps = {
  agentRatio: number;
  calculations: Map<string, DealCalculation>;
  deals: Deal[];
  installations: StoredInstallations;
  production: StoredProduction;
};

const sectionLabels: Record<CostSection, string> = {
  materials: "Материалы",
  lighting: "Светотехника",
  assembly: "Сборка",
  consumables: "Расходники",
  subcontract: "Подрядчики",
  milling: "Фрезеровка",
  print: "Печать",
  plotter: "Плоттер",
  mounting: "Монтаж",
  defects: "Косяки",
  other: "Прочее",
};

export function FinanceApp({
  agentRatio,
  calculations,
  deals,
  installations,
  production,
}: FinanceAppProps) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));

  const report = useMemo(() => {
    const monthDeals = deals.filter((deal) => isDealInMonth(deal, month));
    const bySection = new Map<CostSection, number>();

    let revenue = 0;
    let cost = 0;
    let result = 0;
    let marginSum = 0;
    let marginCount = 0;

    const rows = monthDeals.map((deal) => {
      const calculation = calculations.get(deal.id);
      const dealRevenue = saleAmountForDeal(deal, calculation, agentRatio);
      const dealCost = finalCost(calculation);
      const dealProfit = profit(deal, calculation, agentRatio);
      const dealMargin = margin(deal, calculation, agentRatio);

      revenue += dealRevenue;
      cost += dealCost;
      result += dealProfit;
      if (dealRevenue) {
        marginSum += dealMargin;
        marginCount += 1;
      }

      for (const position of calculation?.positions || []) {
        bySection.set(position.section, (bySection.get(position.section) || 0) + positionTotal(position));
      }

      return {
        id: deal.id,
        number: deal.number,
        title: deal.title,
        stageName: deal.stageName || "Без стадии",
        revenue: dealRevenue,
        cost: dealCost,
        profit: dealProfit,
        margin: dealMargin,
      };
    });

    return {
      assignedInstallations: installations.installations.length,
      expenseSections: [...bySection.entries()].sort((a, b) => b[1] - a[1]),
      margin: marginCount ? marginSum / marginCount : 0,
      productionNotifications: production.notifications?.length || 0,
      rows: rows.sort((a, b) => b.revenue - a.revenue),
      revenue,
      cost,
      profit: result,
    };
  }, [agentRatio, calculations, deals, installations.installations.length, month, production.notifications?.length]);

  return (
    <main className="finance-app">
      <section className="workspace-page-hero finance-hero">
        <span className="eyebrow">Финансовая аналитика</span>
        <h1>Финансы</h1>
        <p>Выручка, расходы, себестоимость и прибыль по сделкам в одном рабочем отчете.</p>
      </section>

      <section className="finance-toolbar">
        <label>
          <span>Месяц отчета</span>
          <input value={month} onChange={(event) => setMonth(event.target.value)} type="month" />
        </label>
        <div>
          <b>{report.rows.length}</b>
          <span>сделок в отчете</span>
        </div>
      </section>

      <section className="finance-kpis">
        <FinanceKpi icon={<CircleDollarSign size={20} />} label="Выручка" value={formatMoney(report.revenue)} />
        <FinanceKpi icon={<ReceiptText size={20} />} label="Себестоимость" value={formatMoney(report.cost)} />
        <FinanceKpi icon={<TrendingUp size={20} />} label="Прибыль" value={formatMoney(report.profit)} />
        <FinanceKpi icon={<WalletCards size={20} />} label="Средняя маржа" value={formatPercent(report.margin)} />
      </section>

      <section className="finance-grid">
        <article className="finance-panel">
          <div className="finance-panel-title">
            <h2>Структура затрат</h2>
            <span>{formatMoney(report.cost)}</span>
          </div>
          {report.expenseSections.length ? (
            <div className="finance-breakdown">
              {report.expenseSections.map(([section, value]) => (
                <div className="finance-breakdown-row" key={section}>
                  <span>{sectionLabels[section]}</span>
                  <b>{formatMoney(value)}</b>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-note">Расходов за выбранный месяц пока нет.</p>
          )}
        </article>

        <article className="finance-panel">
          <div className="finance-panel-title">
            <h2>Что добавить следующим шагом</h2>
            <span>план</span>
          </div>
          <ul className="finance-roadmap">
            <li>Оплаты: предоплата, доплата, долг и история платежей по сделке.</li>
            <li>Зарплаты монтажников и подрядчиков с включением в себестоимость.</li>
            <li>Сверка оплат из Bitrix и отдельные отчеты по менеджерам.</li>
            <li>Движение денег по месяцам: выручка, маржа, кассовые разрывы.</li>
          </ul>
        </article>
      </section>

      <section className="finance-panel finance-deals-panel">
        <div className="finance-panel-title">
          <h2>Сделки месяца</h2>
          <span>{report.assignedInstallations} монтажей · {report.productionNotifications} уведомлений производства</span>
        </div>
        {report.rows.length ? (
          <div className="finance-deal-list">
            {report.rows.map((row) => (
              <div className="finance-deal-row" key={row.id}>
                <div>
                  <span>#{row.number}</span>
                  <b>{row.title}</b>
                  <small>{row.stageName}</small>
                </div>
                <strong>{formatMoney(row.revenue)}</strong>
                <span>{formatMoney(row.cost)}</span>
                <b className={row.profit >= 0 ? "positive" : "negative"}>
                  {row.profit >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                  {formatMoney(row.profit)}
                </b>
                <em>{formatPercent(row.margin)}</em>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-note">В выбранном месяце нет сделок для финансового отчета.</p>
        )}
      </section>
    </main>
  );
}

function FinanceKpi({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <article className="finance-kpi">
      <span>{icon}</span>
      <div>
        <p>{label}</p>
        <b>{value}</b>
      </div>
    </article>
  );
}

function isDealInMonth(deal: Deal, month: string) {
  const candidates = [deal.startDate, deal.expectedFinishDate, deal.createdDate].filter(Boolean);
  if (!candidates.length) return false;
  return candidates.some((value) => String(value).slice(0, 7) === month);
}
