// Next.js sunucu açılışında bir kez çalışır. Ortam sözleşmesi burada doğrulanır:
// eksik değişken -> süreç açılışta ve gürültülü biçimde düşer (TUR-1-EK madde 3).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getEnv } = await import("./lib/env");
    getEnv();
  }
}
