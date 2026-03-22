import { CardanoWallet } from "@meshsdk/react";
import Link from "next/link";

export default function Navbar() {
  return (
    <nav className="top-nav mx-auto mt-6 grid w-[92%] max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-4 rounded-2xl border border-violet-500/25 bg-slate-950/80 px-4 py-3 md:px-6">
      <div className="flex items-center gap-2 md:gap-3">
        <Link className="nav-chip" href="/create-game">
          Create Game
        </Link>
        <Link className="nav-chip" href="/join-game">
          Join Game
        </Link>
      </div>

      <Link href="/" className="inline-flex items-center justify-center">
        <span className="nav-logo-mark">
          <span className="nav-logo-top">COIN</span>
          <span className="nav-logo-bottom">STABLE</span>
        </span>
      </Link>

      <div className="wallet-nav-control flex justify-end">
        <CardanoWallet persist />
      </div>
    </nav>
  );
}
