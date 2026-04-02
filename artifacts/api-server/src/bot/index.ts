import TelegramBot from "node-telegram-bot-api";
import { db } from "@workspace/db";
import { ordersTable, usersTable, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import https from "https";
import {
  setupAdminHandlers,
  handleAdminMessage,
  handleAdminCallback,
  customerToAdmin,
} from "./admin";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  logger.warn("TELEGRAM_BOT_TOKEN is not set — Telegram bot will not start");
}

// Drop any existing webhook/polling session before starting
function deleteWebhookAndDrop(): Promise<void> {
  if (!token) return Promise.resolve();
  return new Promise((resolve) => {
    const url = `https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=true`;
    https.get(url, (res) => {
      res.resume();
      res.on("end", () => {
        logger.info("Cleared existing Telegram webhook/session");
        resolve();
      });
    }).on("error", () => resolve());
  });
}

if (token) {
  await deleteWebhookAndDrop();
}

export const bot = token ? new TelegramBot(token, {
  polling: {
    interval: 300,
    autoStart: true,
    params: { timeout: 10 },
  },
}) : null;

if (bot) {
  bot.on("polling_error", (err) => {
    logger.warn({ err: err.message }, "Telegram polling error — will retry");
  });
}

const STAR_PACKAGES = [
  { stars: 50, price: 40 },
  { stars: 100, price: 78 },
  { stars: 200, price: 156 },
  { stars: 500, price: 390 },
];

async function getSetting(key: string): Promise<string | null> {
  const result = await db.select().from(settingsTable).where(eq(settingsTable.key, key)).limit(1);
  return result[0]?.value ?? null;
}

async function generateOrderNumber(): Promise<string> {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const random = Math.floor(Math.random() * 9000) + 1000;
  return `ORD-${year}${month}${day}-${random}`;
}

function normalizeChannel(raw: string): string {
  // Strip https://t.me/ or t.me/ prefix if someone pasted a link
  let ch = raw.trim().replace(/^https?:\/\/t\.me\//i, "").replace(/^t\.me\//i, "");
  // Numeric chat ID — return as-is
  if (/^-?\d+$/.test(ch)) return ch;
  // Ensure @username format
  if (!ch.startsWith("@")) ch = "@" + ch;
  return ch;
}

async function isUserSubscribed(userId: number): Promise<boolean> {
  if (!bot) return true;
  const raw = await getSetting("verification_channel");
  if (!raw) return true;
  const channelId = normalizeChannel(raw);
  try {
    const member = await bot.getChatMember(channelId, userId);
    logger.info({ channelId, userId, status: member.status }, "getChatMember result");
    return ["member", "administrator", "creator"].includes(member.status);
  } catch (err: any) {
    logger.warn(
      { channelId, userId, err: err?.message },
      "getChatMember failed — check bot is admin of channel and channel value is correct"
    );
    return false;
  }
}

async function getOrCreateUser(msg: TelegramBot.Message) {
  const telegramUserId = String(msg.from!.id);
  const existing = await db.select().from(usersTable).where(eq(usersTable.telegramUserId, telegramUserId)).limit(1);
  if (existing.length > 0) return existing[0];
  const [user] = await db.insert(usersTable).values({
    telegramUserId,
    telegramUsername: msg.from?.username ?? null,
    telegramFirstName: msg.from?.first_name ?? null,
    telegramLastName: msg.from?.last_name ?? null,
    isVerified: false,
  }).returning();
  return user;
}

function mainKeyboard(): TelegramBot.ReplyKeyboardMarkup {
  return {
    keyboard: [
      [{ text: "⭐ Купити Зірки" }],
      [{ text: "💬 Відгуки" }, { text: "🛟 Служба Підтримки" }],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  };
}

async function sendSubscriptionRequired(chatId: number) {
  if (!bot) return;
  const channelUsername = await getSetting("verification_channel");

  const inlineButtons: TelegramBot.InlineKeyboardButton[][] = [];

  if (channelUsername) {
    const domain = normalizeChannel(channelUsername).replace("@", "");
    const channelLink = /^-?\d+$/.test(domain)
      ? `https://t.me/c/${domain.replace("-100", "")}`
      : `tg://resolve?domain=${domain}`;
    inlineButtons.push([{ text: "📢 Підписатися на канал", url: channelLink }]);
  }

  inlineButtons.push([{ text: "✅ Я підписався — перевірити", callback_data: "check_sub" }]);

  await bot.sendMessage(
    chatId,
    `❌ *Доступ заборонено*\n\nДля використання бота необхідно підписатися на наш канал.\n\nПісля підписки натисніть кнопку нижче:`,
    {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: inlineButtons },
    }
  );
}

async function sendMainMenu(chatId: number, firstName: string) {
  if (!bot) return;
  await bot.sendMessage(
    chatId,
    `👋 Привіт, *${firstName}*!\n\nЯ допоможу вам купити *Telegram Зірки* ⭐\n\nОберіть дію нижче:`,
    { parse_mode: "Markdown", reply_markup: mainKeyboard() }
  );
}

async function sendBuyMenu(chatId: number) {
  if (!bot) return;
  const buttons: TelegramBot.InlineKeyboardButton[][] = STAR_PACKAGES.map((pkg) => [
    { text: `⭐ ${pkg.stars} зірок — ${pkg.price} грн`, callback_data: `buy_${pkg.stars}_${pkg.price}` },
  ]);
  buttons.push([{ text: "✏️ Ввести свою кількість", callback_data: "buy_custom" }]);
  await bot.sendMessage(chatId, `⭐ *Купити Telegram Зірки*\n\nОберіть пакет або введіть власну кількість зірок:`, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: buttons },
  });
}

async function sendOrderDetails(
  chatId: number,
  stars: number,
  price: number,
  userId: string,
  username: string | null,
  firstName: string | null
) {
  if (!bot) return;
  const cardNumber = await getSetting("card_number");
  const orderNumber = await generateOrderNumber();

  await db.insert(ordersTable).values({
    orderNumber,
    telegramUserId: userId,
    telegramUsername: username ?? null,
    telegramFirstName: firstName ?? null,
    starsAmount: stars,
    priceUah: price,
    status: "pending",
  });

  const cardText = cardNumber
    ? `💳 *Номер картки для оплати:*\n\`${cardNumber}\``
    : `💳 *Реквізити для оплати будуть додані незабаром.*`;

  await bot.sendMessage(
    chatId,
    `✅ *Замовлення створено!*\n\n📋 *Номер замовлення:* \`${orderNumber}\`\n⭐ *Кількість зірок:* ${stars}\n💰 *Сума до оплати:* ${price} грн\n\n${cardText}\n\n📸 *Після оплати надішліть скріншот або фото підтвердження платежу у цей чат.*\n\n_Ваше замовлення буде опрацьовано протягом 10-30 хвилин після підтвердження оплати._`,
    { parse_mode: "Markdown" }
  );
}

async function handleProofMedia(
  chatId: number,
  userId: string,
  fileId: string | null,
  caption: string | null,
  firstName: string | null,
  username: string | null
) {
  if (!bot) return;
  const pendingOrders = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.telegramUserId, userId))
    .orderBy(ordersTable.createdAt);

  const pending = pendingOrders.filter((o) => o.status === "pending");

  if (pending.length > 0) {
    const order = pending[pending.length - 1];
    await db.update(ordersTable).set({
      proofFileId: fileId,
      proofCaption: caption ?? null,
      status: "proof_submitted",
      updatedAt: new Date(),
    }).where(eq(ordersTable.id, order.id));

    await bot.sendMessage(
      chatId,
      `✅ *Дякуємо!* Ваше підтвердження оплати отримано.\n\n📋 Замовлення: \`${order.orderNumber}\`\n\n_Ми перевіримо оплату та надішлемо зірки найближчим часом._`,
      { parse_mode: "Markdown" }
    );

    await notifyAdmins(order.orderNumber, fileId, caption, userId, firstName, username);
  } else {
    await bot.sendMessage(
      chatId,
      `ℹ️ У вас немає активних замовлень. Спочатку оформіть замовлення через меню *⭐ Купити Зірки*.`,
      { parse_mode: "Markdown" }
    );
  }
}

async function notifyAdmins(
  orderNumber: string,
  fileId: string | null,
  caption: string | null,
  userId: string,
  firstName: string | null,
  username: string | null
) {
  if (!bot) return;

  // Collect all unique admin chat IDs from both admin_chat_id and admin_whitelist
  const targets = new Set<number>();
  const adminChatId = await getSetting("admin_chat_id");
  if (adminChatId) targets.add(Number(adminChatId));
  const whitelist = await getSetting("admin_whitelist");
  if (whitelist) {
    for (const id of whitelist.split(",").map((s) => s.trim()).filter(Boolean)) {
      const n = Number(id);
      if (!isNaN(n)) targets.add(n);
    }
  }

  if (targets.size === 0) return;

  try {
    const order = await db.select().from(ordersTable).where(eq(ordersTable.orderNumber, orderNumber)).limit(1);
    if (!order[0]) return;
    const o = order[0];

    const text = `🔔 *Нова оплата!*\n\n📋 Замовлення: \`${orderNumber}\`\n👤 Користувач: ${firstName ?? ""} ${username ? "@" + username : ""} (ID: ${userId})\n⭐ Зірок: ${o.starsAmount}\n💰 Сума: ${o.priceUah} грн${caption ? `\n\n💬 Коментар: ${caption}` : ""}`;

    const keyboard = {
      inline_keyboard: [
        [
          { text: "✅ Виконано", callback_data: `complete_${orderNumber}` },
          { text: "❌ Скасувати", callback_data: `cancel_${orderNumber}` },
        ],
        [
          { text: "💬 Написати клієнту", callback_data: `adm_msg_${o.id}` },
        ],
      ],
    };

    for (const target of targets) {
      try {
        if (fileId) {
          await bot.sendPhoto(target, fileId, { caption: text, parse_mode: "Markdown", reply_markup: keyboard });
        } else {
          await bot.sendMessage(target, text, { parse_mode: "Markdown", reply_markup: keyboard });
        }
      } catch (err) {
        logger.warn({ err, target }, "Failed to notify admin");
      }
    }
  } catch (err) {
    logger.error({ err }, "Error notifying admins");
  }
}

const userAwaitingCustomStars: Map<string, boolean> = new Map();

if (bot) {
  bot.onText(/\/start/, async (msg) => {
    try {
      const chatId = msg.chat.id;
      const userId = msg.from!.id;
      const firstName = msg.from?.first_name ?? "Користувач";

      const subscribed = await isUserSubscribed(userId);
      if (!subscribed) { await sendSubscriptionRequired(chatId); return; }

      await getOrCreateUser(msg);
      await sendMainMenu(chatId, firstName);
    } catch (err) {
      logger.error({ err }, "Error handling /start");
    }
  });

  bot.on("message", async (msg) => {
    try {
      const chatId = msg.chat.id;
      const userId = String(msg.from!.id);

      if (await handleAdminMessage(bot, msg)) return;

      // Relay customer reply back to the admin who messaged them
      const adminChatId = customerToAdmin.get(userId);
      if (adminChatId && msg.text && !msg.text.startsWith("/")) {
        const userDisplay = [
          msg.from?.first_name,
          msg.from?.username ? `@${msg.from.username}` : null,
          `(ID: ${userId})`,
        ].filter(Boolean).join(" ");
        await bot!.sendMessage(
          adminChatId,
          `📨 *Відповідь клієнта*\n👤 ${userDisplay}\n\n${msg.text}`,
          { parse_mode: "Markdown" }
        );
        await bot!.sendMessage(chatId, "✅ Ваше повідомлення передано в підтримку.");
        return;
      }

      const subscribed = await isUserSubscribed(msg.from!.id);
      if (!subscribed) { await sendSubscriptionRequired(chatId); return; }

      if (msg.photo || msg.document) {
        const fileId = msg.photo
          ? msg.photo[msg.photo.length - 1].file_id
          : msg.document?.file_id ?? null;
        await handleProofMedia(chatId, userId, fileId, msg.caption ?? null, msg.from?.first_name ?? null, msg.from?.username ?? null);
        return;
      }

      if (!msg.text || msg.text.startsWith("/")) return;

      const text = msg.text;

      if (userAwaitingCustomStars.get(userId)) {
        const stars = parseInt(text.trim());
        if (isNaN(stars) || stars < 10) {
          await bot!.sendMessage(chatId, "❌ Введіть коректну кількість зірок (мінімум 10).");
          return;
        }
        userAwaitingCustomStars.delete(userId);
        const price = Math.ceil(stars * 0.78);
        await sendOrderDetails(chatId, stars, price, userId, msg.from?.username ?? null, msg.from?.first_name ?? null);
        return;
      }

      if (text === "⭐ Купити Зірки") {
        await sendBuyMenu(chatId);
      } else if (text === "💬 Відгуки") {
        const channelUsername = await getSetting("verification_channel");
        if (channelUsername) {
          const channelLink = `https://t.me/${channelUsername.replace("@", "")}`;
          await bot!.sendMessage(chatId, `💬 *Відгуки наших клієнтів*\n\nОзнайомтесь із відгуками покупців: ${channelLink}`, { parse_mode: "Markdown" });
        } else {
          await bot!.sendMessage(chatId, `💬 *Відгуки*\n\nПосилання на канал з відгуками буде додане незабаром.`, { parse_mode: "Markdown" });
        }
      } else if (text === "🛟 Служба Підтримки") {
        await bot!.sendMessage(
          chatId,
          `🛟 *Служба Підтримки*\n\nЗверніться до наших адмінів:\n\n👤 @obnali4it\n👤 @donnyadm\n\nМи відповімо як найшвидше!`,
          { parse_mode: "Markdown" }
        );
      }
    } catch (err) {
      logger.error({ err }, "Error handling message");
    }
  });

  bot.on("callback_query", async (query) => {
    try {
      if (await handleAdminCallback(bot, query)) return;

      const data = query.data ?? "";
      const chatId = query.message?.chat.id;

      if (data === "check_sub") {
        const subscribed = await isUserSubscribed(query.from.id);
        if (subscribed) {
          await bot!.answerCallbackQuery(query.id, { text: "✅ Підписку підтверджено!" });
          const telegramUserId = String(query.from.id);
          const existing = await db.select().from(usersTable).where(eq(usersTable.telegramUserId, telegramUserId)).limit(1);
          if (existing.length === 0) {
            await db.insert(usersTable).values({
              telegramUserId,
              telegramUsername: query.from.username ?? null,
              telegramFirstName: query.from.first_name ?? null,
              telegramLastName: query.from.last_name ?? null,
              isVerified: false,
            });
          }
          await sendMainMenu(chatId!, query.from.first_name ?? "Користувач");
        } else {
          await bot!.answerCallbackQuery(query.id, {
            text: "❌ Ви ще не підписані на канал",
            show_alert: true,
          });
        }
        return;
      }

      if (data === "buy_custom") {
        const userId = String(query.from.id);
        userAwaitingCustomStars.set(userId, true);
        await bot!.answerCallbackQuery(query.id);
        await bot!.sendMessage(chatId!, `✏️ Введіть кількість зірок, яку хочете купити (мінімум 10):\n\n_Ціна розраховується: кількість × 0.78 грн_`, { parse_mode: "Markdown" });
        return;
      }

      if (data.startsWith("buy_")) {
        const parts = data.split("_");
        const stars = parseInt(parts[1]);
        const price = parseInt(parts[2]);
        const userId = String(query.from.id);
        await bot!.answerCallbackQuery(query.id);
        await sendOrderDetails(chatId!, stars, price, userId, query.from.username ?? null, query.from.first_name ?? null);
        return;
      }

      if (data.startsWith("complete_")) {
        const orderNumber = data.replace("complete_", "");
        await db.update(ordersTable).set({ status: "completed", updatedAt: new Date() }).where(eq(ordersTable.orderNumber, orderNumber));
        const orders = await db.select().from(ordersTable).where(eq(ordersTable.orderNumber, orderNumber)).limit(1);
        if (orders[0]) {
          try {
            await bot!.sendMessage(
              Number(orders[0].telegramUserId),
              `🎉 *Замовлення виконано!*\n\n📋 Замовлення: \`${orderNumber}\`\n⭐ Зірки (${orders[0].starsAmount}) надіслані на ваш акаунт!\n\nДякуємо за покупку! 🙏`,
              { parse_mode: "Markdown" }
            );
          } catch {}
        }
        await bot!.answerCallbackQuery(query.id, { text: "✅ Замовлення виконано!" });
        return;
      }

      if (data.startsWith("cancel_")) {
        const orderNumber = data.replace("cancel_", "");
        await db.update(ordersTable).set({ status: "cancelled", updatedAt: new Date() }).where(eq(ordersTable.orderNumber, orderNumber));
        const orders = await db.select().from(ordersTable).where(eq(ordersTable.orderNumber, orderNumber)).limit(1);
        if (orders[0]) {
          try {
            await bot!.sendMessage(
              Number(orders[0].telegramUserId),
              `❌ *Замовлення скасовано*\n\n📋 Замовлення: \`${orderNumber}\`\n\nЯкщо є питання — зверніться до підтримки:\n👤 @obnali4it\n👤 @donnyadm`,
              { parse_mode: "Markdown" }
            );
          } catch {}
        }
        await bot!.answerCallbackQuery(query.id, { text: "❌ Замовлення скасовано" });
        return;
      }

      await bot!.answerCallbackQuery(query.id);
    } catch (err) {
      logger.error({ err }, "Error handling callback query");
    }
  });

  setupAdminHandlers(bot);
  logger.info("Telegram bot started");
}
