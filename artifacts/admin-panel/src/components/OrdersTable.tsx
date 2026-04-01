import { useEffect, useState } from "react";
import { api, type Order, type OrderStatus } from "../lib/api";

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Очікує оплати",
  proof_submitted: "Оплата надіслана",
  completed: "Виконано",
  cancelled: "Скасовано",
};

const STATUS_COLORS: Record<OrderStatus, string> = {
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  proof_submitted: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

interface Props {
  filter: OrderStatus | "all";
  refresh: number;
  onRefresh: () => void;
}

export function OrdersTable({ filter, refresh, onRefresh }: Props) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Order | null>(null);
  const [updating, setUpdating] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    setLoading(true);
    api.getOrders()
      .then((data) => {
        setOrders(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [refresh]);

  const filtered = filter === "all" ? orders : orders.filter((o) => o.status === filter);

  const handleUpdateStatus = async (id: number, status: OrderStatus) => {
    setUpdating(true);
    try {
      const updated = await api.updateOrder(id, { status, adminNote: note || undefined });
      setOrders((prev) => prev.map((o) => (o.id === id ? updated : o)));
      setSelected(null);
      setNote("");
      onRefresh();
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-card border border-card-border rounded-xl p-8 text-center text-muted-foreground">
        Завантаження...
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="bg-card border border-card-border rounded-xl p-8 text-center text-muted-foreground">
        Немає замовлень
      </div>
    );
  }

  return (
    <>
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Замовлення</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Користувач</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Зірки</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Сума</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Статус</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Дата</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Дії</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((order) => (
                <tr key={order.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs font-medium">{order.orderNumber}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{order.telegramFirstName ?? "—"}</div>
                    {order.telegramUsername && (
                      <div className="text-xs text-muted-foreground">@{order.telegramUsername}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium">⭐ {order.starsAmount}</span>
                  </td>
                  <td className="px-4 py-3 font-medium">{order.priceUah} грн</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[order.status]}`}>
                      {STATUS_LABELS[order.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(order.createdAt).toLocaleString("uk-UA", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => { setSelected(order); setNote(order.adminNote ?? ""); }}
                      className="text-xs text-primary hover:underline"
                    >
                      Деталі
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-card-border rounded-xl w-full max-w-lg shadow-2xl">
            <div className="p-6 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold text-lg">Замовлення {selected.orderNumber}</h3>
              <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-muted/30 rounded-lg p-3">
                  <div className="text-muted-foreground text-xs mb-1">Користувач</div>
                  <div className="font-medium">{selected.telegramFirstName ?? "—"}</div>
                  {selected.telegramUsername && <div className="text-xs">@{selected.telegramUsername}</div>}
                  <div className="text-xs text-muted-foreground">ID: {selected.telegramUserId}</div>
                </div>
                <div className="bg-muted/30 rounded-lg p-3">
                  <div className="text-muted-foreground text-xs mb-1">Замовлення</div>
                  <div className="font-medium">⭐ {selected.starsAmount} зірок</div>
                  <div className="text-xs">{selected.priceUah} грн</div>
                </div>
              </div>

              {selected.proofFileId && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-sm">
                  <div className="font-medium text-blue-700 dark:text-blue-300 mb-1">📸 Підтвердження оплати надіслано</div>
                  {selected.proofCaption && (
                    <div className="text-xs text-blue-600 dark:text-blue-400">{selected.proofCaption}</div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-1.5">Нотатка адміна</label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Додайте нотатку..."
                  rows={2}
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>

              <div>
                <div className="text-sm font-medium mb-2">Змінити статус</div>
                <div className="grid grid-cols-2 gap-2">
                  {selected.status !== "completed" && (
                    <button
                      disabled={updating}
                      onClick={() => handleUpdateStatus(selected.id, "completed")}
                      className="bg-green-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-green-600 transition-colors disabled:opacity-50"
                    >
                      ✅ Виконано
                    </button>
                  )}
                  {selected.status !== "cancelled" && (
                    <button
                      disabled={updating}
                      onClick={() => handleUpdateStatus(selected.id, "cancelled")}
                      className="bg-red-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-red-600 transition-colors disabled:opacity-50"
                    >
                      ❌ Скасувати
                    </button>
                  )}
                  {selected.status !== "pending" && (
                    <button
                      disabled={updating}
                      onClick={() => handleUpdateStatus(selected.id, "pending")}
                      className="bg-amber-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-amber-600 transition-colors disabled:opacity-50"
                    >
                      ⏳ Очікує
                    </button>
                  )}
                  <button
                    disabled={updating}
                    onClick={() => handleUpdateStatus(selected.id, selected.status)}
                    className="bg-secondary text-secondary-foreground py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    💾 Зберегти нотатку
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
