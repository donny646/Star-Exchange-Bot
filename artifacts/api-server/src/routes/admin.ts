import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { ordersTable, usersTable, settingsTable } from "@workspace/db";
import { eq, desc, count } from "drizzle-orm";

const router: IRouter = Router();

const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "admin123";

function requireAdmin(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction
) {
  const auth = req.headers["x-admin-secret"] ?? req.query.secret;
  if (auth !== ADMIN_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

router.get("/admin/orders", requireAdmin, async (_req, res) => {
  const orders = await db.select().from(ordersTable).orderBy(desc(ordersTable.createdAt));
  res.json(orders);
});

router.get("/admin/orders/:id", requireAdmin, async (req, res) => {
  const order = await db.select().from(ordersTable).where(eq(ordersTable.id, Number(req.params.id))).limit(1);
  if (!order[0]) { res.status(404).json({ error: "Not found" }); return; }
  res.json(order[0]);
});

router.patch("/admin/orders/:id", requireAdmin, async (req, res) => {
  const { status, adminNote } = req.body as { status?: string; adminNote?: string };

  type OrderUpdate = {
    updatedAt: Date;
    status?: "pending" | "proof_submitted" | "completed" | "cancelled";
    adminNote?: string;
  };

  const updateData: OrderUpdate = { updatedAt: new Date() };
  if (status) {
    updateData.status = status as OrderUpdate["status"];
  }
  if (adminNote !== undefined) {
    updateData.adminNote = adminNote;
  }

  const updated = await db
    .update(ordersTable)
    .set(updateData)
    .where(eq(ordersTable.id, Number(req.params.id)))
    .returning();

  res.json(updated[0]);
});

router.get("/admin/stats", requireAdmin, async (_req, res) => {
  const [totalOrders] = await db.select({ count: count() }).from(ordersTable);
  const [pendingOrders] = await db.select({ count: count() }).from(ordersTable).where(eq(ordersTable.status, "pending"));
  const [proofOrders] = await db.select({ count: count() }).from(ordersTable).where(eq(ordersTable.status, "proof_submitted"));
  const [completedOrders] = await db.select({ count: count() }).from(ordersTable).where(eq(ordersTable.status, "completed"));
  const [totalUsers] = await db.select({ count: count() }).from(usersTable);

  res.json({
    totalOrders: totalOrders.count,
    pendingOrders: pendingOrders.count,
    proofOrders: proofOrders.count,
    completedOrders: completedOrders.count,
    totalUsers: totalUsers.count,
  });
});

router.get("/admin/settings", requireAdmin, async (_req, res) => {
  const settings = await db.select().from(settingsTable);
  const result: Record<string, string> = {};
  for (const s of settings) { result[s.key] = s.value; }
  res.json(result);
});

router.put("/admin/settings", requireAdmin, async (req, res) => {
  const settings = req.body as Record<string, string>;
  for (const [key, value] of Object.entries(settings)) {
    if (!value) continue;
    await db.insert(settingsTable).values({ key, value })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
  }
  res.json({ success: true });
});

export default router;
