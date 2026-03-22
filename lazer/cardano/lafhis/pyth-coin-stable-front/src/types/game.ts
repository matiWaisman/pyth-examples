export type GameDuration = "1m" | "5m" | "1h";
export type GameRate = "ADA/USD" | "BTC/USD" | "ETH/USD" | "BNB/USD";
export type GameStatus = "waiting_for_player" | "ready";

export type GameConfig = {
  rate: GameRate;
  betAda: number;
  duration: GameDuration;
};

export type GameSession = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: GameStatus;
  config: GameConfig;
  playerOneWallet: string;
  playerTwoWallet: string | null;
  playerTwoRate: GameRate | null;
};
