import "server-only";

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";

import { db } from "@/db";
import { users } from "@/db/schema";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const COOKIE_NAME = "myfinance_session";
const SESSION_DAYS = 30;

function secret(): Uint8Array {
  const raw = process.env.AUTH_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error(
      "AUTH_SECRET tanımlı değil veya 32 karakterden kısa. .env dosyasına güçlü bir değer koyun.",
    );
  }
  return new TextEncoder().encode(raw);
}

/* ───────────────────────────── Şifre saklama ──────────────────────────── */

/** scrypt ile hash — harici bağımlılık gerektirmez, bcrypt'ten güçlüdür. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;

  const derived = await scryptAsync(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  if (derived.length !== expected.length) return false;
  // Sabit süreli karşılaştırma — zamanlama saldırısına kapalı.
  return timingSafeEqual(derived, expected);
}

/* ──────────────────────────────── Oturum ──────────────────────────────── */

export interface SessionPayload {
  userId: number;
  username: string;
  epoch: number;
}

export async function createSession(user: {
  id: number;
  username: string;
  sessionEpoch: number;
}): Promise<void> {
  const token = await new SignJWT({
    userId: user.id,
    username: user.username,
    epoch: user.sessionEpoch,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    // Tünel arkasında HTTPS ile sunulacağı için üretimde secure zorunlu.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function readSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secret());
    return {
      userId: Number(payload.userId),
      username: String(payload.username),
      epoch: Number(payload.epoch),
    };
  } catch {
    return null;
  }
}

/**
 * Oturumu doğrular ve kullanıcıyı döner.
 * Şifre değiştiğinde sessionEpoch artar ve eski tokenlar geçersizleşir.
 */
export async function getCurrentUser() {
  const session = await readSession();
  if (!session) return null;

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  });
  if (!user || user.sessionEpoch !== session.epoch) return null;
  return user;
}

/** Sayfa/aksiyon başında çağrılır; oturum yoksa hata fırlatır. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("YETKISIZ");
  return user;
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof Error && error.message === "YETKISIZ";
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
