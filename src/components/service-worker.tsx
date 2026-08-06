"use client";

import { useEffect } from "react";

/**
 * Hizmet çalışanını kaydeder. Yalnızca üretimde ve güvenli bağlamda (HTTPS ya da
 * localhost) çalışır — tünel arkasında HTTPS zaten zorunlu.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        // Kayıt başarısız olursa uygulama normal çalışmaya devam eder.
        console.warn("Hizmet çalışanı kaydedilemedi:", error);
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
