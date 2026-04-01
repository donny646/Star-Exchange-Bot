import { useState } from "react";

interface Props {
  onLogin: (secret: string) => void;
}

export function LoginPage({ onLogin }: Props) {
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/admin/stats", {
        headers: { "x-admin-secret": secret },
      });
      if (res.status === 401) {
        setError("Невірний пароль");
        return;
      }
      localStorage.setItem("admin_secret", secret);
      onLogin(secret);
    } catch {
      setError("Помилка з'єднання");
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="bg-card border border-card-border rounded-xl p-8 shadow-lg">
          <div className="text-center mb-8">
            <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">⭐</span>
            </div>
            <h1 className="text-2xl font-bold text-foreground">Admin Panel</h1>
            <p className="text-sm text-muted-foreground mt-1">Telegram Stars Shop</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Пароль адміністратора
              </label>
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="Введіть пароль..."
                className="w-full px-3 py-2 bg-background border border-input rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <button
              type="submit"
              className="w-full bg-primary text-primary-foreground py-2.5 rounded-lg font-medium hover:opacity-90 transition-opacity"
            >
              Увійти
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
