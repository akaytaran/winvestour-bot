import type { Metadata } from "next";
import { SwRegister } from "./sw-register";
import { EN } from "@/lib/i18n/en";

export const metadata: Metadata = {
  title: "Winvestour",
  description: EN.meta.description,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang={EN.lang}>
      <body style={{ margin: 0 }}>
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
