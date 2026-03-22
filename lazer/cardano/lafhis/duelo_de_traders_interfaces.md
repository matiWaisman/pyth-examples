# Duelo de Traders — Especificación de Interfaces

## Propósito de este documento

Este documento define todas las interfaces de comunicación entre las capas de la dApp: frontend ↔ backend (REST + WebSocket), backend ↔ blockchain (MeshJS), backend ↔ Pyth (SDK), y backend ↔ Blockfrost (indexación). No contiene implementación, pero sí la especificación completa de endpoints, funciones, parámetros, respuestas, y el flujo de datos entre componentes.

---

## Estados de un duelo

Todo el sistema gira alrededor de estos estados. Cada duelo pasa secuencialmente por ellos:

| Estado | Significado | Quién lo dispara |
|---|---|---|
| `WAITING` | Un jugador creó el duelo y depositó. Falta oponente. | Jugador A confirma depósito |
| `READY` | Ambos jugadores depositaron. Listo para iniciar. | Jugador B confirma depósito |
| `ACTIVE` | TX de start submiteada. Precios iniciales registrados. Corre el reloj. | Backend |
| `RESOLVING` | El minuto pasó. Backend construyendo/submiteando TX de resolve. | Backend |
| `FINISHED` | Resuelto. Hay ganador o empate. Fondos distribuidos. | Backend |
| `CANCELLED` | Duelo cancelado antes de completarse (timeout sin oponente, error). | Backend o jugador |

---

## 1. Frontend ↔ Backend: REST API

### Stack del backend

El backend está implementado en Node.js/TypeScript. Esto permite usar MeshJS, el SDK de Pyth (`@pythnetwork/pyth-lazer-sdk`), y el SDK de Blockfrost directamente, todo en el mismo runtime. Se usa Express o Fastify para la REST API, y `ws` o `socket.io` para los WebSockets.

### Autenticación: login con wallet

Los usuarios se identifican por su wallet de Cardano vía CIP-30. No hay cuentas ni contraseñas.

#### `POST /auth/connect`

Inicia sesión conectando una wallet. El frontend envía la dirección obtenida tras conectar la wallet vía CIP-30.

Request body:
```json
{
  "address": "addr1..."
}
```

Response:
```json
{
  "session_token": "tok_abc123",
  "address": "addr1..."
}
```

Para la hackathon, conectar la wallet y enviar la dirección es suficiente. Para autenticación fuerte (post-hackathon), se puede agregar un flujo de firma de mensaje:

#### `GET /auth/challenge` (opcional, post-hackathon)

Solicita un mensaje a firmar para probar ownership de la wallet.

Response:
```json
{
  "challenge": "Iniciar sesión en Duelo de Traders - nonce: abc123"
}
```

#### `POST /auth/verify` (opcional, post-hackathon)

Envía la firma del challenge para verificación.

Request body:
```json
{
  "address": "addr1...",
  "signature": "...",
  "key": "..."
}
```

Response:
```json
{
  "session_token": "tok_abc123",
  "address": "addr1..."
}
```

MeshJS tiene utilidades tanto del lado del frontend (conectar wallet, pedir firma) como del backend (verificar firma).

---

### Duelos

#### `POST /duels`

Crear un nuevo duelo. El jugador elige su asset y el monto de la apuesta. Los montos son predefinidos (10, 25, 50 ADA).

Request body:
```json
{
  "player_address": "addr1...",
  "asset_feed_id": 16,
  "asset_name": "ADA/USD",
  "bet_amount_lovelace": 50000000
}
```

Response:
```json
{
  "duel_id": "duel_abc123",
  "status": "WAITING",
  "challenge_url": "https://duelo.gg/d/abc123",
  "deposit_tx_data": {
    "script_address": "addr1...",
    "amount_lovelace": 50000000,
    "datum": "..."
  }
}
```

El frontend usa `deposit_tx_data` para construir la TX de depósito que el jugador firma con su wallet. El `challenge_url` es el link compartible para que el oponente se una (Challenge Link).

---

#### `POST /duels/:id/join`

Unirse a un duelo existente como oponente.

Request body:
```json
{
  "player_address": "addr1...",
  "asset_feed_id": 29,
  "asset_name": "BTC/USD"
}
```

Response:
```json
{
  "duel_id": "duel_abc123",
  "status": "WAITING",
  "deposit_tx_data": {
    "script_address": "addr1...",
    "amount_lovelace": 50000000,
    "datum": "..."
  }
}
```

Validaciones: el asset elegido debe ser distinto al del creador. El monto es el mismo que definió el creador.

---

#### `POST /duels/:id/confirm-deposit`

El frontend avisa que la TX de depósito fue firmada y submiteada.

Request body:
```json
{
  "player_address": "addr1...",
  "tx_hash": "abc123..."
}
```

Response:
```json
{
  "duel_id": "duel_abc123",
  "status": "WAITING | READY",
  "deposits_confirmed": 1 | 2
}
```

Cuando `deposits_confirmed` es 2, el estado pasa a `READY` y el backend inicia automáticamente el duelo.

---

#### `GET /duels/:id`

Consultar el estado completo de un duelo.

Response:
```json
{
  "duel_id": "duel_abc123",
  "status": "ACTIVE",
  "player_a": {
    "address": "addr1...",
    "asset_feed_id": 16,
    "asset_name": "ADA/USD",
    "start_price": 0.45,
    "end_price": null,
    "percent_change": null
  },
  "player_b": {
    "address": "addr1...",
    "asset_feed_id": 29,
    "asset_name": "BTC/USD",
    "start_price": 68450.20,
    "end_price": null,
    "percent_change": null
  },
  "bet_amount_lovelace": 50000000,
  "started_at": "2026-03-22T14:30:00Z",
  "duration_seconds": 60,
  "winner": null,
  "result": null
}
```

Cuando el duelo está `FINISHED`, `end_price`, `percent_change`, `winner` y `result` se populan. `result` puede ser `"player_a"`, `"player_b"`, o `"draw"`.

---

#### `GET /duels`

Listar duelos. Soporta filtros por estado.

Query params:
- `status` (opcional): `WAITING`, `ACTIVE`, `FINISHED`
- `player_address` (opcional): filtrar duelos de un jugador específico

Response:
```json
{
  "duels": [
    {
      "duel_id": "duel_abc123",
      "status": "WAITING",
      "player_a": {
        "address": "addr1...",
        "asset_name": "ADA/USD"
      },
      "player_b": null,
      "bet_amount_lovelace": 50000000,
      "created_at": "2026-03-22T14:25:00Z"
    }
  ]
}
```

---

#### `POST /duels/:id/cancel`

Cancelar un duelo que está en `WAITING` (sin oponente). Solo el creador puede cancelar.

Request body:
```json
{
  "player_address": "addr1..."
}
```

Response:
```json
{
  "duel_id": "duel_abc123",
  "status": "CANCELLED",
  "refund_tx_hash": "abc123..."
}
```

El backend construye y submite la TX de refund que devuelve los ADA al creador.

---

### Leaderboard

#### `GET /leaderboard`

Ranking de jugadores por cantidad de victorias.

Query params:
- `limit` (opcional, default 50): cantidad de jugadores a devolver
- `offset` (opcional, default 0): para paginación

Response:
```json
{
  "leaderboard": [
    {
      "rank": 1,
      "address": "addr1...",
      "wins": 12,
      "losses": 3,
      "draws": 1
    },
    {
      "rank": 2,
      "address": "addr1...",
      "wins": 9,
      "losses": 5,
      "draws": 0
    }
  ],
  "total_players": 87
}
```

---

### Assets disponibles

#### `GET /assets`

Lista de assets disponibles para elegir en un duelo, con sus Pyth feed IDs. El backend obtiene esta lista de la Pyth Symbols List API (`https://history.pyth-lazer.dourolabs.app/history/v1/symbols?asset_type=crypto`) al arrancar y la cachea. Si Pyth agrega nuevos feeds, la app los muestra automáticamente sin cambios de código.

Query params:
- `asset_type` (opcional, default `crypto`): filtrar por tipo de asset

Response:
```json
{
  "assets": [
    { "feed_id": 16, "name": "ADA/USD", "asset_type": "crypto" },
    { "feed_id": 29, "name": "BTC/USD", "asset_type": "crypto" },
    { "feed_id": 36, "name": "ETH/USD", "asset_type": "crypto" },
    { "feed_id": 52, "name": "SOL/USD", "asset_type": "crypto" }
  ]
}
```

Fuente: Pyth Symbols List API. Los feed IDs son los de Pyth Pro.

---

## 2. Frontend ↔ Backend: WebSocket

Conexión por duelo: `ws://backend/duels/:id/live`

El frontend se suscribe cuando entra a la pantalla de un duelo. El backend pushea eventos como mensajes JSON:

### Eventos

#### `opponent_joined`

```json
{
  "event": "opponent_joined",
  "player_b": {
    "address": "addr1...",
    "asset_feed_id": 29,
    "asset_name": "BTC/USD"
  }
}
```

#### `deposits_confirmed`

```json
{
  "event": "deposits_confirmed",
  "status": "READY"
}
```

#### `duel_started`

```json
{
  "event": "duel_started",
  "start_prices": {
    "player_a": { "feed_id": 16, "price": 0.45, "timestamp_us": 1711115400000000 },
    "player_b": { "feed_id": 29, "price": 68450.20, "timestamp_us": 1711115400000000 }
  },
  "started_at": "2026-03-22T14:30:00Z",
  "duration_seconds": 60
}
```

#### `price_tick` (opcional, para UI en vivo)

```json
{
  "event": "price_tick",
  "prices": {
    "player_a": { "feed_id": 16, "price": 0.4512 },
    "player_b": { "feed_id": 29, "price": 68455.10 }
  },
  "elapsed_seconds": 32
}
```

Nota: estos ticks son puramente informativos para la UI. No tienen valor on-chain. El backend los obtiene suscribiéndose al stream de Pyth durante el duelo.

#### `duel_resolved`

```json
{
  "event": "duel_resolved",
  "end_prices": {
    "player_a": { "feed_id": 16, "price": 0.4530, "timestamp_us": 1711115460000000 },
    "player_b": { "feed_id": 29, "price": 68430.00, "timestamp_us": 1711115460000000 }
  },
  "percent_changes": {
    "player_a": 0.67,
    "player_b": -0.03
  },
  "result": "player_a",
  "winner_address": "addr1...",
  "resolve_tx_hash": "abc123..."
}
```

#### `duel_error`

```json
{
  "event": "duel_error",
  "message": "Failed to submit resolve transaction",
  "details": "..."
}
```

---

## 3. Backend ↔ Blockchain (MeshJS)

Funciones internas del backend para interactuar con la blockchain de Cardano.

### Lectura

#### `findDuelUTxO(duelId: string): UTxO | null`

Busca el UTxO del duelo en el script address. Identifica el duelo correcto parseando el datum de cada UTxO y comparando el duel ID.

#### `getDuelState(duelId: string): DuelDatum`

Lee el datum del UTxO del duelo y devuelve el estado on-chain estructurado: jugadores, assets, montos, precios iniciales (si existen), timestamps.

#### `getScriptAddress(): string`

Devuelve el script address del validator de duelos. Se calcula a partir del compiled script de Aiken.

#### `getMintingPolicyId(): string`

Devuelve el policy ID de la minting policy de tokens de victoria.

### Escritura

#### `buildDepositTxData(duelId, playerAddress, assetFeedId, betAmount): DepositTxData`

Genera los datos necesarios para que el frontend construya la TX de depósito. Incluye: script address, datum serializado (con duel ID, dirección del jugador, feed ID del asset, monto), y el monto a enviar. No construye la TX completa — eso lo hace el frontend con la wallet del jugador.

#### `buildStartTx(duelId, pythSignedPrices): Transaction`

Construye la TX de start. Operaciones:
- Consume el UTxO del duelo (estado READY)
- Incluye el Pyth State UTxO como reference input
- Hace zero-withdrawal del script de Pyth con los precios firmados como redeemer
- Produce un nuevo UTxO en el script address con datum actualizado (precios iniciales + timestamps)
- Firmada por la wallet operativa del backend

#### `buildResolveTx(duelId, pythSignedPrices): Transaction`

Construye la TX de resolve. Operaciones:
- Consume el UTxO del duelo (estado ACTIVE)
- Incluye el Pyth State UTxO como reference input
- Hace zero-withdrawal del script de Pyth con los precios finales firmados como redeemer
- Calcula % de cambio de cada asset off-chain (para saber a dónde enviar los fondos)
- Envía todos los ADA al ganador (o devuelve a cada uno en caso de empate)
- Mintea un token de victoria al ganador usando la minting policy
- Firmada por la wallet operativa del backend

#### `buildCancelTx(duelId): Transaction`

Construye la TX de cancelación. Devuelve los ADA depositados al creador. Solo válida si el duelo está en estado WAITING (sin oponente). Firmada por la wallet operativa del backend.

#### `submitTx(signedTx): string`

Submite una transacción firmada a la red de Cardano. Devuelve el TX hash.

#### `awaitTxConfirmation(txHash, maxRetries): boolean`

Espera a que una transacción sea confirmada en la blockchain. Retorna true si se confirma dentro del límite de reintentos, false si no.

### Pyth State

#### `getPythStateUTxO(): UTxO`

Busca y devuelve el UTxO que contiene el Pyth State NFT bajo el policy ID de Pyth. Necesario como reference input en todas las transacciones que verifican precios.

#### `getPythScriptHash(): string`

Extrae el hash del withdraw script de Pyth desde el Pyth State UTxO. Necesario para construir el zero-withdrawal.

---

## 4. Backend ↔ Pyth (SDK)

Funciones internas para obtener precios firmados y metadata de Pyth.

#### `fetchAvailableAssets(assetType?: string): PythSymbol[]`

Consulta la Pyth Symbols List API (`https://history.pyth-lazer.dourolabs.app/history/v1/symbols`) para obtener la lista completa de feeds disponibles. Acepta filtro opcional por `asset_type` (por ejemplo `crypto`). El backend llama a este endpoint al arrancar y cachea la lista para servirla al frontend vía `GET /assets`.

#### `fetchSignedPrices(feedIds: number[]): SignedPriceUpdate`

Llama al SDK de Pyth (`PythLazerClient`) y obtiene precios firmados para los feed IDs indicados. Solicita formato `solana` (little-endian, firma Ed25519). Devuelve los bytes crudos del update firmado, listos para incluir como redeemer en el zero-withdrawal.

Parámetros internos de la llamada:
- `channel`: `"fixed_rate@200ms"`
- `formats`: `["solana"]`
- `jsonBinaryEncoding`: `"hex"`
- `priceFeedIds`: los feed IDs de los dos assets del duelo
- `properties`: `["price", "exponent"]`

#### `subscribeToPrices(feedIds: number[], callback): Subscription`

Se suscribe al stream de Pyth para recibir precios en tiempo real. Usado durante el duelo para pushear `price_tick` al frontend vía WebSocket. Estos precios son puramente informativos — no se usan on-chain.

#### `parsePriceFromUpdate(update: Buffer, feedId: number): { price: number, timestamp_us: number }`

Parsea un precio específico de un update firmado. Usado para extraer los valores legibles que se almacenan en la base de datos del backend y se envían al frontend.

---

## 5. Backend ↔ Blockfrost (Indexación)

Funciones internas para consultar el estado de la blockchain.

#### `getVictoryTokenMintHistory(policyId: string): MintEvent[]`

Consulta Blockfrost por todas las transacciones que mintearon tokens bajo el policy ID de los tokens de victoria. Devuelve una lista de eventos con la dirección receptora y el TX hash de cada mint.

```
MintEvent {
  tx_hash: string
  recipient_address: string
  minted_at: string
}
```

#### `buildLeaderboard(mintHistory: MintEvent[]): LeaderboardEntry[]`

Procesa el historial de mint y cuenta victorias por dirección. Ordena de mayor a menor. Fuente de verdad: dirección receptora en el momento del mint, no la tenencia actual de tokens.

#### `getDuelHistory(playerAddress: string): DuelRecord[]`

Consulta las transacciones asociadas a un jugador en el script address para reconstruir su historial de duelos (victorias, derrotas, empates).

#### `monitorTxConfirmation(txHash: string): TxStatus`

Consulta Blockfrost para verificar si una transacción fue confirmada. Complementa `awaitTxConfirmation` de MeshJS.

---

## 6. Quién firma qué

| Transacción | Quién la construye | Quién la firma | Por qué |
|---|---|---|---|
| Depósito | Backend genera datos, frontend construye con wallet | Jugador (Nami, Eternl, etc.) | Mueve ADA del jugador al script address |
| Start | Backend | Wallet operativa del backend | No mueve fondos de jugadores, solo actualiza datum |
| Resolve | Backend | Wallet operativa del backend | Distribuye fondos y mintea token de victoria |
| Cancel | Backend | Wallet operativa del backend | Devuelve fondos al creador |

El backend necesita una wallet propia con ADA para pagar fees de start, resolve y cancel. Costo operativo mínimo.

---

## 7. Flujo completo (camino feliz — Challenge Link)

El modo principal de entrada es el Challenge Link. El jugador crea un duelo y recibe un link compartible. El oponente abre el link, ve qué asset eligió el creador, elige el suyo (diferente), y el duelo arranca. Los montos son predefinidos (10, 25, 50 ADA).

1. Jugador A conecta wallet → `POST /auth/connect` → obtiene sesión
2. Jugador A llama `POST /duels` → elige ADA/USD, 50 ADA
3. Backend devuelve `duel_id` + `challenge_url` + `deposit_tx_data`
4. Frontend construye TX de depósito → Jugador A firma con wallet → `POST /duels/:id/confirm-deposit`
5. Jugador A comparte el link (`duelo.gg/d/abc123`) por WhatsApp, Telegram, o muestra QR
6. Jugador B abre el link → conecta wallet → `POST /auth/connect`
7. Jugador B ve el duelo (`GET /duels/:id`): asset del creador (ADA/USD), monto (50 ADA)
8. Jugador B elige su asset (BTC/USD) → `POST /duels/:id/join`
9. Backend devuelve `deposit_tx_data` → Jugador B firma depósito → `POST /duels/:id/confirm-deposit`
10. Backend monitorea confirmación de ambos depósitos → estado pasa a `READY`
11. Backend llama `fetchSignedPrices([16, 29])` → `buildStartTx()` → `submitTx()` → estado pasa a `ACTIVE`
12. Backend pushea `duel_started` por WebSocket con precios iniciales
13. Backend se suscribe a stream de Pyth → pushea `price_tick` cada pocos segundos
14. Pasan ~60 segundos
15. Backend llama `fetchSignedPrices([16, 29])` → `buildResolveTx()` → `submitTx()` → estado pasa a `FINISHED`
16. Backend pushea `duel_resolved` por WebSocket con precios finales, % de cambio, y ganador
17. Frontend muestra resultado con animación

**Quick Duel (futuro):** modo alternativo donde el jugador entra, elige asset y monto, y se matchea automáticamente con otro jugador en cola. Requiere lógica de matchmaking y masa crítica de usuarios. Se puede agregar post-hackathon.

---

## 8. Datos que el backend persiste (base de datos propia)

El backend mantiene una base de datos (PostgreSQL o similar) con el estado de cada duelo para no depender exclusivamente de consultas a la blockchain:

- `duel_id`: identificador único
- `challenge_url`: link compartible para que el oponente se una
- `status`: estado actual del duelo
- `player_a_address`, `player_b_address`
- `player_a_feed_id`, `player_b_feed_id`
- `player_a_asset_name`, `player_b_asset_name`
- `bet_amount_lovelace`
- `deposit_a_tx_hash`, `deposit_b_tx_hash`
- `start_tx_hash`, `resolve_tx_hash`
- `start_price_a`, `start_price_b`
- `end_price_a`, `end_price_b`
- `percent_change_a`, `percent_change_b`
- `result`: `"player_a"`, `"player_b"`, `"draw"`
- `winner_address`
- `created_at`, `started_at`, `resolved_at`

La blockchain es la fuente de verdad para fondos y tokens. La base de datos es la fuente de verdad para el estado del flujo y la experiencia del usuario.
