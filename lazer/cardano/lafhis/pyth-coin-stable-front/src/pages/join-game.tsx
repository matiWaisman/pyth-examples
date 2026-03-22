import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@meshsdk/react";
import JoinGameConfigBar, { type JoinGameInput } from "@/components/JoinGameConfigBar";
import RequireWallet from "@/components/RequireWallet";
import type { GameSession } from "@/types/game";

function parseGameId(input: string) {
  const value = input.trim();
  if (!value) return "";

  if (value.includes("/game/")) {
    const match = value.match(/\/game\/([^/?#]+)/i);
    return match?.[1] ?? "";
  }

  return value;
}

export default function JoinGamePage() {
  const router = useRouter();
  const { address } = useWallet();
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gameInput, setGameInput] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    opponentRate: GameSession["config"]["rate"];
    betAda: number;
    gameId: string;
  } | null>(null);
  const initialGameInput = useMemo(() => {
    const q = router.query.gameId;
    return typeof q === "string" ? q : "";
  }, [router.query.gameId]);

  useEffect(() => {
    if (initialGameInput) {
      setGameInput(initialGameInput);
    }
  }, [initialGameInput]);

  useEffect(() => {
    const gameId = parseGameId(gameInput);
    if (!gameId) {
      setPreview(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }

    let active = true;
    setPreviewLoading(true);
    setPreviewError(null);

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const gameRes = await fetch(`/api/games/${gameId}`);
          const gameData = (await gameRes.json()) as { game?: GameSession; error?: string };
          if (!gameRes.ok || !gameData.game) {
            throw new Error(gameData.error ?? "Game not found");
          }

          if (!active) return;
          setPreview({
            opponentRate: gameData.game.config.rate,
            betAda: gameData.game.config.betAda,
            gameId: gameData.game.id,
          });
        } catch (err) {
          if (!active) return;
          setPreview(null);
          const message = err instanceof Error ? err.message : "Could not load game preview";
          setPreviewError(message);
        } finally {
          if (active) setPreviewLoading(false);
        }
      })();
    }, 350);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [gameInput]);

  async function handleJoin({ selectedRate, gameInput }: JoinGameInput) {
    if (!address) {
      setError("Wallet address is still loading. Please wait and try again.");
      return;
    }

    const gameId = parseGameId(gameInput);
    if (!gameId) {
      setError("Enter a valid game ID or invite link.");
      return;
    }

      setJoining(true);
      setError(null);

      try {
        const gameRes = await fetch(`/api/games/${gameId}`);
        const gameData = (await gameRes.json()) as { game?: GameSession; error?: string };
        if (!gameRes.ok || !gameData.game) {
          throw new Error(gameData.error ?? "Game not found");
        }

        if (gameData.game.config.rate === selectedRate) {
          throw new Error("You must pick a different asset than your opponent.");
        }

        const joinRes = await fetch(`/api/games/${gameId}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            wallet: address,
            selectedRate,
          }),
        });
        const joinData = (await joinRes.json()) as { game?: GameSession; error?: string };
        if (!joinRes.ok || !joinData.game) {
          throw new Error(joinData.error ?? "Could not join game");
        }

        await router.push(`/game/${gameId}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not join game";
        setError(message);
      } finally {
        setJoining(false);
      }
  }

  return (
    <>
      <Head>
        <title>Join Game</title>
      </Head>
      <main className="mx-auto min-h-[60vh] w-[92%] max-w-6xl py-10">
        <RequireWallet
          title="Connect Wallet To Join Game"
          description="Connect your wallet to enter a game lobby."
        >
          <JoinGameConfigBar
            key={initialGameInput}
            joining={joining}
            error={error}
            initialGameInput={initialGameInput}
            gameInput={gameInput}
            onGameInputChange={setGameInput}
            preview={preview}
            previewLoading={previewLoading}
            previewError={previewError}
            onJoin={handleJoin}
          />
        </RequireWallet>
      </main>
    </>
  );
}
