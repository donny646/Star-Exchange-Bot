import TelegramBot from "node-telegram-bot-api";
import { db } from "@workspace/db";
import { ordersTable, settingsTable } from "@workspace/db";
import { eq, desc, or, count } from "drizzle-orm";
import { logger } from "../lib/logger";

type AdminStep =
  | "await_card"
  | "await_channel"
  | "await_admin_chat"
  | "await_whitelist";

const adminState: Map<string, AdminStep> = new Map();

async function getSetting(key: string): Promise<string | null> {
  const result = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, key))
    .limit(1);
  return result[0]?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(settingsTable)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value, updatedAt: new Date() },
    });
}

export async function isAdmin(userId: number): Promise<boolean> {
  const whitelist = await getSetting("admin_whitelist");
  if (!whitelist) return false;
  return whitelist
    .split(",")
    .map((id) => id.trim())
    .includes(String(userId));
}

function adminMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "📊 Статистика", callback_data: "adm_stats" }],
      [{ text: "📋 Нові замовлення", callback_data: "adm_orders_new" }],
      [{ text: "✅ Виконані замовлення", callback_data: "adm_orders_done" }],
      [{ text: "⚙️ Налаштування", callback_data: "adm_settings" }],
    ],
  };
}

async function sendAdminMenu(bot: TelegramBot, chatId: number) {
  await bot.sendMessage(chatId, "👨‍💼 *Адмін Панель*\n\nОберіть розділ:", {
    parse_mode: "Markdown",
    reply_markup: adminMenuKeyboard(),
  });
}

async function sendStats(bot: TelegramBot, chatId: number) {
  const [total] = await db.select({ count: count() }).from(ordersTable);
  const [pending] = await db
    .select({ count: count() })
    .from(ordersTable)
    .where(eq(ordersTable.status, "pending"));
  const [proof] = await db
    .select({ count: count() })
    .from(ordersTable)
    .where(eq(ordersTable.status, "proof_submitted"));
  const [completed] = await db
    .select({ count: count() })
    .from(ordersTable)
    .where(eq(ordersTable.status, "completed"));
  const [cancelled] = await db
    .select({ count: count() })
    .from(ordersTable)
    .where(eq(ordersTable.status, "cancelled"));

  const text =
    `📊 *Статистика*\n\n` +
    `📋 Всього замовлень: *${total.count}*\n` +
    `⏳ Очікують оплати: *${pending.count}*\n` +
    `🔍 Перевірити оплату: *${proof.count}*\n` +
    `✅ Виконано: *${completed.count}*\n` +
    `❌ Скасовано: *${cancelled.count}*`;

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [[{ text: "🔙 Назад", callback_data: "adm_menu" }]],
    },
  });
}

async function sendNewOrders(bot: TelegramBot, chatId: number) {
  const orders = await db
    .select()
    .from(ordersTable)
    .where(
      or(
        eq(ordersTable.status, "pending"),
        eq(ordersTable.status, "proof_submitted")
      )
    )
    .orderBy(desc(ordersTable.createdAt))
    .limit(10);

  if (orders.length === 0) {
    await bot.sendMessage(chatId, "✅ Нових замовлень немає.", {
      reply_markup: {
        inline_keyboard: [[{ text: "🔙 Назад", callback_data: "adm_menu" }]],
      },
    });
    return;
  }

  for (const order of orders) {
    const statusLabel =
      order.status === "pending"
        ? "⏳ Очікує оплати"
        : "🔍 Оплата надіслана";
    const nameParts = [
      order.telegramFirstName,
      order.telegramUsername ? `@${order.telegramUsername}` : null,
    ].filter(Boolean);
    const user = nameParts.length > 0 ? nameParts.join(" ") : "—";
    const date = new Date(order.createdAt).toLocaleString("uk-UA", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

    const text =
      `📋 \`${order.orderNumber}\`\n` +
      `👤 ${user} (ID: \`${order.telegramUserId}\`)\n` +
      `⭐ ${order.starsAmount} зірок • ${order.priceUah} грн\n` +
      `📊 ${statusLabel}\n` +
      `📅 ${date}`;

    await bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "✅ Виконано",
              callback_data: `adm_complete_${order.id}`,
            },
            {
              text: "❌ Скасувати",
              callback_data: `adm_cancel_${order.id}`,
            },
          ],
        ],
      },
    });
  }

  await bot.sendMessage(chatId, `⬆️ Показано ${orders.length} замовлень`, {
    reply_markup: {
      inline_keyboard: [[{ text: "🔙 Назад", callback_data: "adm_menu" }]],
    },
  });
}

async function sendCompletedOrders(bot: TelegramBot, chatId: number) {
  const orders = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.status, "completed"))
    .orderBy(desc(ordersTable.createdAt))
    .limit(10);

  if (orders.length === 0) {
    await bot.sendMessage(chatId, "Виконаних замовлень ще немає.", {
      reply_markup: {
        inline_keyboard: [[{ text: "🔙 Назад", callback_data: "adm_menu" }]],
      },
    });
    return;
  }

  const lines = orders.map((o) => {
    const date = new Date(o.createdAt).toLocaleString("uk-UA", {
      day: "2-digit",
      month: "2-digit",
    });
    const user = o.telegramUsername
      ? `@${o.telegramUsername}`
      : (o.telegramFirstName ?? "—");
    return `✅ \`${o.orderNumber}\` • ${user} • ⭐${o.starsAmount} • ${o.priceUah} грн • ${date}`;
  });

  await bot.sendMessage(
    chatId,
    `✅ *Останні виконані замовлення*\n\n${lines.join("\n")}`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[{ text: "🔙 Назад", callback_data: "adm_menu" }]],
      },
    }
  );
}

async function sendSettingsMenu(bot: TelegramBot, chatId: number) {
  const cardNumber = await getSetting("card_number");
  const channel = await getSetting("verification_channel");
  const adminChatId = await getSetting("admin_chat_id");
  const whitelist = await getSetting("admin_whitelist");

  const text =
    `⚙️ *Налаштування*\n\n` +
    `💳 Картка: ${cardNumber ? `\`${cardNumber}\`` : "_не вказана_"}\n` +
    `📢 Канал: ${channel ? channel : "_не вказаний_"}\n` +
    `👨‍💼 Admin Chat ID: ${adminChatId ? `\`${adminChatId}\`` : "_не вказаний_"}\n` +
    `📝 Адміни: ${whitelist ? `\`${whitelist}\`` : "_не вказані_"}`;

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "💳 Змінити картку", callback_data: "adm_set_card" }],
        [{ text: "📢 Змінити канал", callback_data: "adm_set_channel" }],
        [
          {
            text: "👨‍💼 Змінити Admin Chat ID",
            callback_data: "adm_set_adminchat",
          },
        ],
        [
          {
            text: "📝 Список адмінів бота",
            callback_data: "adm_set_whitelist",
          },
        ],
        [{ text: "🔙 Назад", callback_data: "adm_menu" }],
      ],
    },
  });
}

export function setupAdminHandlers(bot: TelegramBot) {
  bot.onText(/\/admin$/, async (msg) => {
    try {
      const chatId = msg.chat.id;
      if (!(await isAdmin(msg.from!.id))) {
        await bot.sendMessage(chatId, "❌ У вас немає доступу до адмін панелі.");
        return;
      }
      await sendAdminMenu(bot, chatId);
    } catch (err) {
      logger.error({ err }, "Error in /admin command");
    }
  });

  bot.onText(/\/addadmin(?:\s+(\d+))?$/, async (msg, match) => {
    try {
      const chatId = msg.chat.id;
      const callerId = msg.from!.id;
      const targetId = match?.[1];

      if (!targetId) {
        await bot.sendMessage(
          chatId,
          "ℹ️ Використання: `/addadmin <user_id>`\n\nДізнатись User ID можна через @userinfobot",
          { parse_mode: "Markdown" }
        );
        return;
      }

      const whitelist = await getSetting("admin_whitelist");
      const ids = whitelist
        ? whitelist.split(",").map((id) => id.trim()).filter(Boolean)
        : [];

      // Allow bootstrap if whitelist is empty; otherwise require existing admin
      if (ids.length > 0 && !ids.includes(String(callerId))) {
        await bot.sendMessage(chatId, "❌ У вас немає доступу до цієї команди.");
        return;
      }

      if (ids.includes(targetId)) {
        await bot.sendMessage(chatId, `ℹ️ ID \`${targetId}\` вже є в списку адмінів.`, {
          parse_mode: "Markdown",
        });
        return;
      }

      ids.push(targetId);
      await setSetting("admin_whitelist", ids.join(", "));
      await bot.sendMessage(
        chatId,
        `✅ Адміна \`${targetId}\` додано. Повний список: \`${ids.join(", ")}\``,
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      logger.error({ err }, "Error in /addadmin command");
    }
  });
}

export async function handleAdminMessage(
  bot: TelegramBot,
  msg: TelegramBot.Message
): Promise<boolean> {
  const userId = String(msg.from!.id);
  const step = adminState.get(userId);
  if (!step) return false;

  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  if (!text || text.startsWith("/")) return false;

  adminState.delete(userId);

  if (step === "await_card") {
    await setSetting("card_number", text);
    await bot.sendMessage(chatId, `✅ Номер картки оновлено: \`${text}\``, {
      parse_mode: "Markdown",
    });
  } else if (step === "await_channel") {
    await setSetting("verification_channel", text);
    await bot.sendMessage(chatId, `✅ Канал оновлено: ${text}`);
  } else if (step === "await_admin_chat") {
    await setSetting("admin_chat_id", text);
    await bot.sendMessage(
      chatId,
      `✅ Admin Chat ID оновлено: \`${text}\``,
      { parse_mode: "Markdown" }
    );
  } else if (step === "await_whitelist") {
    await setSetting("admin_whitelist", text);
    await bot.sendMessage(
      chatId,
      `✅ Список адмінів оновлено: \`${text}\``,
      { parse_mode: "Markdown" }
    );
  }

  await sendAdminMenu(bot, chatId);
  return true;
}

export async function handleAdminCallback(
  bot: TelegramBot,
  query: TelegramBot.CallbackQuery
): Promise<boolean> {
  const data = query.data ?? "";
  if (!data.startsWith("adm_")) return false;

  const chatId = query.message?.chat.id!;
  const userId = query.from.id;

  if (!(await isAdmin(userId))) {
    await bot.answerCallbackQuery(query.id, { text: "❌ Немає доступу" });
    return true;
  }

  await bot.answerCallbackQuery(query.id);

  try {
    if (data === "adm_menu") {
      await sendAdminMenu(bot, chatId);
    } else if (data === "adm_stats") {
      await sendStats(bot, chatId);
    } else if (data === "adm_orders_new") {
      await sendNewOrders(bot, chatId);
    } else if (data === "adm_orders_done") {
      await sendCompletedOrders(bot, chatId);
    } else if (data === "adm_settings") {
      await sendSettingsMenu(bot, chatId);
    } else if (data === "adm_set_card") {
      adminState.set(String(userId), "await_card");
      await bot.sendMessage(chatId, "💳 Введіть новий номер картки:");
    } else if (data === "adm_set_channel") {
      adminState.set(String(userId), "await_channel");
      await bot.sendMessage(
        chatId,
        "📢 Введіть юзернейм каналу (наприклад @mychannel):"
      );
    } else if (data === "adm_set_adminchat") {
      adminState.set(String(userId), "await_admin_chat");
      await bot.sendMessage(
        chatId,
        "👨‍💼 Введіть Telegram Chat ID для сповіщень про замовлення:"
      );
    } else if (data === "adm_set_whitelist") {
      adminState.set(String(userId), "await_whitelist");
      await bot.sendMessage(
        chatId,
        "📝 Введіть Telegram User ID адмінів через кому:\n\n_Приклад: 123456789, 987654321_\n\nДізнатись свій ID можна через @userinfobot",
        { parse_mode: "Markdown" }
      );
    } else if (data.startsWith("adm_complete_")) {
      const id = Number(data.replace("adm_complete_", ""));
      const updated = await db
        .update(ordersTable)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(ordersTable.id, id))
        .returning();
      if (updated[0]) {
        try {
          await bot.sendMessage(
            Number(updated[0].telegramUserId),
            `🎉 *Замовлення виконано!*\n\n📋 Замовлення: \`${updated[0].orderNumber}\`\n⭐ Зірки (${updated[0].starsAmount}) надіслані на ваш акаунт!\n\nДякуємо за покупку! 🙏`,
            { parse_mode: "Markdown" }
          );
        } catch {}
      }
      await bot.sendMessage(chatId, `✅ Замовлення виконано!`);
    } else if (data.startsWith("adm_cancel_")) {
      const id = Number(data.replace("adm_cancel_", ""));
      const updated = await db
        .update(ordersTable)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(ordersTable.id, id))
        .returning();
      if (updated[0]) {
        try {
          await bot.sendMessage(
            Number(updated[0].telegramUserId),
            `❌ *Замовлення скасовано*\n\n📋 Замовлення: \`${updated[0].orderNumber}\`\n\nЯкщо є питання — зверніться до підтримки:\n👤 @obnali4it\n👤 @donnyadm`,
            { parse_mode: "Markdown" }
          );
        } catch {}
      }
      await bot.sendMessage(chatId, `❌ Замовлення скасовано.`);
    }
  } catch (err) {
    logger.error({ err }, "Error in admin callback");
  }

  return true;
}
