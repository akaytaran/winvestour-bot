export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem 1.5rem" }}>
      <h1>Winvestour</h1>
      <p>Motorun durumu, açık ve kapanmış pozisyonlar, sağlık göstergesi ve karar motorunun maliyeti <a href="/panel">panelde</a>. Panel oturum ister.</p>
      <p>Motoru durdurmak için <a href="/durdur">durdurma ekranı</a>: oturum istemez, durdurma anahtarını ister.</p>
    </main>
  );
}
