import { useEffect, useState } from "react";
import { api, type Stats } from "../lib/api";

export function StatsCards() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api.getStats().then(setStats).catch(console.error);
  }, []);

  const cards = [
    { label: "Всього замовлень", value: stats?.totalOrders ?? "—", color: "text-primary", icon: "📋" },
    { label: "Очікують оплати", value: stats?.pendingOrders ?? "—", color: "text-amber-500", icon: "⏳" },
    { label: "Перевірити оплату", value: stats?.proofOrders ?? "—", color: "text-blue-500", icon: "🔍" },
    { label: "Виконано", value: stats?.completedOrders ?? "—", color: "text-green-500", icon: "✅" },
    { label: "Користувачів", value: stats?.totalUsers ?? "—", color: "text-purple-500", icon: "👥" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
      {cards.map((card) => (
        <div key={card.label} className="bg-card border border-card-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-lg">{card.icon}</span>
          </div>
          <div className={`text-2xl font-bold ${card.color}`}>{card.value}</div>
          <div className="text-xs text-muted-foreground mt-1">{card.label}</div>
        </div>
      ))}
    </div>
  );
}
