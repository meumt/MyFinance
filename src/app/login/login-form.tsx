"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { loginAction, type AuthState } from "@/app/actions/auth";
import { Button, Field, Input, Panel } from "@/components/ui";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
      {pending ? "Kontrol ediliyor…" : "Giriş yap"}
    </Button>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState<AuthState, FormData>(loginAction, {});

  return (
    <Panel className="p-5">
      <form action={formAction} className="space-y-4">
        <Field label="Kullanıcı adı">
          <Input
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            required
            autoFocus
          />
        </Field>

        <Field label="Şifre">
          <Input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>

        {state.error ? (
          <p
            role="alert"
            className="bg-gider/10 text-gider rounded-lg px-3 py-2 text-xs"
          >
            {state.error}
          </p>
        ) : null}

        <SubmitButton />
      </form>
    </Panel>
  );
}
