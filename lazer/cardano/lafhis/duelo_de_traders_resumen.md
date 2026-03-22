# Duelo de Traders — Resumen de Diseño

## Contexto

Este documento es un resumen autocontenido de la dApp "Duelo de Traders", diseñada para la Buenos Aires Pythathon (21–22 de marzo de 2026). La hackathon tiene un solo track: construir una aplicación innovadora en Cardano que integre datos de precio en tiempo real de Pyth Oracle.

## La idea

Dos jugadores se enfrentan. Cada uno elige un asset distinto (por ejemplo, uno elige BTC y el otro ETH). Ambos depositan la misma cantidad de ADA en un contrato. Se define un período de aproximadamente 1 minuto. Cuando termina el período, el contrato consulta los precios verificados de Pyth para ver cuál de los dos assets subió más en porcentaje. El jugador que eligió el asset ganador se lleva todo el pozo. La resolución es completamente automática y verificable on-chain.

La UI debe ser gamificada — que parezca un juego, con countdown, animaciones y feedback visual. Las batallas son cortas (~1 minuto) para mantener la emoción y aprovechar la velocidad de los price feeds de Pyth.

## Stack tecnológico

- **On-chain (validators):** Aiken (validator de duelos + minting policy de tokens de victoria)
- **Construcción de transacciones off-chain:** MeshJS
- **Integración con Pyth:** `pyth-lazer-cardano` (Aiken library) + `@pythnetwork/pyth-lazer-sdk` (TypeScript SDK)
- **Indexación blockchain:** Blockfrost (consulta de leaderboard vía historial de mint)
- **Frontend:** Por definir (React o similar)
- **Backend/bot:** Servicio que orquesta el ciclo de vida de cada duelo

## Cómo fluyen los precios de Pyth en Cardano

El precio siempre viene del off-chain. La blockchain no solicita precios a ningún servicio externo. El flujo es:

1. El backend llama a Pyth vía websocket/API y recibe un precio firmado (bytes crudos con firma Ed25519).
2. El backend construye una transacción de Cardano e incluye esos bytes como redeemer en un zero-withdrawal del script de verificación de Pyth.
3. On-chain, el validator de Pyth verifica la firma y confirma que el precio es auténtico.
4. El validator propio de la dApp lee ese precio ya verificado mediante `pyth.get_updates(pyth_id, self)`.

El timestamp real del precio viene dentro del mensaje firmado de Pyth (campo `timestamp_us`), no del block time de Cardano.

## Autenticación: login con wallet

Los usuarios se identifican por su wallet de Cardano. No hay cuentas ni contraseñas — la wallet es la identidad. El flujo sigue el estándar CIP-30, que implementan todas las wallets del ecosistema (Nami, Eternl, Lace, Flint, etc.):

1. El usuario hace click en "Conectar Wallet" en el frontend.
2. La wallet muestra un popup pidiendo permiso para conectarse.
3. Una vez conectada, la app obtiene la dirección pública del usuario.
4. Opcionalmente, para autenticación fuerte, se le pide al usuario que firme un mensaje con su clave privada (por ejemplo "Iniciar sesión en Duelo de Traders"). El backend verifica la firma y crea una sesión.

MeshJS tiene utilidades tanto del lado del frontend (conectar wallet, pedir firma) como del backend (verificar firma). Para la hackathon, conectar la wallet y obtener la dirección es suficiente para identificar al jugador. La firma de mensaje se puede agregar después si sobra tiempo.

## Selección de assets: Pyth Symbols List API

La lista de assets disponibles para elegir en un duelo no se hardcodea. Pyth Pro expone una Symbols List API en `https://history.pyth-lazer.dourolabs.app/history/v1/symbols` que devuelve todos los feeds disponibles de forma programática. Acepta filtros opcionales: `?query=` para buscar por nombre y `?asset_type=crypto` para filtrar por tipo.

El backend consulta este endpoint al arrancar (o periódicamente), cachea la lista, y la sirve al frontend a través de `GET /assets`. Si Pyth agrega un nuevo feed, la app lo muestra automáticamente sin cambios de código.

## Cómo se inician los duelos: Challenge Link

El modo principal de entrada es el **Challenge Link**. El jugador crea un duelo, elige su asset y monto, deposita, y recibe un link tipo `duelo.gg/d/abc123`. Lo comparte por WhatsApp, Telegram, Twitter, o muestra un QR. El oponente abre el link, ve qué asset eligió el creador, elige el suyo (debe ser diferente), deposita, y el duelo arranca automáticamente.

Este modo es ideal para la demo de la hackathon: el presentador crea un duelo, proyecta el QR, y un juez lo escanea y juega en el momento.

El creador elige su asset primero, y el oponente lo ve antes de elegir el suyo (debe ser distinto). Esto es intencional: el oponente tiene que decidir estratégicamente con qué asset competir, lo cual agrega tensión al juego.

Los montos son predefinidos (por ejemplo 10, 25, 50 ADA) en vez de input libre, para reducir fricción — elegir es un click, escribir es pensar.

**Quick Duel (futuro):** un modo alternativo donde el jugador entra, elige asset y monto, y se matchea automáticamente con otro jugador en cola. Requiere lógica de matchmaking y masa crítica de usuarios. Se puede agregar post-hackathon.

## Fases de un duelo

### Fase 1 — Commit (on-chain)

Ambos jugadores depositan ADA en el script address. El datum del UTxO almacena: qué asset eligió cada jugador, las direcciones de pago de cada uno, y el monto apostado. En esta fase todavía no hay precios — el duelo no arrancó.

### Fase 2 — Start (on-chain + off-chain)

El backend fetchea los precios actuales de ambos assets desde Pyth, construye una transacción que hace el zero-withdrawal de Pyth con esos precios firmados, y la submite. El validator verifica los precios y los graba en el datum como "precios de inicio", junto con el timestamp de arranque (extraído del propio mensaje de Pyth).

### Fase 3 — Resolve (on-chain + off-chain)

Después de ~1 minuto, el backend fetchea los nuevos precios de Pyth, construye otra transacción de resolve. El validator lee los precios de inicio del datum, calcula el porcentaje de cambio de cada asset usando los precios finales, determina el ganador, y envía los fondos.

## Responsabilidades de cada capa

### Backend (orquestador)

- Gestiona el matchmaking y ciclo de vida de cada duelo
- Fetchea precios firmados de Pyth (inicio y final)
- Construye y submite las transacciones de start y resolve usando MeshJS
- Controla el timing del duelo (~1 minuto entre start y resolve)

### On-chain (validators en Aiken)

**Validator de duelos:**
- Valida que los depósitos sean correctos y simétricos
- En start: lee precios verificados de Pyth vía `pyth.get_updates`, los guarda en el datum
- En resolve: lee precios finales, calcula % de cambio de cada asset, determina ganador, envía fondos al ganador
- Sanity check temporal: verifica que `timestamp_final > timestamp_inicial + 30 segundos` (mínimo hardcodeado)

**Minting policy de tokens de victoria:**
- Solo permite mintear cuando se está resolviendo un duelo legítimo en la misma transacción
- Mintea un token al ganador del duelo

### Frontend

- UI gamificada: selección de asset, countdown visual, animaciones, resultado del duelo
- Interacción con wallets de Cardano para firmar las transacciones de depósito

## Leaderboard on-chain (tokens de victoria)

### Concepto

Cada vez que un jugador gana un duelo, se le mintea un token de victoria (native token de Cardano). El leaderboard no se almacena como estado en un UTxO compartido — se deriva de los eventos de mint en la blockchain. Esto evita problemas de concurrencia: no hay un UTxO de leaderboard que todos los duelos compitan por actualizar.

### Segundo validator: minting policy

La minting policy es un segundo validator escrito en Aiken. Solo permite mintear un token de victoria cuando se está resolviendo un duelo legítimo (en la misma transacción que el resolve). El validator de resolve y la minting policy se validan mutuamente en la misma transacción.

### La transacción de resolve ahora incluye tres acciones

1. Zero-withdrawal de Pyth para verificar precios finales
2. Gasto del UTxO del duelo para distribuir fondos al ganador
3. Mint de un token de victoria para el ganador

Todo ocurre atómicamente en la misma transacción.

### Transferibilidad de los tokens

Los native tokens en Cardano son inherentemente transferibles a nivel de protocolo — no hay soulbound tokens nativos. Un jugador podría transferir sus tokens de victoria a otra wallet. Para que esto no afecte el leaderboard, la fuente de verdad del ranking no es la tenencia actual de tokens, sino el historial de mint. Blockfrost permite consultar las transacciones de mint bajo un policy ID y ver a qué dirección se minteó cada token. El backend recorre esos eventos, cuenta cuántas veces cada dirección fue receptora de un mint, y arma el ranking. Si un jugador transfiere tokens, el leaderboard no cambia.

Los tokens en la wallet del jugador quedan como badges coleccionables, pero no determinan el ranking.

### Consulta del leaderboard

Se usa Blockfrost (plan gratuito) para consultar el historial de mint del policy ID de los tokens de victoria. El backend hace la consulta, cuenta victorias por dirección, ordena, y sirve el ranking al frontend.

## Decisiones de diseño

### Timing

El reloj del duelo lo maneja el backend, no la blockchain. El backend decide cuándo fetchear el precio inicial y cuándo el final. On-chain solo se hace un sanity check: que el timestamp del precio final sea al menos 30 segundos posterior al del precio inicial. Esto previene trampas sin crear problemas de latencia (entre construcción de TX, red, y confirmación de bloque, el resolve real puede ser 58 o 63 segundos en vez de 60 exactos).

### Concurrencia (eUTxO)

Cada duelo es un UTxO independiente. Esto permite múltiples duelos simultáneos sin contention — dos duelos distintos nunca compiten por el mismo UTxO.

### Empate

Si ambos assets suben exactamente lo mismo o no hay movimiento, se devuelve el depósito a cada jugador.

### Múltiples submissions

Las reglas de la hackathon permiten que un equipo envíe múltiples proyectos.

## Documentación de referencia de Pyth + Cardano

- Guía de integración: https://developer-hub-git-matej-cardano-docs-pyth-network.vercel.app/price-feeds/pro/integrate-as-consumer/cardano
- Aiken library: https://github.com/pyth-network/pyth-lazer-cardano
- Off-chain SDK JS: https://github.com/pyth-network/pyth-crosschain/tree/matej/cardano-governance/lazer/contracts/cardano/sdk/js
- Ejemplo fetch-and-verify: https://github.com/pyth-network/pyth-crosschain/blob/main/lazer/contracts/cardano/sdk/js/src/examples/fetch-and-verify.ts
- Preprod deployment TX: https://preprod.cexplorer.io/tx/6c13265654c352ca172bb359269ee082baf090c1b08507456d03ffa82b6c8b1b
- Price Feed IDs: https://www.pyth.network/price-feeds

## Próximos pasos

- Definir la estructura del datum (campos exactos para cada fase)
- Definir los redeemers del validator de duelos (Commit, Start, Resolve)
- Implementar el validator de duelos en Aiken
- Implementar la minting policy de tokens de victoria en Aiken
- Implementar el off-chain con MeshJS
- Integrar Blockfrost para el leaderboard
- Diseñar la UI gamificada
