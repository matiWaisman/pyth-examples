import "@/styles/globals.css";
import type { AppProps } from "next/app";
import Navbar from "@/components/Navbar";
import { WalletProvider } from "@/context/WalletContext";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <WalletProvider>
      <Navbar />
      <Component {...pageProps} />
    </WalletProvider>
  );
}
