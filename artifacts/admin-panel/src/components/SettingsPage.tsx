import { useEffect, useState } from "react";
import { api, type Settings } from "../lib/api";

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s);
      setLoading(false);
    });
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await api.updateSettings(settings);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (loading) {
    return <div className="text-muted-foreground text-sm p-4">Завантаження...</div>;
  }

  return (
    <div className="max-w-2xl">
      <form onSubmit={handleSave} className="space-y-4">
        <div className="bg-card border border-card-border rounded-xl p-6 space-y-5">
          <h3 className="font-semibold text-base">Налаштування бота</h3>

          <div>
            <label className="block text-sm font-medium mb-1.5">
              💳 Номер картки для оплати
            </label>
            <input
              type="text"
              value={settings.card_number ?? ""}
              onChange={(e) => setSettings({ ...settings, card_number: e.target.value })}
              placeholder="4441 1111 2222 3333"
              className="w-full px-3 py-2 bg-background border border-input rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Цей номер буде показаний покупцям при оформленні замовлення
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">
              📢 Канал (відгуки та верифікація підписки)
            </label>
            <input
              type="text"
              value={settings.verification_channel ?? ""}
              onChange={(e) => setSettings({ ...settings, verification_channel: e.target.value })}
              placeholder="@your_channel або -100123456789"
              className="w-full px-3 py-2 bg-background border border-input rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Використовується для розділу «Відгуки» та обов'язкової підписки. Залиште порожнім, щоб відключити перевірку.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">
              👨‍💼 Chat ID адміна для сповіщень
            </label>
            <input
              type="text"
              value={settings.admin_chat_id ?? ""}
              onChange={(e) => setSettings({ ...settings, admin_chat_id: e.target.value })}
              placeholder="123456789"
              className="w-full px-3 py-2 bg-background border border-input rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Telegram Chat ID для отримання сповіщень про нові замовлення. Дізнайтесь свій ID через @userinfobot.
            </p>
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="bg-primary text-primary-foreground px-6 py-2.5 rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-50 text-sm"
        >
          {saving ? "Збереження..." : saved ? "✅ Збережено!" : "Зберегти налаштування"}
        </button>
      </form>
    </div>
  );
}
