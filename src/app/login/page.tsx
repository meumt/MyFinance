import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Giriş" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="bg-brand-600 mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl text-2xl font-bold text-white shadow-lg">
            ₺
          </div>
          <h1 className="text-xl font-semibold">MyFinance</h1>
          <p className="muted mt-1 text-sm">Kişisel finans yönetimi</p>
        </div>

        <LoginForm />

        <p className="faint mt-6 text-center text-xs leading-relaxed">
          Bu sistem kişisel finansal verilerinizi barındırır.
          <br />
          Yalnızca güvendiğiniz ağdan erişin.
        </p>
      </div>
    </main>
  );
}
