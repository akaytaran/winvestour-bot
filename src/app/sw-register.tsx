"use client";
// Service worker kaydı (G20 parça 1, Tur 30). Kayıt düşerse çevrimdışı ekran kurulmaz — sessiz geçilmez, tarayıcı kütüğüne yazılır. Başka hiçbir şey yapmaz.
import { useEffect } from "react";

export function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((e: Error) => console.warn(`çevrimdışı ekran kurulamadı: ${e.message}`));
  }, []);
  return null;
}
