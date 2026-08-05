import type { Metadata } from "next";
import "@fontsource/montserrat/400.css";
import "@fontsource/montserrat/500.css";
import "@fontsource/montserrat/600.css";
import "@fontsource/montserrat/700.css";
import "@fontsource/montserrat/800.css";
import "@fontsource/montserrat/900.css";
import "./globals.css";
import { AuthProvider } from "./_components/auth-context";
import { BrandProvider } from "./_components/brand-provider";
import { getBrandConfig, getBrandCssVariables } from "@/lib/branding";

const brand = getBrandConfig();

export const metadata: Metadata = {
  title: `${brand.name} | Mock tests`,
  description: brand.description,
  applicationName: brand.name,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
      style={getBrandCssVariables(brand)}
    >
      <body className="min-h-full flex flex-col">
        <BrandProvider brand={brand}>
          <AuthProvider>{children}</AuthProvider>
        </BrandProvider>
      </body>
    </html>
  );
}
