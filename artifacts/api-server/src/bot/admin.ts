import TelegramBot from "node-telegram-bot-api";
import { db } from "@workspace/db";
import { ordersTable, settingsTable } from "@workspace/db";
import { eq, desc, count } from "drizzle-orm";
import { logger } from "../lib/logger";

type AdminStateData =
  | { step: "await_card" | "await_channel" | "await_admin_chat" | "await_whitelist" }
  | { step: "await_msg"; customerId: string; orderNumber: string };

const adminState: Map<string, AdminStateData> = new Map();

// Maps customer userId → admin chatId for active conversations
export const customerToAdmin: Map<string, number> = new Map();

// Customers who pressed "Відповісти адміну" and are ready to send one message
export const customerReplyMode: Set<string> = new Set();

function esc(text: string | null | undefined): string {
  return (text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

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
    .where(eq(ordersTable.status, "proof_submitted"))
    .orderBy(desc(ordersTable.createdAt));

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
      `📋 <code>${esc(order.orderNumber)}</code>\n` +
      `👤 ${esc(user)} (ID: <code>${esc(order.telegramUserId)}</code>)\n` +
      `⭐ ${order.starsAmount} зірок • ${order.priceUah} грн\n` +
      `📊 ${statusLabel}\n` +
      `📅 ${date}` +
      (order.proofCaption ? `\n💬 ${esc(order.proofCaption)}` : "");

    const keyboard = {
      inline_keyboard: [
        [
          { text: "✅ Виконано", callback_data: `adm_complete_${order.id}` },
          { text: "❌ Скасувати", callback_data: `adm_cancel_${order.id}` },
        ],
        [
          { text: "💬 Написати клієнту", callback_data: `adm_msg_${order.id}` },
        ],
      ],
    };

    try {
      if (order.proofFileId) {
        try {
          await bot.sendPhoto(chatId, order.proofFileId, { caption: text, parse_mode: "HTML", reply_markup: keyboard });
        } catch {
          await bot.sendDocument(chatId, order.proofFileId, { caption: text, parse_mode: "HTML", reply_markup: keyboard });
        }
      } else {
        await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
      }
    } catch (err) {
      logger.warn({ err, orderId: order.id }, "Failed to send order card to admin");
      await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
    }
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
    .orderBy(desc(ordersTable.createdAt));

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
    `✅ *Виконані замовлення* (${orders.length})\n\n${lines.join("\n")}`,
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

  bot.onText(/\/checkverify$/, async (msg) => {
    try {
      const chatId = msg.chat.id;
      const userId = msg.from!.id;

      if (!(await isAdmin(userId))) {
        await bot.sendMessage(chatId, "❌ У вас немає доступу до цієї команди.");
        return;
      }

      const rawChannel = await getSetting("verification_channel");
      if (!rawChannel) {
        await bot.sendMessage(chatId, "⚠️ `verification_channel` не налаштовано в базі — перевірка вимкнена, всі користувачі проходять.", { parse_mode: "Markdown" });
        return;
      }

      let channelUsername = rawChannel.trim().replace(/^https?:\/\/t\.me\//i, "").replace(/^t\.me\//i, "");
      if (!/^-?\d+$/.test(channelUsername) && !channelUsername.startsWith("@")) {
        channelUsername = "@" + channelUsername;
      }

      await bot.sendMessage(chatId, `🔍 Канал у базі: \`${rawChannel}\`\nНормалізовано: \`${channelUsername}\`\n\nПеревіряю ваш статус (ID: \`${userId}\`)...`, { parse_mode: "Markdown" });

      try {
        const member = await bot.getChatMember(channelUsername, userId);
        await bot.sendMessage(
          chatId,
          `✅ *getChatMember працює!*\n\nВаш статус: \`${member.status}\`\n\nДозволені статуси: member, administrator, creator`,
          { parse_mode: "Markdown" }
        );
      } catch (err: any) {
        await bot.sendMessage(
          chatId,
          `❌ *getChatMember помилка:*\n\n\`${err?.message ?? String(err)}\``,
          { parse_mode: "Markdown" }
        );
      }
    } catch (err) {
      logger.error({ err }, "Error in /checkverify");
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
  const stateData = adminState.get(userId);
  if (!stateData) return false;

  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  if (!text || text.startsWith("/")) return false;

  adminState.delete(userId);

  if (stateData.step === "await_card") {
    await setSetting("card_number", text);
    await bot.sendMessage(chatId, `✅ Номер картки оновлено: \`${text}\``, { parse_mode: "Markdown" });
    await sendAdminMenu(bot, chatId);
  } else if (stateData.step === "await_channel") {
    await setSetting("verification_channel", text);
    await bot.sendMessage(chatId, `✅ Канал оновлено: ${text}`);
    await sendAdminMenu(bot, chatId);
  } else if (stateData.step === "await_admin_chat") {
    await setSetting("admin_chat_id", text);
    await bot.sendMessage(chatId, `✅ Admin Chat ID оновлено: \`${text}\``, { parse_mode: "Markdown" });
    await sendAdminMenu(bot, chatId);
  } else if (stateData.step === "await_whitelist") {
    await setSetting("admin_whitelist", text);
    await bot.sendMessage(chatId, `✅ Список адмінів оновлено: \`${text}\``, { parse_mode: "Markdown" });
    await sendAdminMenu(bot, chatId);
  } else if (stateData.step === "await_msg") {
    const { customerId, orderNumber } = stateData;
    try {
      await bot.sendMessage(
        Number(customerId),
        `📩 *Повідомлення від підтримки*\n_(Замовлення \`${orderNumber}\`)_\n\n${text}`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "↩️ Відповісти адміну", callback_data: "reply_admin" }]],
          },
        }
      );
      // Link customer → admin chat for relaying replies
      customerToAdmin.set(customerId, chatId);
      await bot.sendMessage(chatId, `✅ Повідомлення надіслано клієнту (ID: \`${customerId}\`).\n\nЯкщо клієнт натисне «Відповісти адміну» — ви отримаєте відповідь тут.`, { parse_mode: "Markdown" });
    } catch (err: any) {
      await bot.sendMessage(chatId, `❌ Не вдалося надіслати повідомлення клієнту: ${err?.message}`);
    }
  }

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
  try { await bot.deleteMessage(chatId, query.message!.message_id); } catch {}

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
      adminState.set(String(userId), { step: "await_card" });
      await bot.sendMessage(chatId, "💳 Введіть новий номер картки:");
    } else if (data === "adm_set_channel") {
      adminState.set(String(userId), { step: "await_channel" });
      await bot.sendMessage(chatId, "📢 Введіть юзернейм каналу (наприклад @mychannel):");
    } else if (data === "adm_set_adminchat") {
      adminState.set(String(userId), { step: "await_admin_chat" });
      await bot.sendMessage(chatId, "👨‍💼 Введіть Telegram Chat ID для сповіщень про замовлення:");
    } else if (data === "adm_set_whitelist") {
      adminState.set(String(userId), { step: "await_whitelist" });
      await bot.sendMessage(
        chatId,
        "📝 Введіть Telegram User ID адмінів через кому:\n\n_Приклад: 123456789, 987654321_\n\nДізнатись свій ID можна через @userinfobot",
        { parse_mode: "Markdown" }
      );
    } else if (data.startsWith("adm_msg_")) {
      const id = Number(data.replace("adm_msg_", ""));
      const orders = await db.select().from(ordersTable).where(eq(ordersTable.id, id)).limit(1);
      if (!orders[0]) {
        await bot.sendMessage(chatId, "❌ Замовлення не знайдено.");
      } else {
        const order = orders[0];
        adminState.set(String(userId), {
          step: "await_msg",
          customerId: order.telegramUserId,
          orderNumber: order.orderNumber,
        });
        await bot.sendMessage(
          chatId,
          `💬 Введіть повідомлення для клієнта\n_(Замовлення \`${order.orderNumber}\`, ID клієнта: \`${order.telegramUserId}\`)_\n\nКлієнт отримає його від імені бота і зможе відповісти:`,
          { parse_mode: "Markdown" }
        );
      }
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
            `🎉 *Замовлення виконано!*\n\n📋 Замовлення: \`${updated[0].orderNumber}\`\n⭐ Зірки (${updated[0].starsAmount}) надіслані на ваш акаунт!\n\nДякуємо за покупку! 🙏\n\n💬 Будемо вдячні, якщо ви залишите відгук — це займе лише хвилину!`,
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [[{ text: "💬 Залишити відгук", callback_data: `leave_review_${updated[0].starsAmount}` }]],
              },
            }
          );
        } catch {}
      }
      await bot.sendMessage(chatId, `✅ Замовлення виконано!`, {
        reply_markup: { inline_keyboard: [[{ text: "🔙 Назад до замовлень", callback_data: "adm_orders_new" }]] },
      });
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
      await bot.sendMessage(chatId, `❌ Замовлення скасовано.`, {
        reply_markup: { inline_keyboard: [[{ text: "🔙 Назад до замовлень", callback_data: "adm_orders_new" }]] },
      });
    }
  } catch (err) {
    logger.error({ err }, "Error in admin callback");
  }

  return true;
}
