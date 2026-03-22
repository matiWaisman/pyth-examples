import Head from "next/head";
import Image from "next/image";
import { CardanoWallet, useWallet } from "@meshsdk/react";

const steps = [
  {
    title: "1. CONNECT WALLET",
    text: "Your identity is your Cardano wallet (CIP-30). No username or password needed.",
  },
  {
    title: "2. CHALLENGE LINK",
    text: "Choose an asset and stake amount (10, 25, or 50 ADA). Your rival picks a different asset.",
  },
  {
    title: "3. RACE WINDOW: 60s",
    text: "Both players deposit, the duel starts, and the UI shows live ticks.",
  },
  {
    title: "4. ON-CHAIN RESOLVE",
    text: "Highest percentage change wins. The pot settles automatically and verifiably.",
  },
];

export default function Home() {
  const { connected } = useWallet();

  return (
    <>
      <Head>
        <title>Traders Duel | Web3 Race Arena</title>
        <meta
          name="description"
          content="Web3 landing for Traders Duel: asset racing on Cardano with Pyth signed prices."
        />
      </Head>

      <main className="landing-root text-amber-50">
        <section className="mx-auto max-w-6xl px-6 pb-10 pt-10 md:pt-12">
          <div className="rounded-3xl border border-amber-300/40 bg-stone-950/75 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.45)] md:p-10">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber-300/50 bg-amber-300/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.24em] text-amber-200">
              WEB3 RACE ARENA
            </p>

            <h1 className="max-w-4xl text-3xl leading-tight text-amber-50 md:text-5xl">
              Traders Duel
              <span className="mt-2 block text-amber-300">Powered by Pyth</span>
            </h1>

            <p className="mt-5 max-w-3xl text-sm text-amber-100/90 md:text-base">
              Two players, two assets, one ADA pot, and a time window.
              The winner is determined by percentage change using Pyth signed prices.
            </p>

            <div className="mt-8 grid gap-4 md:grid-cols-[1.25fr_1fr]">
              <div className="race-track rounded-2xl border border-amber-300/30 bg-stone-900/70 p-4 md:p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-200">
                    Live Duel Track
                  </p>
                  <div className="pixel-duel">
                    <Image
                      className="duel-img"
                      src="/img/cardano_horse.png"
                      alt="Cardano horse"
                      width={44}
                      height={44}
                    />
                    <span className="pixel-vs">VS</span>
                    <Image
                      className="duel-img"
                      src="/img/bitcoin_horse.png"
                      alt="Bitcoin horse"
                      width={44}
                      height={44}
                    />
                  </div>
                </div>

                <div className="track-lane mb-3">
                  <span className="lane-tag">Player A</span>
                  <span className="lane-asset">ADA/USD</span>
                  <span className="runner">
                    <Image
                      className="lane-horse"
                      src="/img/cardano_horse.png"
                      alt="ADA horse"
                      width={52}
                      height={52}
                    />
                  </span>
                </div>

                <div className="track-lane">
                  <span className="lane-tag">Player B</span>
                  <span className="lane-asset">BTC/USD</span>
                  <span className="runner delayed">
                    <Image
                      className="lane-horse"
                      src="/img/bitcoin_horse.png"
                      alt="BTC horse"
                      width={52}
                      height={52}
                    />
                  </span>
                </div>

                <p className="mt-4 text-xs text-amber-100/80">
                  The winner is determined by <strong>% change</strong>.
                </p>
              </div>

              <div className="rounded-2xl border border-amber-300/30 bg-stone-900/70 p-4 md:p-6">
                <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-amber-200">
                  Ready To Enter
                </p>
                <p className="mb-4 text-xs text-amber-100/80">
                  Connect your wallet to create a duel or accept a challenge link.
                </p>
                <div className="wallet-nav-control mb-4">
                  <CardanoWallet persist />
                </div>
                {connected && (
                  <div className="rounded-xl border border-amber-200/25 bg-stone-950/70 p-3 text-xs text-amber-100/85">
                    Preset stake: <strong>10 / 25 / 50 ADA</strong>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-8">
          <h2 className="mb-5 text-xl text-amber-100 md:text-2xl">GAME FLOW</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {steps.map((step) => (
              <article
                key={step.title}
                className="rounded-2xl border border-amber-300/25 bg-stone-900/65 p-5"
              >
                <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-amber-200">
                  {step.title}
                </h3>
                <p className="mt-3 text-xs text-amber-100/85">{step.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 pb-14 pt-8">
          <div className="rounded-3xl border border-amber-300/35 bg-gradient-to-r from-amber-950/45 via-stone-950/90 to-emerald-950/35 p-6 md:p-8">
            <h2 className="text-xl text-amber-100 md:text-2xl">VERIFIABLE BY DESIGN</h2>
            <p className="mt-3 max-w-3xl text-xs text-amber-100/85 md:text-sm">
              We use Pyth to settle wagers with signed and verifiable prices.
              That makes duel outcomes reliable and transparent on Cardano.
            </p>
          </div>
        </section>
      </main>
    </>
  );
}
