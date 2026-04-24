import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 8080 });

const games = new Map();

wss.on('connection', (ws) => {
  let currentGameId = null;
  let playerId = null;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      switch (message.type) {
        case 'create': {
          const gameId = generateGameCode();
          const playerId1 = generatePlayerId();
          currentGameId = gameId;
          playerId = playerId1;
          
          games.set(gameId, {
            players: [{ id: playerId1, ws }],
            creator: playerId1
          });
          
          ws.send(JSON.stringify({ 
            type: 'created', 
            gameId, 
            playerId,
            players: 1
          }));
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
          
          const playerId2 = generatePlayerId();
          currentGameId = message.gameId;
          playerId = playerId2;
          
          game.players.push({ id: playerId2, ws });
          
          ws.send(JSON.stringify({ 
            type: 'joined', 
            gameId: message.gameId,
            playerId,
            players: 2
          }));

          const creator = game.players.find(p => p.id === game.creator);
          if (creator && creator.ws.readyState === 1) {
            creator.ws.send(JSON.stringify({ 
              type: 'playerJoined',
              playerId: playerId2
            }));
          }
          break;
        }

        case 'uploadImages':
        case 'gameState': {
          const game = games.get(currentGameId);
          if (!game) return;
          
          const broadcastMessage = { ...message };
          if (message.type === 'uploadImages') {
            broadcastMessage.type = 'imagesUploaded';
            broadcastMessage.uploaderId = playerId;
            // Keep images in the initial upload so the opponent can render cards
          } else {
            // Strip image payloads from ongoing gameState messages —
            // the client already has the images and will rehydrate locally.
            broadcastMessage.state = stripImages(broadcastMessage.state);
          }
          
          console.log('Broadcasting to other players:', broadcastMessage.type);
          
          game.players.forEach(player => {
            if (player.id !== playerId && player.ws.readyState === 1) {
              console.log('Sending to player:', player.id);
              player.ws.send(JSON.stringify(broadcastMessage));
            }
          });
          break;
        }
        case 'restart': {
          const game = games.get(currentGameId);
          if (!game) return;
          
          const broadcastMessage = { ...message, playerId };
          
          game.players.forEach(player => {
            if (player.ws.readyState === 1) {
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
                if (player.id !== playerId && player.ws.readyState === 1) {
                  player.ws.send(JSON.stringify({ type: 'playerLeft' }));
                }
              });
              games.delete(currentGameId);
            }
          }
          break;
        }
      }
    } catch (e) {
      console.error('Error processing message:', e);
    }
  });

  ws.on('close', () => {
    if (currentGameId) {
      const game = games.get(currentGameId);
      if (game) {
        game.players = game.players.filter(p => p.id !== playerId);
        if (game.players.length === 0) {
          games.delete(currentGameId);
        } else {
          game.players.forEach(player => {
            if (player.ws.readyState === 1) {
              player.ws.send(JSON.stringify({ type: 'playerDisconnected' }));
            }
          });
        }
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
// the primary cause of production latency (~28 s with user photos).
function stripImages(state) {
  if (!state || !state.cards) return state;
  return {
    ...state,
    cards: state.cards.map(({ image, ...rest }) => rest)
  };
}

console.log('WebSocket server running on ws://localhost:8080');