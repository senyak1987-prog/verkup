import { ExternalLink, Pencil, Search } from "lucide-react";
import type { Deal, DealCalculation } from "../types";
import {
  cleanCost,
  finalCost,
  formatMoney,
  formatPercent,
  margin,
  profit,
  saleAmountForDeal,
} from "../lib/costing";

type DealTableProps = {
  deals: Deal[];
  calculations: Map<string, DealCalculation>;
  agentRatio: number;
  selectedDealId?: string;
  onSelect: (deal: Deal) => void;
  query: string;
  onQueryChange: (value: string) => void;
};

export function DealTable({
  deals,
  calculations,
  agentRatio,
  selectedDealId,
  onSelect,
  query,
  onQueryChange,
}: DealTableProps) {
  const totals = deals.reduce(
    (acc, deal) => {
      const calculation = calculations.get(deal.id);
      acc.sale += saleAmountForDeal(deal, calculation, agentRatio);
      acc.clean += cleanCost(calculation);
      acc.final += finalCost(calculation);
      acc.profit += profit(deal, calculation, agentRatio);
      return acc;
    },
    { sale: 0, clean: 0, final: 0, profit: 0 },
  );

  return (
    <main className="deal-list">
      <div className="toolbar">
        <div>
          <h1>Сделки к запуску</h1>
          <p>{deals.length} сделок на стадии производства</p>
        </div>
        <label className="search">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Поиск по номеру, названию, менеджеру"
          />
        </label>
      </div>

      <section className="kpis">
        <Kpi label="Продажа" value={formatMoney(totals.sale)} />
        <Kpi label="Чистый себес" value={formatMoney(totals.clean)} />
        <Kpi label="С косяками" value={formatMoney(totals.final)} />
        <Kpi label="Прибыль" value={formatMoney(totals.profit)} />
      </section>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Сделка</th>
              <th>Источник</th>
              <th>Тип</th>
              <th>Ответственный</th>
              <th>Даты</th>
              <th>Продажа / монтаж</th>
              <th>Себестоимость</th>
              <th>Прибыль</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {deals.map((deal) => {
              const calculation = calculations.get(deal.id);
              const isSelected = selectedDealId === deal.id;
              return (
                <tr key={deal.id} className={isSelected ? "selected" : ""}>
                  <td>
                    <button className="deal-title" onClick={() => onSelect(deal)}>
                      <strong>#{deal.number}</strong>
                      <span>{deal.title}</span>
                    </button>
                    <small>{deal.classification || "Без классификации"}</small>
                  </td>
                  <td>{deal.source || "-"}</td>
                  <td>{deal.type || "-"}</td>
                  <td>{deal.responsible || "-"}</td>
                  <td>
                    <span>{formatDate(deal.startDate) || "запуск не указан"}</span>
                    <small>{formatDate(deal.expectedFinishDate) || "финиш не указан"}</small>
                  </td>
                  <td>
                    {formatMoney(saleAmountForDeal(deal, calculation, agentRatio))}
                    <small>монтаж {formatMoney(deal.installSaleAmount)}</small>
                  </td>
                  <td>
                    <button className="cost-chip" onClick={() => onSelect(deal)}>
                      <span>{formatMoney(finalCost(calculation))}</span>
                      <small>
                        чистый {formatMoney(cleanCost(calculation))} ·{" "}
                        {formatPercent(margin(deal, calculation, agentRatio))}
                      </small>
                    </button>
                  </td>
                  <td className={profit(deal, calculation, agentRatio) < 0 ? "negative" : ""}>
                    {formatMoney(profit(deal, calculation, agentRatio))}
                  </td>
                  <td className="row-actions">
                    <button title="Открыть расчет" onClick={() => onSelect(deal)}>
                      <Pencil size={17} />
                    </button>
                    <a title="Открыть в Битрикс24" href={deal.bitrixUrl} target="_blank">
                      <ExternalLink size={17} />
                    </a>
                  </td>
                </tr>
              );
            })}
            {!deals.length && (
              <tr>
                <td className="empty" colSpan={9}>
                  Сделки не найдены. Проверьте синхронизацию Bitrix24 или фильтр поиска.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU").format(date);
}
