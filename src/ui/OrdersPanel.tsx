// (v3.0) The town center's orders panel (Build Spec v3.0, Section 18). Opened by tapping the town
// center on the map or the Orders button beside the build panel button, in both layouts.

import { amount } from '../game/buildings';
import { LOOP_SUMMARY, condText, discardLine, DISCARD_EVERY } from '../game/orders';
import { discardOrder, openOrders, useGame } from '../game/store';

export function OrdersPanel() {
  const open = useGame((s) => s.ordersOpen);
  const orders = useGame((s) => s.orders);
  const since = useGame((s) => s.wordsSinceDiscard);
  const words = useGame((s) => s.lifetime.validWords);
  const mode = useGame((s) => s.mode);
  if (!open || mode === 'title') return null;
  const ready = since >= DISCARD_EVERY;
  return (
    <div className="orders-panel panel" role="dialog" aria-label="Commission orders">
      <div className="orders-head">
        <h2>Town Center: Commissions</h2>
        <button className="pill" onClick={() => openOrders(false)}>
          Close
        </button>
      </div>
      <p className="orders-summary">{LOOP_SUMMARY}</p>
      <ul className="orders-list">
        {orders.map((o) => {
          const age = words - o.postedAt;
          return (
            <li key={o.id} className="order" data-order={o.id}>
              <p className="order-cond">{condText(o.cond)}</p>
              <p className="order-reward">
                Pays {amount(o.reward.res, o.reward.amount)}. <span className="muted">Open for {age} word{age === 1 ? '' : 's'}.</span>
              </p>
              <button className="pill order-discard" disabled={!ready} onClick={() => discardOrder(o.id)}>
                Discard
              </button>
            </li>
          );
        })}
      </ul>
      <p className="orders-discard">{discardLine(since)} Orders never expire.</p>
    </div>
  );
}
