const BASE = "/api";
const ADMIN_SECRET = localStorage.getItem("admin_secret") ?? "";

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-admin-secret": localStorage.getItem("admin_secret") ?? "",
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error("unauthorized");
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

export type OrderStatus = "pending" | "proof_submitted" | "completed" | "cancelled";

export interface Order {
  id: number;
  orderNumber: string;
  telegramUserId: string;
  telegramUsername: string | null;
  telegramFirstName: string | null;
  starsAmount: number;
  priceUah: number;
  status: OrderStatus;
  proofFileId: string | null;
  proofCaption: string | null;
  adminNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Stats {
  totalOrders: number;
  pendingOrders: number;
  proofOrders: number;
  completedOrders: number;
  totalUsers: number;
}

export interface Settings {
  card_number?: string;
  verification_channel?: string;
  admin_chat_id?: string;
}

export const api = {
  getOrders: () => apiFetch("/admin/orders") as Promise<Order[]>,
  getStats: () => apiFetch("/admin/stats") as Promise<Stats>,
  getSettings: () => apiFetch("/admin/settings") as Promise<Settings>,
  updateSettings: (settings: Settings) =>
    apiFetch("/admin/settings", { method: "PUT", body: JSON.stringify(settings) }),
  updateOrder: (id: number, data: Partial<Pick<Order, "status" | "adminNote">>) =>
    apiFetch(`/admin/orders/${id}`, { method: "PATCH", body: JSON.stringify(data) }) as Promise<Order>,
};
