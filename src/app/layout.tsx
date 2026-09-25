import type { Metadata } from "next";
import { SwRegister } from "./sw-register";

export const metadata: Metadata = {
  title: "Winvestour",
  description: "Winvestour otonom kripto işlem yazılımı",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr">
      <body style={{ margin: 0 }}>
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
