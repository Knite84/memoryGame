import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 8080 });
const games = new Map();

// TTL: evict games inactive for more than 30 minutes (sliding window).
const TTL_MS = 30 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [gameId, game] of games) {
    if (now - game.lastActive > TTL_MS) {
      console.log(`Evicting stale game ${gameId}`);
      games.delete(gameId);
    }
  }
}, 60_000);

wss.on('connection', (ws) => {
  // Per-connection identity — used by the close handler to locate the slot.
  let currentGameId = null;
  let playerId = null;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {

        case 'create': {
          const gameId = generateGameCode();
          const pid = generatePlayerId();
          currentGameId = gameId;
          playerId = pid;

          games.set(gameId, {
            players: [{ id: pid, ws, role: 'creator' }],
            creator: pid,
            lastActive: Date.now(),
            cachedImages: null,
            cachedGameState: null,
          });

          ws.send(JSON.stringify({ type: 'created', gameId, playerId: pid, players: 1 }));
          break;
        }

        case 'join': {
          const game = games.get(message.gameId);
          if (!game) {
            ws.send(JSON.stringify({ type: 'error', message: 'Game not found' }));
            return;
          }
          if (game.players.length >= 2) {
            ws.send(JSON.stringify({ type: 'error', message: 'Game is full' }));
            return;
          }

          const pid = generatePlayerId();
          currentGameId = message.gameId;
          playerId = pid;

          game.players.push({ id: pid, ws, role: 'joiner' });
          game.lastActive = Date.now();

          ws.send(JSON.stringify({ type: 'joined', gameId: message.gameId, playerId: pid, players: game.players.length }));

          const creator = game.players.find(p => p.role === 'creator');
          if (creator && creator.ws && creator.ws.readyState === 1) {
            creator.ws.send(JSON.stringify({ type: 'playerJoined', playerId: pid }));
          }
          break;
        }

        case 'reconnect': {
          const game = games.get(message.gameId);
          if (!game) {
            ws.send(JSON.stringify({ type: 'error', message: 'Game expired or not found' }));
            return;
          }

          const slot = game.players.find(p => p.id === message.playerId);
          if (!slot) {
            ws.send(JSON.stringify({ type: 'error', message: 'Player not found in game' }));
            return;
          }

          // Swap in the fresh socket
          slot.ws = ws;
          currentGameId = message.gameId;
          playerId = message.playerId;
          game.lastActive = Date.now();

          const reconnectedMsg = {
            type: 'reconnected',
            gameId: message.gameId,
            playerId: message.playerId,
            role: slot.role,
            players: game.players.length,
            // IDs of the other players in the game — lets the client restore opponentId
            otherPlayers: game.players.filter(p => p.id !== message.playerId).map(p => p.id),
          };
          if (game.cachedGameState) reconnectedMsg.gameState = game.cachedGameState;
          if (game.cachedImages)    reconnectedMsg.images = game.cachedImages;

          ws.send(JSON.stringify(reconnectedMsg));

          game.players.forEach(p => {
            if (p.id !== message.playerId && p.ws && p.ws.readyState === 1) {
              p.ws.send(JSON.stringify({ type: 'playerReconnected', playerId: message.playerId }));
            }
          });

          console.log(`Player ${message.playerId} reconnected to game ${message.gameId}`);
          break;
        }

        case 'uploadImages':
        case 'gameState': {
          const game = games.get(currentGameId);
          if (!game) return;

          game.lastActive = Date.now();

          const broadcastMessage = { ...message };
          if (message.type === 'uploadImages') {
            broadcastMessage.type = 'imagesUploaded';
            broadcastMessage.uploaderId = playerId;
            game.cachedImages = message.images;
            game.cachedGameState = message.state;
          } else {
            broadcastMessage.state = stripImages(broadcastMessage.state);
            // Cache original (with images) for reconnect rehydration
            game.cachedGameState = message.state;
          }

          console.log('Broadcasting to other players:', broadcastMessage.type);
          game.players.forEach(player => {
            if (player.id !== playerId && player.ws && player.ws.readyState === 1) {
              console.log('Sending to player:', player.id);
              player.ws.send(JSON.stringify(broadcastMessage));
            }
          });
          break;
        }

        case 'restart': {
          const game = games.get(currentGameId);
          if (!game) return;
          game.lastActive = Date.now();
          const broadcastMessage = { ...message, playerId };
          game.players.forEach(player => {
            if (player.ws && player.ws.readyState === 1) {
              player.ws.send(JSON.stringify(broadcastMessage));
            }
          });
          break;
        }

        case 'leave': {
          if (currentGameId) {
            const game = games.get(currentGameId);
            if (game) {
              game.players.forEach(player => {
                if (player.id !== playerId && player.ws && player.ws.readyState === 1) {
                  player.ws.send(JSON.stringify({ type: 'playerLeft' }));
                }
              });
              games.delete(currentGameId);
            }
            currentGameId = null;
            playerId = null;
          }
          break;
        }
      }
    } catch (e) {
      console.error('Error processing message:', e);
    }
  });

  // Soft disconnect: null out the ws slot but keep the game alive.
  // The game is only hard-deleted by an explicit 'leave' message or TTL expiry.
  ws.on('close', () => {
    if (currentGameId) {
      const game = games.get(currentGameId);
      if (game) {
        const slot = game.players.find(p => p.id === playerId);
        if (slot) {
          slot.ws = null;
          game.lastActive = Date.now();
        }
        game.players.forEach(player => {
          if (player.id !== playerId && player.ws && player.ws.readyState === 1) {
            player.ws.send(JSON.stringify({ type: 'playerDisconnected' }));
          }
        });
      }
    }
  });
});

function generateGameCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function generatePlayerId() {
  return 'p' + Math.random().toString(36).substr(2, 9);
}

// Remove base64 image data from card objects before broadcasting gameState.
// Clients already hold the images locally; sending them on every flip is
// the primary cause of production latency.
function stripImages(state) {
  if (!state || !state.cards) return state;
  return {
    ...state,
    cards: state.cards.map(({ image, ...rest }) => rest)
  };
}

console.log('WebSocket server running on ws://localhost:8080');