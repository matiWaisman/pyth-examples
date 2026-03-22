import { HermesClient } from "@pythnetwork/hermes-client";
import { useEffect, useRef, useState } from "react";

const SYMBOLS = ["ADA/USD", "BTC/USD"] as const;
type Sym = (typeof SYMBOLS)[number];
const RACE_SECONDS = 60;
type RaceState = "idle" | "running" | "finished";

async function fetchLatestPrices(
  client: HermesClient,
  ids: Record<Sym, string>,
): Promise<Record<Sym, number> | null> {
  try {
    const updates = await client.getLatestPriceUpdates(Object.values(ids));
    const parsed = updates.parsed ?? [];
    const result = {} as Record<Sym, number>;
    for (const feed of parsed) {
      const entry = Object.entries(ids).find(([, id]) => id === feed.id);
      if (entry) {
        result[entry[0] as Sym] = Number(feed.price.price) * Math.pow(10, feed.price.expo);
      }
    }
    return result;
  } catch {
    return null;
  }
}

function Bar({ pct, color, negative }: { pct: number; color: "violet" | "cyan"; negative: boolean }) {
  const width = Math.min(Math.abs(pct) * 10, 100);
  const bg = negative
    ? "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]"
    : color === "violet"
      ? "bg-violet-500 shadow-[0_0_6px_rgba(124,58,237,0.7)]"
      : "bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.7)]";

  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
      <div
        className={`h-full rounded-full transition-all duration-500 ${bg}`}
        style={{ width: `${Math.max(width, 2)}%` }}
      />
    </div>
  );
}

function Lane({
  sym,
  color,
  currentPrice,
  pctChange,
  leading,
  winner,
  raceState,
}: {
  sym: Sym;
  color: "violet" | "cyan";
  currentPrice: number | null;
  pctChange: number | null;
  leading: boolean;
  winner: boolean;
  raceState: RaceState;
}) {
  const text = color === "violet" ? "text-violet-300" : "text-cyan-300";
  const border = color === "violet" ? "border-violet-500/30" : "border-cyan-500/25";
  const winnerRing = winner ? "ring-1 ring-emerald-400/50" : "";
  const negative = pctChange !== null && pctChange < 0;

  return (
    <div className={`rounded-xl border ${border} ${winnerRing} bg-slate-950/50 p-3 transition-all duration-300`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className={`text-[11px] font-bold ${text}`}>{sym}</span>
        <div className="flex items-center gap-1.5">
          {winner && (
            <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-emerald-400">
              winner
            </span>
          )}
          {leading && !winner && (
            <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-emerald-400">
              leading
            </span>
          )}
          {raceState === "idle" && currentPrice !== null && (
            <span className="text-[11px] font-bold tabular-nums text-slate-300">
              ${currentPrice < 10 ? currentPrice.toFixed(4) : currentPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          )}
          {raceState !== "idle" && pctChange !== null && (
            <span className={`text-[13px] font-bold tabular-nums ${negative ? "text-red-400" : "text-emerald-400"}`}>
              {pctChange >= 0 ? "+" : ""}{pctChange.toFixed(3)}%
            </span>
          )}
          {raceState !== "idle" && pctChange === null && (
            <span className="text-[10px] text-slate-500 animate-pulse">loading…</span>
          )}
        </div>
      </div>
      {raceState !== "idle" && (
        <Bar pct={pctChange ?? 0} color={color} negative={negative} />
      )}
    </div>
  );
}

export default function DuelPreview() {
  const [raceState, setRaceState] = useState<RaceState>("idle");
  const [seconds, setSeconds] = useState(RACE_SECONDS);
  const [currentPrices, setCurrentPrices] = useState<Partial<Record<Sym, number>>>({});
  const [startPrices, setStartPrices] = useState<Partial<Record<Sym, number>>>({});
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const clientRef = useRef<HermesClient | null>(null);
  const feedIdsRef = useRef<Record<Sym, string> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const client = new HermesClient("https://hermes.pyth.network", {});
    clientRef.current = client;

    void (async () => {
      try {
        const allFeeds = await client.getPriceFeeds({ assetType: "crypto" });
        const ids: Partial<Record<Sym, string>> = {};
        for (const feed of allFeeds) {
          const sym = (feed.attributes.display_symbol ?? "").toUpperCase() as Sym;
          if ((SYMBOLS as readonly string[]).includes(sym)) ids[sym] = feed.id;
        }
        if (!ids["ADA/USD"] || !ids["BTC/USD"]) return;
        feedIdsRef.current = ids as Record<Sym, string>;

        const prices = await fetchLatestPrices(client, feedIdsRef.current);
        if (prices) setCurrentPrices(prices);
        setReady(true);
      } catch {
        setError("Could not connect to Pyth.");
      }
    })();

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  async function startRace() {
    if (!clientRef.current || !feedIdsRef.current) return;
    setError(null);

    const prices = await fetchLatestPrices(clientRef.current, feedIdsRef.current);
    if (!prices) { setError("Failed to fetch prices. Try again."); return; }

    setStartPrices(prices);
    setCurrentPrices(prices);
    setSeconds(RACE_SECONDS);
    setRaceState("running");

    pollRef.current = setInterval(() => {
      void (async () => {
        const p = await fetchLatestPrices(clientRef.current!, feedIdsRef.current!);
        if (p) setCurrentPrices(p);
      })();
    }, 3000);

    let s = RACE_SECONDS;
    countdownRef.current = setInterval(() => {
      s -= 1;
      setSeconds(s);
      if (s <= 0) {
        clearInterval(countdownRef.current!);
        clearInterval(pollRef.current!);
        setRaceState("finished");
      }
    }, 1000);
  }

  function resetRace() {
    if (pollRef.current) clearInterval(pollRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    setRaceState("idle");
    setSeconds(RACE_SECONDS);
    setStartPrices({});
    // refresh idle prices
    if (clientRef.current && feedIdsRef.current) {
      void fetchLatestPrices(clientRef.current, feedIdsRef.current).then((p) => {
        if (p) setCurrentPrices(p);
      });
    }
  }

  function getPct(sym: Sym): number | null {
    const start = startPrices[sym];
    const cur = currentPrices[sym];
    if (!start || !cur) return null;
    return ((cur - start) / start) * 100;
  }

  const adaPct = getPct("ADA/USD");
  const btcPct = getPct("BTC/USD");
  const adaLeading = adaPct !== null && btcPct !== null && adaPct >= btcPct;
  const winner: Sym | null =
    raceState === "finished" && adaPct !== null && btcPct !== null
      ? adaPct >= btcPct ? "ADA/USD" : "BTC/USD"
      : null;

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-violet-100/40">Demo Duel</p>
        <span className={`rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider
          ${raceState === "running"
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
            : raceState === "finished"
              ? "border-violet-500/30 bg-violet-500/10 text-violet-300"
              : "border-slate-600/40 bg-slate-800/40 text-slate-400"}`}>
          {raceState === "running" ? "● live" : raceState === "finished" ? "finished" : "ready"}
        </span>
      </div>

      <Lane sym="ADA/USD" color="violet" currentPrice={currentPrices["ADA/USD"] ?? null}
        pctChange={adaPct} leading={raceState === "running" && adaLeading}
        winner={winner === "ADA/USD"} raceState={raceState} />

      <Lane sym="BTC/USD" color="cyan" currentPrice={currentPrices["BTC/USD"] ?? null}
        pctChange={btcPct} leading={raceState === "running" && !adaLeading && btcPct !== null}
        winner={winner === "BTC/USD"} raceState={raceState} />

      <div className="flex items-center justify-between rounded-xl border border-slate-700/40 bg-slate-950/50 px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <svg className="h-3 w-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
          </svg>
          <span className={`text-[12px] font-bold tabular-nums ${seconds <= 10 && raceState === "running" ? "animate-pulse text-red-400" : "text-slate-300"}`}>
            {mm}:{ss}
          </span>
        </div>

        {raceState === "idle" && (
          <button onClick={() => void startRace()} disabled={!ready}
            className="flex items-center gap-1.5 rounded-lg border border-violet-400/60 bg-violet-500/20 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-violet-200 transition hover:bg-violet-500/30 disabled:cursor-wait disabled:opacity-40">
            <span>▶</span> Start Race
          </button>
        )}

        {raceState === "running" && (
          <span className="text-[9px] text-slate-500 animate-pulse">Fetching live from Pyth…</span>
        )}

        {raceState === "finished" && (
          <button onClick={resetRace}
            className="rounded-lg border border-cyan-400/50 bg-cyan-500/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-cyan-300 transition hover:bg-cyan-500/25">
            ↺ Race Again
          </button>
        )}
      </div>

      {error && <p className="text-[10px] text-red-400">{error}</p>}

      <p className="text-center text-[9px] text-violet-100/30">
        {raceState === "idle"
          ? "Live prices from Pyth · press Start to begin"
          : raceState === "running"
            ? "Highest % change at end of window wins the pot"
            : `${winner} wins this demo round`}
      </p>
    </div>
  );
}
