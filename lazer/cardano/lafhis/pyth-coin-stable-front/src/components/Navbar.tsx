import { useWalletContext } from "@/context/WalletContext";

export default function Navbar() {
  const { connected, walletName, connect, disconnect } = useWalletContext();

  return (
    <nav className="top-nav mx-auto mt-6 flex w-[92%] max-w-6xl items-center justify-between gap-4 rounded-2xl border border-amber-300/35 bg-stone-950/80 px-4 py-3 md:px-6">
      <div className="flex items-center gap-2 md:gap-3">
        <a className="nav-chip" href="#">
          Create Game
        </a>
        <a className="nav-chip" href="#">
          Join Game
        </a>
      </div>

      <button
        className="wallet-cta"
        type="button"
        onClick={connected ? disconnect : () => void connect()}
      >
        {connected ? `Connected: ${walletName}` : "Connect Wallet"}
      </button>
    </nav>
  );
}
