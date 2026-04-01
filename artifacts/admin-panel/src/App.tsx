import { useState, useEffect } from "react";
import { LoginPage } from "./components/LoginPage";
import { StatsCards } from "./components/StatsCards";
import { OrdersTable } from "./components/OrdersTable";
import { SettingsPage } from "./components/SettingsPage";
import type { OrderStatus } from "./lib/api";

type Tab = "all" | "proof_submitted" | "pending" | "completed" | "settings";

const TAB_LABELS: Record<Tab, string> = {
  all: "Всі замовлення",
  proof_submitted: "🔍 Перевірити",
  pending: "⏳ Очікують",
  completed: "✅ Виконано",
  settings: "⚙️ Налаштування",
};

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<Tab>("proof_submitted");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const secret = localStorage.getItem("admin_secret");
    if (secret) {
      fetch("/api/admin/stats", { headers: { "x-admin-secret": secret } })
        .then((r) => { if (r.ok) setAuthed(true); })
        .catch(() => {});
    }
  }, []);

  if (!authed) {
    return <LoginPage onLogin={() => setAuthed(true)} />;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl">⭐</span>
            <div>
              <h1 className="font-bold text-base">Stars Shop Admin</h1>
              <p className="text-xs text-muted-foreground">Панель управління</p>
            </div>
          </div>
          <button
            onClick={() => { localStorage.removeItem("admin_secret"); setAuthed(false); }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Вийти
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <StatsCards />

        <div className="flex flex-wrap gap-1 mb-5 bg-muted/30 border border-border p-1 rounded-xl w-fit">
          {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                tab === t
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        {tab === "settings" ? (
          <SettingsPage />
        ) : (
          <OrdersTable
            filter={tab === "all" ? "all" : (tab as OrderStatus)}
            refresh={refresh}
            onRefresh={() => setRefresh((n) => n + 1)}
          />
        )}
      </main>
    </div>
  );
}
