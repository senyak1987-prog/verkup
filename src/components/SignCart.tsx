import { Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import type { CartItem } from "../lib/signCommerce";
import { SIGN_CART_MAX_QUANTITY } from "../lib/signCommerce";
import "../sign-cart.css";

export type SignCartProps<T extends Record<string, unknown> = Record<string, unknown>> = {
  items: CartItem<T>[];
  onQuantityChange: (id: string, quantity: number) => void;
  onRemove: (id: string) => void;
  onEdit: (item: CartItem<T>) => void;
  onClear: () => void;
  error?: string;
  onDismissError?: () => void;
};

const money = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });
const dimension = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

export function SignCart<T extends Record<string, unknown>>({
  items, onQuantityChange, onRemove, onEdit, onClear, error, onDismissError,
}: SignCartProps<T>) {
  const total = items.reduce((sum, item) => sum + (item.price ?? 0) * item.quantity, 0);
  const pending = items.filter(item => item.requiresApproval || item.price === null).length;
  const quantity = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <section className="sign-cart" id="sign-cart" aria-labelledby="sign-cart-heading">
      <header className="sign-cart-header">
        <div><h2 id="sign-cart-heading">Корзина макетов</h2><p>{items.length ? `${quantity} ${pluralize(quantity, "изделие", "изделия", "изделий")}` : "Соберите вывеску и добавьте ее сюда"}</p></div>
        {items.length > 0 && <button className="sign-cart-clear" type="button" onClick={onClear}><Trash2 size={15} />Очистить</button>}
      </header>

      {error && <div className="sign-cart-error" role="alert"><p>{error}</p>{onDismissError && <button type="button" aria-label="Закрыть сообщение корзины" onClick={onDismissError}><X size={17} /></button>}</div>}

      {items.length === 0 ? (
        <div className="sign-cart-empty"><ShoppingBag size={28} aria-hidden="true" /><div><strong>Пока нет макетов</strong><p>Настройте вывеску и нажмите «В корзину». Ее параметры сохранятся отдельной позицией.</p></div></div>
      ) : (
        <ul className="sign-cart-items">
          {items.map((item, index) => (
            <li className="sign-cart-item" key={item.id}>
              <div className="sign-cart-thumbnail" aria-hidden="true">{item.thumbnailSvg ? <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(item.thumbnailSvg)}`} alt="" loading="lazy" /> : <span>{item.label.slice(0, 2).toUpperCase()}</span>}</div>
              <div className="sign-cart-details"><h3>{item.label}</h3><p>{dimension.format(item.widthMm)} × {dimension.format(item.heightMm)} × {dimension.format(item.depthMm)} мм</p>
                {item.requiresApproval && <p className="sign-cart-approval">{item.approvalNote || "Стоимость требует согласования"}</p>}
                <button className="sign-cart-edit" type="button" onClick={() => onEdit(item)}>Открыть макет</button>
              </div>
              <div className="sign-cart-quantity" role="group" aria-label={`Количество: ${item.label}`}>
                <button type="button" aria-label={`Уменьшить количество: ${item.label}`} disabled={item.quantity <= 1} onClick={() => onQuantityChange(item.id, item.quantity - 1)}><Minus size={15} /></button>
                <label className="sign-cart-quantity-input"><span className="sign-cart-sr-only">Количество, позиция {index + 1}: {item.label}</span><input type="number" min={1} max={SIGN_CART_MAX_QUANTITY} step={1} inputMode="numeric" value={item.quantity} onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value)) onQuantityChange(item.id, value); }} onBlur={() => onQuantityChange(item.id, item.quantity)} /></label>
                <button type="button" aria-label={`Увеличить количество: ${item.label}`} disabled={item.quantity >= SIGN_CART_MAX_QUANTITY} onClick={() => onQuantityChange(item.id, item.quantity + 1)}><Plus size={15} /></button>
              </div>
              <div className="sign-cart-price">{item.price === null ? <strong>По согласованию</strong> : <><strong>{money.format(item.price * item.quantity)}</strong><span>{money.format(item.price)} / шт.</span></>}</div>
              <button className="sign-cart-remove" type="button" aria-label={`Удалить из корзины: ${item.label}`} onClick={() => onRemove(item.id)}><Trash2 size={17} /></button>
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && <footer className="sign-cart-footer"><div className="sign-cart-total"><span>Рассчитанная сумма</span><strong aria-live="polite">{money.format(total)}</strong></div>{pending > 0 && <p className="sign-cart-pending">{pending} {pluralize(pending, "позиция требует", "позиции требуют", "позиций требуют")} согласования. Их дополнительные работы или полная стоимость не включены в сумму.</p>}<p className="sign-cart-pending">Монтаж, подложка и доставка рассчитываются отдельно.</p><p className="sign-cart-local">Корзина сохраняется в этом браузере. Заказ еще не отправлен.</p></footer>}
    </section>
  );
}

function pluralize(count: number, one: string, few: string, many: string) {
  if (count % 10 === 1 && count % 100 !== 11) return one;
  if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) return few;
  return many;
}
