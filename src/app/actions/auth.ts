"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { users } from "@/db/schema";
import {
  createSession,
  destroySession,
  hashPassword,
  requireUser,
  verifyPassword,
} from "@/lib/auth";

export interface AuthState {
  error?: string;
  success?: string;
}

export async function loginAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!username || !password) {
    return { error: "Kullanıcı adı ve şifre gerekli." };
  }

  const user = await db.query.users.findFirst({
    where: eq(users.username, username),
  });

  // Kullanıcı yoksa da aynı süreyi harcamak için doğrulama yine çalıştırılır.
  const ok = user
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPassword(password, "scrypt$00$00");

  if (!user || !ok) {
    return { error: "Kullanıcı adı veya şifre hatalı." };
  }

  await createSession(user);
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}

export async function changePasswordAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const user = await requireUser();
  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  if (!(await verifyPassword(current, user.passwordHash))) {
    return { error: "Mevcut şifre hatalı." };
  }
  if (next.length < 8) {
    return { error: "Yeni şifre en az 8 karakter olmalı." };
  }
  if (next !== confirm) {
    return { error: "Yeni şifreler eşleşmiyor." };
  }

  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(next),
      // Epoch artınca diğer cihazlardaki oturumlar geçersizleşir.
      sessionEpoch: user.sessionEpoch + 1,
    })
    .where(eq(users.id, user.id));

  await createSession({
    id: user.id,
    username: user.username,
    sessionEpoch: user.sessionEpoch + 1,
  });

  return { success: "Şifre değiştirildi. Diğer cihazlardaki oturumlar kapatıldı." };
}
