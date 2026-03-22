import Head from "next/head";
import { useRouter } from "next/router";
import { useState } from "react";
import CreateGameConfigBar from "@/components/CreateGameConfigBar";
import type { CreateGameConfigInput } from "@/components/CreateGameConfigBar";
import RequireWallet from "@/components/RequireWallet";
import { useWallet } from "@meshsdk/react";

export default function CreateGamePage() {
  const router = useRouter();
  const { address } = useWallet();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(config: CreateGameConfigInput) {
    if (!address) {
      setError("Wallet address is still loading. Please wait and try again.");
      return;
    }

    setCreating(true);
    setError(null);

    try {
      const response = await fetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config,
          creatorWallet: address,
        }),
      });

      const data = (await response.json()) as { game?: { id: string }; error?: string };
      if (!response.ok || !data.game?.id) {
        throw new Error(data.error ?? "Could not create game");
      }

      await router.push(`/game/${data.game.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create game";
      setError(message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <Head>
        <title>Create Game</title>
      </Head>
      <main className="mx-auto min-h-[60vh] w-[92%] max-w-6xl py-10">
        <RequireWallet
          title="Connect your  Wallet To Create a Game"
          description="Connect your wallet to configure the game."
        >
          <CreateGameConfigBar creating={creating} error={error} onCreate={handleCreate} />
        </RequireWallet>
      </main>
    </>
  );
}
