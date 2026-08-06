import "server-only";

import nodemailer from "nodemailer";
import type { AppSettings } from "../settings";

/**
 * Bildirim kanalları. Her kanal bağımsız çalışır; biri başarısız olursa
 * diğerleri denenmeye devam eder ve hata sadece günlüğe yazılır.
 */

export type Channel = "ntfy" | "telegram" | "email";

export interface OutgoingNotification {
  title: string;
  body: string;
  severity: "bilgi" | "uyari" | "kritik";
  /** Bildirime tıklandığında açılacak adres. */
  url?: string;
  tags?: string[];
}

export interface DeliveryResult {
  channel: Channel;
  ok: boolean;
  error?: string;
}

/* ────────────────────────────────── ntfy ─────────────────────────────────── */

const NTFY_PRIORITY: Record<OutgoingNotification["severity"], string> = {
  bilgi: "default",
  uyari: "high",
  kritik: "urgent",
};

const NTFY_TAGS: Record<OutgoingNotification["severity"], string> = {
  bilgi: "information_source",
  uyari: "warning",
  kritik: "rotating_light",
};

async function sendNtfy(
  settings: AppSettings,
  notification: OutgoingNotification,
): Promise<DeliveryResult> {
  try {
    const server = settings.ntfyServer.replace(/\/+$/, "");
    const headers: Record<string, string> = {
      "Content-Type": "text/plain; charset=utf-8",
      // Başlık ASCII olmayan karakter içerebildiği için RFC 2047 ile kodlanır.
      Title: encodeHeader(notification.title),
      Priority: NTFY_PRIORITY[notification.severity],
      Tags: [NTFY_TAGS[notification.severity], ...(notification.tags ?? [])].join(","),
    };
    if (settings.ntfyToken) {
      headers.Authorization = `Bearer ${settings.ntfyToken}`;
    }
    if (notification.url) {
      headers.Click = notification.url;
    }

    const res = await fetch(`${server}/${settings.ntfyTopic}`, {
      method: "POST",
      headers,
      body: notification.body,
      signal: AbortSignal.timeout(15_000),
    });

    return res.ok
      ? { channel: "ntfy", ok: true }
      : { channel: "ntfy", ok: false, error: `HTTP ${res.status}` };
  } catch (error) {
    return { channel: "ntfy", ok: false, error: errorText(error) };
  }
}

/** ntfy başlıkları HTTP header olduğu için Türkçe karakterler kodlanmalı. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/* ───────────────────────────────── Telegram ──────────────────────────────── */

async function sendTelegram(
  settings: AppSettings,
  notification: OutgoingNotification,
): Promise<DeliveryResult> {
  try {
    const text = `*${escapeMarkdown(notification.title)}*\n${escapeMarkdown(notification.body)}`;

    const res = await fetch(
      `https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: settings.telegramChatId,
          text,
          parse_mode: "MarkdownV2",
          disable_notification: notification.severity === "bilgi",
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (res.ok) return { channel: "telegram", ok: true };
    const detail = await res.text().catch(() => "");
    return { channel: "telegram", ok: false, error: `HTTP ${res.status} ${detail.slice(0, 120)}` };
  } catch (error) {
    return { channel: "telegram", ok: false, error: errorText(error) };
  }
}

/** Telegram MarkdownV2 kaçış kuralları katıdır; tüm özel karakterler kaçırılır. */
function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (m) => `\\${m}`);
}

/* ─────────────────────────────────── E-posta ─────────────────────────────── */

async function sendEmail(
  settings: AppSettings,
  notification: OutgoingNotification,
): Promise<DeliveryResult> {
  try {
    const transport = nodemailer.createTransport({
      host: settings.smtpHost,
      port: settings.smtpPort,
      secure: settings.smtpSecure,
      auth: settings.smtpUser
        ? { user: settings.smtpUser, pass: settings.smtpPassword }
        : undefined,
      connectionTimeout: 20_000,
    });

    await transport.sendMail({
      from: settings.emailFrom || settings.smtpUser,
      to: settings.emailTo,
      subject: notification.title,
      text: notification.body,
      html: renderEmailHtml(notification),
    });

    return { channel: "email", ok: true };
  } catch (error) {
    return { channel: "email", ok: false, error: errorText(error) };
  }
}

function renderEmailHtml(notification: OutgoingNotification): string {
  const accent = {
    bilgi: "#6366f1",
    uyari: "#f59e0b",
    kritik: "#f43f5e",
  }[notification.severity];

  const escapeHtml = (s: string) =>
    s.replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
    );

  return `<!doctype html><html lang="tr"><body style="margin:0;background:#f6f7f9;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
<div style="max-width:520px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
  <div style="height:4px;background:${accent}"></div>
  <div style="padding:20px 24px">
    <h1 style="margin:0 0 12px;font-size:16px;color:#0f172a">${escapeHtml(notification.title)}</h1>
    <pre style="margin:0;font-family:inherit;font-size:14px;line-height:1.6;color:#334155;white-space:pre-wrap">${escapeHtml(notification.body)}</pre>
  </div>
  <div style="padding:12px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8">
    MyFinance — kişisel finans yönetimi
  </div>
</div></body></html>`;
}

/* ────────────────────────────────── Dağıtım ──────────────────────────────── */

/** Etkin tüm kanallara paralel gönderim yapar. */
export async function deliver(
  settings: AppSettings,
  notification: OutgoingNotification,
): Promise<DeliveryResult[]> {
  const jobs: Array<Promise<DeliveryResult>> = [];

  if (settings.ntfyEnabled && settings.ntfyTopic) {
    jobs.push(sendNtfy(settings, notification));
  }
  if (settings.telegramEnabled && settings.telegramBotToken && settings.telegramChatId) {
    jobs.push(sendTelegram(settings, notification));
  }
  if (settings.emailEnabled && settings.smtpHost && settings.emailTo) {
    jobs.push(sendEmail(settings, notification));
  }

  if (jobs.length === 0) return [];
  return Promise.all(jobs);
}

/** Ayarlar ekranındaki "test bildirimi gönder" düğmesi için. */
export async function sendTestNotification(
  settings: AppSettings,
): Promise<DeliveryResult[]> {
  return deliver(settings, {
    title: "MyFinance test bildirimi",
    body: "Bu bir test mesajıdır. Bunu gördüyseniz bildirim kanalı çalışıyor.",
    severity: "bilgi",
    tags: ["white_check_mark"],
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
