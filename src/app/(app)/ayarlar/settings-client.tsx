"use client";

import { Bell, KeyRound, Loader2, RefreshCw, Send } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import type { ActionState } from "@/app/actions/_helpers";
import { changePasswordAction, type AuthState } from "@/app/actions/auth";
import {
  runNotificationsAction,
  saveRateAction,
  saveSettingsAction,
  syncRatesAction,
  testNotificationAction,
} from "@/app/actions/settings";
import { CheckboxField, FieldRow, NumberField, TextField } from "@/components/fields";
import { Button, Field, Input, Panel, PanelHeader, Select } from "@/components/ui";
import { formatDateTR } from "@/lib/dates";
import { CURRENCIES, minorToInputString } from "@/lib/money";
import type { AppSettings } from "@/lib/settings";

/**
 * Ayarlar. Gizli alanlar (token/şifre) sunucudan maskeli gelir; maskeli
 * değer geri gönderilirse mevcut sır korunur.
 */

function SaveBar({ label = "Kaydet" }: { label?: string }) {
  const { pending } = useFormStatus();
  return (
    <div className="flex justify-end border-t px-4 py-3 sm:px-5">
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? <Loader2 size={15} className="animate-spin" /> : null}
        {label}
      </Button>
    </div>
  );
}

function Feedback({ state }: { state: ActionState | AuthState }) {
  if (!state.error && !state.success) return null;
  return (
    <div className="px-4 pt-3 sm:px-5">
      {state.error ? (
        <p className="bg-gider/10 text-gider rounded-lg px-3 py-2 text-xs" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="bg-gelir/10 text-gelir mt-1.5 rounded-lg px-3 py-2 text-xs">
          {state.success}
        </p>
      ) : null}
    </div>
  );
}

export function SettingsClient({
  settings,
  rates,
  notificationCount,
}: {
  settings: AppSettings;
  rates: Array<{ code: string; rateMicro: number; date: string; source: string }>;
  notificationCount: number;
}) {
  const [saveState, saveAction] = useActionState<ActionState, FormData>(
    saveSettingsAction,
    {},
  );
  const [testState, testAction] = useActionState<ActionState, FormData>(
    testNotificationAction,
    {},
  );
  const [runState, runAction] = useActionState<ActionState, FormData>(
    runNotificationsAction,
    {},
  );
  const [rateState, rateAction] = useActionState<ActionState, FormData>(
    saveRateAction,
    {},
  );
  const [syncState, syncAction] = useActionState<ActionState, FormData>(
    syncRatesAction,
    {},
  );
  const [pwState, pwAction] = useActionState<AuthState, FormData>(
    changePasswordAction,
    {},
  );

  return (
    <div className="space-y-4">
      {/* Bildirim ayarları */}
      <form action={saveAction}>
        <Panel>
          <PanelHeader
            title="Bildirimler"
            subtitle="Yaklaşan ödemeler, abonelik yenilemeleri ve limit uyarıları"
          />

          <div className="space-y-4 px-4 py-4 sm:px-5">
            <FieldRow>
              <TextField
                name="dueReminderDays"
                label="Kaç gün önce uyar"
                defaultValue={settings.dueReminderDays.join(", ")}
                hint="Virgülle ayırın: 7, 3, 1, 0"
              />
              <NumberField
                name="cardUtilizationWarnPercent"
                label="Limit doluluk uyarısı"
                suffix="%"
                min={10}
                max={100}
                defaultValue={settings.cardUtilizationWarnPercent}
              />
            </FieldRow>

            <div className="space-y-1">
              <CheckboxField
                name="dailyDigestEnabled"
                label="Günlük özet gönder"
                hint="Önümüzdeki 7 günün ödemelerini tek mesajda özetler."
                defaultChecked={settings.dailyDigestEnabled}
              />
              <NumberField
                name="dailyDigestHour"
                label="Özet saati"
                min={0}
                max={23}
                suffix=":00"
                defaultValue={settings.dailyDigestHour}
              />
            </div>

            {/* ntfy */}
            <div className="border-t pt-4">
              <CheckboxField
                name="ntfyEnabled"
                label="ntfy ile bildirim gönder"
                hint="Telefonunuza anlık push bildirimi. En basit kurulum."
                defaultChecked={settings.ntfyEnabled}
              />
              <div className="mt-3 space-y-3">
                <FieldRow>
                  <TextField
                    name="ntfyServer"
                    label="Sunucu"
                    defaultValue={settings.ntfyServer}
                    placeholder="https://ntfy.sh"
                  />
                  <TextField
                    name="ntfyTopic"
                    label="Konu (topic)"
                    defaultValue={settings.ntfyTopic}
                    placeholder="myfinance-a7x3k9"
                    hint="Tahmin edilemeyecek bir ad seçin"
                  />
                </FieldRow>
                <TextField
                  name="ntfyToken"
                  label="Erişim jetonu"
                  type="password"
                  defaultValue={settings.ntfyToken}
                  hint="Kendi ntfy sunucunuz korumalıysa"
                />
              </div>
              <p className="faint mt-2 text-[11px] leading-relaxed">
                Herkese açık ntfy.sh kullanıyorsanız konu adını bilen herkes
                bildirimlerinizi okuyabilir. Tahmin edilmesi zor bir ad seçin ya da
                kendi sunucunuzu çalıştırın.
              </p>
            </div>

            {/* Telegram */}
            <div className="border-t pt-4">
              <CheckboxField
                name="telegramEnabled"
                label="Telegram ile bildirim gönder"
                hint="@BotFather'dan bot oluşturup jetonu buraya girin."
                defaultChecked={settings.telegramEnabled}
              />
              <div className="mt-3">
                <FieldRow>
                  <TextField
                    name="telegramBotToken"
                    label="Bot jetonu"
                    type="password"
                    defaultValue={settings.telegramBotToken}
                  />
                  <TextField
                    name="telegramChatId"
                    label="Sohbet kimliği"
                    defaultValue={settings.telegramChatId}
                    hint="@userinfobot ile öğrenebilirsiniz"
                  />
                </FieldRow>
              </div>
            </div>

            {/* E-posta */}
            <div className="border-t pt-4">
              <CheckboxField
                name="emailEnabled"
                label="E-posta ile bildirim gönder"
                defaultChecked={settings.emailEnabled}
              />
              <div className="mt-3 space-y-3">
                <FieldRow>
                  <TextField
                    name="smtpHost"
                    label="SMTP sunucu"
                    defaultValue={settings.smtpHost}
                    placeholder="smtp.gmail.com"
                  />
                  <NumberField
                    name="smtpPort"
                    label="Port"
                    defaultValue={settings.smtpPort}
                  />
                </FieldRow>
                <FieldRow>
                  <TextField
                    name="smtpUser"
                    label="Kullanıcı"
                    defaultValue={settings.smtpUser}
                  />
                  <TextField
                    name="smtpPassword"
                    label="Şifre"
                    type="password"
                    defaultValue={settings.smtpPassword}
                  />
                </FieldRow>
                <FieldRow>
                  <TextField
                    name="emailFrom"
                    label="Gönderen"
                    defaultValue={settings.emailFrom}
                  />
                  <TextField
                    name="emailTo"
                    label="Alıcı"
                    defaultValue={settings.emailTo}
                  />
                </FieldRow>
                <CheckboxField
                  name="smtpSecure"
                  label="SSL/TLS kullan (port 465)"
                  defaultChecked={settings.smtpSecure}
                />
              </div>
            </div>

            {/* Hesaplama parametreleri */}
            <div className="border-t pt-4">
              <p className="mb-3 text-xs font-semibold">Hesaplama oranları</p>
              <p className="faint mb-3 text-[11px] leading-relaxed">
                Mevzuat ve banka oranları değiştiğinde buradan güncelleyin. Asgari ödeme
                oranı ve kart faizi borç projeksiyonunda kullanılır.
              </p>
              <FieldRow>
                <NumberField
                  name="cardMonthlyRate"
                  label="Kart aylık faizi"
                  suffix="%"
                  step="0.01"
                  defaultValue={settings.cardMonthlyRateBps / 100}
                />
                <NumberField
                  name="overdraftDefaultAnnualRate"
                  label="Ek hesap yıllık faizi"
                  suffix="%"
                  step="0.01"
                  defaultValue={settings.overdraftDefaultAnnualRateBps / 100}
                />
              </FieldRow>
              <div className="mt-3">
                <FieldRow>
                  <Field label="Asgari ödeme eşiği">
                    <Input
                      name="minimumLimitThreshold"
                      inputMode="decimal"
                      className="tabular"
                      defaultValue={minorToInputString(
                        settings.minimumPolicy.limitThresholdMinor,
                      )}
                    />
                  </Field>
                  <NumberField
                    name="minimumLowRate"
                    label="Eşik altı oran"
                    suffix="%"
                    step="0.01"
                    defaultValue={settings.minimumPolicy.lowRateBps / 100}
                  />
                </FieldRow>
              </div>
              <div className="mt-3">
                <FieldRow>
                  <NumberField
                    name="minimumHighRate"
                    label="Eşik üstü oran"
                    suffix="%"
                    step="0.01"
                    defaultValue={settings.minimumPolicy.highRateBps / 100}
                  />
                  <NumberField
                    name="minimumFirstYearRate"
                    label="İlk yıl oranı"
                    suffix="%"
                    step="0.01"
                    defaultValue={settings.minimumPolicy.firstYearRateBps / 100}
                  />
                </FieldRow>
              </div>
            </div>

            <div className="border-t pt-4">
              <CheckboxField
                name="autoFetchRates"
                label="TCMB kurlarını otomatik çek"
                hint="Dövizli hesapların TL karşılığı güncel kurdan hesaplanır."
                defaultChecked={settings.autoFetchRates}
              />
            </div>
          </div>

          <Feedback state={saveState} />
          <SaveBar label="Ayarları kaydet" />
        </Panel>
      </form>

      {/* Bildirim testi */}
      <Panel>
        <PanelHeader
          title="Bildirim testi"
          subtitle={`${notificationCount} uyarı kaydı var`}
        />
        <div className="flex flex-wrap gap-2 px-4 py-4 sm:px-5">
          <form action={testAction}>
            <Button type="submit" variant="secondary">
              <Send size={14} />
              Test bildirimi gönder
            </Button>
          </form>
          <form action={runAction}>
            <Button type="submit" variant="secondary">
              <Bell size={14} />
              Uyarıları şimdi çalıştır
            </Button>
          </form>
        </div>
        <Feedback state={testState} />
        <Feedback state={runState} />
        <p className="faint px-4 pt-1 pb-4 text-[11px] leading-relaxed sm:px-5">
          Uyarılar arka plan servisiyle 15 dakikada bir çalışır. Aynı uyarı aynı gün
          iki kez gönderilmez.
        </p>
      </Panel>

      {/* Döviz kurları */}
      <Panel>
        <PanelHeader
          title="Döviz ve altın kurları"
          subtitle="TCMB döviz satış kuru · altın ve gümüş elle girilir"
          action={
            <form action={syncAction}>
              <Button type="submit" size="sm" variant="secondary">
                <RefreshCw size={13} />
                TCMB'den çek
              </Button>
            </form>
          }
        />
        <Feedback state={syncState} />

        {rates.length > 0 ? (
          <div className="table-scroll">
            <table className="w-full text-xs">
              <thead>
                <tr className="faint border-b text-left">
                  <th className="px-4 py-2 font-medium sm:px-5">Birim</th>
                  <th className="px-2 py-2 text-right font-medium">Kur (TL)</th>
                  <th className="px-2 py-2 font-medium">Tarih</th>
                  <th className="px-4 py-2 font-medium sm:px-5">Kaynak</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {rates.map((rate) => (
                  <tr key={rate.code} className="border-b last:border-b-0">
                    <td className="px-4 py-2 font-medium sm:px-5">
                      {CURRENCIES[rate.code as keyof typeof CURRENCIES]?.label ?? rate.code}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {(rate.rateMicro / 1_000_000).toLocaleString("tr-TR", {
                        minimumFractionDigits: 4,
                        maximumFractionDigits: 4,
                      })}
                    </td>
                    <td className="muted px-2 py-2">{formatDateTR(rate.date)}</td>
                    <td className="muted px-4 py-2 sm:px-5">{rate.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted px-4 py-6 text-center text-xs sm:px-5">
            Henüz kur kaydı yok. Dövizli hesabınız varsa kur girin.
          </p>
        )}

        <form action={rateAction} className="border-t px-4 py-4 sm:px-5">
          <p className="mb-3 text-xs font-semibold">Elle kur girişi</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Birim">
              <Select name="code" defaultValue="XAU">
                <option value="USD">ABD Doları</option>
                <option value="EUR">Euro</option>
                <option value="GBP">İngiliz Sterlini</option>
                <option value="XAU">Gram Altın</option>
                <option value="XAG">Gram Gümüş</option>
              </Select>
            </Field>
            <Field label="1 birim = ? TL">
              <Input name="rate" inputMode="decimal" className="tabular" placeholder="4250,00" />
            </Field>
            <Field label="Tarih">
              <Input type="date" name="date" defaultValue={todayISO()} />
            </Field>
          </div>
          <Feedback state={rateState} />
          <div className="mt-3 flex justify-end">
            <Button type="submit" variant="secondary">
              Kuru kaydet
            </Button>
          </div>
        </form>
      </Panel>

      {/* Şifre değiştirme */}
      <form action={pwAction}>
        <Panel>
          <PanelHeader
            title="Şifre"
            subtitle="Değiştirdiğinizde diğer cihazlardaki oturumlar kapanır"
          />
          <div className="space-y-3 px-4 py-4 sm:px-5">
            <Field label="Mevcut şifre">
              <Input
                type="password"
                name="currentPassword"
                autoComplete="current-password"
                required
              />
            </Field>
            <FieldRow>
              <Field label="Yeni şifre">
                <Input
                  type="password"
                  name="newPassword"
                  autoComplete="new-password"
                  required
                  minLength={8}
                />
              </Field>
              <Field label="Yeni şifre (tekrar)">
                <Input
                  type="password"
                  name="confirmPassword"
                  autoComplete="new-password"
                  required
                  minLength={8}
                />
              </Field>
            </FieldRow>
          </div>
          <Feedback state={pwState} />
          <div className="flex justify-end border-t px-4 py-3 sm:px-5">
            <Button type="submit" variant="primary">
              <KeyRound size={14} />
              Şifreyi değiştir
            </Button>
          </div>
        </Panel>
      </form>
    </div>
  );
}

function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
