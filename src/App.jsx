import { useState, useEffect, useRef, useCallback } from 'react';

// In development Vite serves on :3000 and the WS server runs on :8080 separately.
// In production the Nginx reverse proxy forwards /ws → the Node container on :8080,
// so we just swap the scheme and append /ws to whatever host the page came from.
const WS_URL = import.meta.env.DEV
  ? 'ws://localhost:8080'
  : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;

const DEFAULT_EMOJIS = ['🍎', '🍊', '🍋', '🍇', '🍓', '🍒', '🥝', '🍑'];

function App() {
  const [page, setPage] = useState('landing');
  const [ws, setWs] = useState(null);
  const [gameId, setGameId] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [images, setImages] = useState([]);
  const [gameState, setGameState] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(null);
  const [opponentId, setOpponentId] = useState(null);

  // Refs so WebSocket message handler always sees current values
  // without stale closures
  const playerIdRef = useRef('');
  const opponentIdRef = useRef(null);
  const wsRef = useRef(null);

  // Keep refs in sync with state
  useEffect(() => { playerIdRef.current = playerId; }, [playerId]);
  useEffect(() => { opponentIdRef.current = opponentId; }, [opponentId]);
  useEffect(() => { wsRef.current = ws; }, [ws]);

  const sendMessage = useCallback((msg) => {
    const socket = wsRef.current;
    if (socket && socket.readyState === 1) {
      socket.send(JSON.stringify(msg));
    }
  }, []);

  // handleMessage reads identity from refs, not captured state
  const handleMessage = useCallback((msg) => {
    console.log('handleMessage received:', msg);
    const currentPlayerId = playerIdRef.current;
    const currentOpponentId = opponentIdRef.current;

    switch (msg.type) {
      case 'created':
        playerIdRef.current = msg.playerId;
        setGameId(msg.gameId);
        setPlayerId(msg.playerId);
        localStorage.setItem('memoryGameId', msg.gameId);
        localStorage.setItem('memoryPlayerId', msg.playerId);
        setPage('setup');
        break;

      case 'joined':
        playerIdRef.current = msg.playerId;
        setGameId(msg.gameId);
        setPlayerId(msg.playerId);
        localStorage.setItem('memoryGameId', msg.gameId);
        localStorage.setItem('memoryPlayerId', msg.playerId);
        setPage('waiting');
        break;

      case 'playerJoined':
        console.log('Player joined:', msg.playerId);
        opponentIdRef.current = msg.playerId;
        setOpponentId(msg.playerId);
        setStatus({ type: 'joined', text: 'Player joined!' });
        setGameState(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            players: [...(prev.players || []), msg.playerId],
            scores: { ...prev.scores, [msg.playerId]: 0 }
          };
        });
        setTimeout(() => setStatus(null), 2000);
        break;

      case 'imagesUploaded':
        console.log('Received imagesUploaded', msg.uploaderId, currentPlayerId);
        if (msg.uploaderId !== currentPlayerId && msg.state) {
          setImages(msg.images);
          setGameState(msg.state);
          const otherPlayer = (msg.state.players || []).find(p => p !== currentPlayerId);
          console.log('Setting opponent from imagesUploaded:', otherPlayer);
          if (otherPlayer) {
            opponentIdRef.current = otherPlayer;
            setOpponentId(otherPlayer);
          }
          setPage('game');
        }
        break;

      case 'playerLeft':
      case 'playerDisconnected':
        setStatus({ type: 'error', text: 'Other player disconnected' });
        setTimeout(() => {
          localStorage.clear();
          setPage('landing');
          setGameState(null);
        }, 2000);
        break;

      case 'gameState':
        console.log('Received gameState:', msg.state.currentTurn, msg.state.players);
        console.log('Current playerId:', currentPlayerId, 'opponentId:', currentOpponentId);
        if (!currentOpponentId && msg.state.players) {
          const otherPlayer = msg.state.players.find(p => p !== currentPlayerId);
          console.log('Setting opponent from gameState:', otherPlayer);
          if (otherPlayer) {
            opponentIdRef.current = otherPlayer;
            setOpponentId(otherPlayer);
          }
        }
        setGameState(msg.state);
        break;

      case 'error':
        setError(msg.message);
        break;
    }
  }, []); // no deps — reads from refs

  const createGame = () => {
    console.log('Create Game clicked');
    const newWs = new WebSocket(WS_URL);
    newWs.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      handleMessage(msg);
    };
    newWs.onopen = () => {
      console.log('WebSocket connected, sending create');
      newWs.send(JSON.stringify({ type: 'create' }));
    };
    newWs.onclose = () => setWs(null);
    newWs.onerror = () => setError('Connection failed');
    wsRef.current = newWs;
    setWs(newWs);
  };

  const joinGame = () => {
    if (!joinCode || joinCode.length !== 6) return;
    console.log('Join Game clicked', joinCode);
    const newWs = new WebSocket(WS_URL);
    newWs.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      handleMessage(msg);
    };
    newWs.onopen = () => {
      newWs.send(JSON.stringify({ type: 'join', gameId: joinCode.toUpperCase() }));
    };
    newWs.onclose = () => setWs(null);
    newWs.onerror = () => setError('Connection failed');
    wsRef.current = newWs;
    setWs(newWs);
  };

  const handleImageUpload = (index, file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      setImages(prev => {
        const newImages = [...prev];
        newImages[index] = e.target.result;
        return newImages;
      });
    };
    reader.readAsDataURL(file);
  };

  const handleBulkUpload = (e) => {
    const files = Array.from(e.target.files).slice(0, 8);
    if (files.length === 0) return;

    let loaded = 0;
    const newImages = new Array(files.length);

    files.forEach((file, idx) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        newImages[idx] = e.target.result;
        loaded++;
        if (loaded === files.length) {
          setImages(newImages);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const startGame = () => {
    console.log('startGame called, ws:', ws, 'ws.readyState:', ws?.readyState);
    const finalImages = images.length >= 8
      ? images.slice(0, 8)
      : [...images, ...DEFAULT_EMOJIS.slice(images.length)];

    const currentPlayerId = playerIdRef.current;
    const currentOpponentId = opponentIdRef.current;
    const currentPlayers = currentOpponentId
      ? [currentPlayerId, currentOpponentId]
      : [currentPlayerId];

    // Build ONE shuffled deck and use it for both local state and broadcast
    const shuffledCards = [...finalImages, ...finalImages]
      .map((img, i) => ({ id: i, image: img, matched: false }))
      .sort(() => Math.random() - 0.5);

    const sharedState = {
      cards: shuffledCards,
      flippedCards: [],
      currentTurn: currentPlayerId,
      scores: Object.fromEntries(currentPlayers.map(p => [p, 0])),
      phase: 'playing',
      winner: null,
      players: currentPlayers
    };

    setGameState(sharedState);
    setPage('game');

    const socket = wsRef.current;
    if (socket && socket.readyState === 1) {
      socket.send(JSON.stringify({
        type: 'uploadImages',
        images: finalImages,
        state: sharedState
      }));
    }
  };

  const flipCard = (cardId) => {
    // Use functional update so we always operate on the latest state,
    // avoiding stale closure reads entirely.
    setGameState(prev => {
      if (!prev) return prev;
      const currentPlayerId = playerIdRef.current;
      const currentOpponentId = opponentIdRef.current;

      console.log('flipCard called', cardId,
        'currentTurn:', prev.currentTurn,
        'playerId:', currentPlayerId,
        'flippedCards:', prev.flippedCards);

      if (prev.phase !== 'playing') return prev;
      if (prev.currentTurn !== currentPlayerId) {
        console.log('Not your turn');
        return prev;
      }
      if (prev.flippedCards.includes(cardId)) {
        console.log('Card already flipped');
        return prev;
      }
      if (prev.cards.find(c => c.id === cardId)?.matched) {
        console.log('Card already matched');
        return prev;
      }
      if (prev.flippedCards.length >= 2) {
        console.log('Already 2 cards flipped');
        return prev;
      }

      const newFlipped = [...prev.flippedCards, cardId];
      console.log('newFlipped length:', newFlipped.length);

      if (newFlipped.length === 2) {
        const card1 = prev.cards.find(c => c.id === newFlipped[0]);
        const card2 = prev.cards.find(c => c.id === newFlipped[1]);

        if (card1.image === card2.image) {
          // Match!
          const newCards = prev.cards.map(c =>
            newFlipped.includes(c.id) ? { ...c, matched: true } : c
          );
          const newScores = { ...prev.scores };
          newScores[currentPlayerId] = (newScores[currentPlayerId] || 0) + 1;

          const allMatched = newCards.every(c => c.matched);
          const myScore = newScores[currentPlayerId] || 0;
          const opponentScore = currentOpponentId
            ? (newScores[currentOpponentId] || 0)
            : 0;
          let winner = null;
          if (allMatched) {
            winner = myScore > opponentScore
              ? currentPlayerId
              : (myScore < opponentScore ? currentOpponentId : 'tie');
          }

          const newState = {
            ...prev,
            cards: newCards,
            scores: newScores,
            flippedCards: [],
            phase: allMatched ? 'finished' : 'playing',
            winner,
            currentTurn: currentPlayerId // keep turn on match
          };

          setStatus({ type: 'matched', text: 'Match found! Go again!' });
          setTimeout(() => setStatus(null), 1500);
          sendMessage({ type: 'gameState', state: newState });
          return newState;
        } else {
          // No match — pass turn
          const players = prev.players || [currentPlayerId];
          const nextPlayer = players.find(p => p !== currentPlayerId) || currentPlayerId;

          const newState = {
            ...prev,
            flippedCards: newFlipped, // briefly show both cards
            currentTurn: nextPlayer
          };

          setStatus({ type: 'mismatch', text: 'No match. Passing turn...' });

          // After a short delay, clear the flipped cards
          setTimeout(() => {
            setGameState(gs => {
              if (!gs) return gs;
              const cleared = { ...gs, flippedCards: [] };
              sendMessage({ type: 'gameState', state: cleared });
              return cleared;
            });
            setStatus(null);
          }, 2000);

          // Immediately broadcast the "both flipped" state so opponent can see
          sendMessage({ type: 'gameState', state: newState });
          return newState;
        }
      } else {
        // First card flipped
        const newState = { ...prev, flippedCards: newFlipped };
        sendMessage({ type: 'gameState', state: newState });
        return newState;
      }
    });
  };

  const leaveGame = () => {
    sendMessage({ type: 'leave' });
    localStorage.clear();
    setPage('landing');
    setGameId('');
    setPlayerId('');
    playerIdRef.current = '';
    setImages([]);
    setGameState(null);
    setStatus(null);
    if (ws) ws.close();
  };

  if (error) {
    return (
      <div className="app">
        <div className="modal">
          <h2>Error</h2>
          <p>{error}</p>
          <button className="button" onClick={() => setError('')}>OK</button>
        </div>
      </div>
    );
  }

  if (page === 'landing') {
    return (
      <div className="app">
        <h1 className="title">Memory Game</h1>
        <div className="landing">
          <button className="button" onClick={createGame}>Create Game</button>
          <button className="button secondary" onClick={() => setPage('join')}>Join Game</button>
        </div>
      </div>
    );
  }

  if (page === 'join') {
    return (
      <div className="app">
        <h1 className="title">Join Game</h1>
        <div className="join-form">
          <input
            className="input"
            placeholder="GAME CODE"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            maxLength={6}
          />
          <button className="button" onClick={joinGame} disabled={joinCode.length !== 6}>
            Join
          </button>
          <button className="button secondary" onClick={() => setPage('landing')}>Back</button>
        </div>
      </div>
    );
  }

  if (page === 'waiting') {
    return (
      <div className="app">
        <h1 className="title">Waiting</h1>
        <div className="waiting">
          <div className="spinner"></div>
          <p>Waiting for game creator to upload images...</p>
          {status && <p className="status-message">{status.text}</p>}
        </div>
      </div>
    );
  }

  if (page === 'setup') {
    return (
      <div className="app">
        <h1 className="title">Setup Game</h1>
        <div className="setup">
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            <div className="game-code-display">{gameId}</div>
            <p className="info-text">Share this code with the other player to join</p>
          </div>
          <h2>Upload 8 Images (or use defaults)</h2>
          <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
            <label className="button secondary" style={{ display: 'inline-block', cursor: 'pointer' }}>
              Upload All 8 at Once
              <input
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={handleBulkUpload}
              />
            </label>
          </div>
          <div className="image-grid">
            {[...Array(8)].map((_, i) => (
              <label key={i} className="image-upload">
                <span className="number">{i + 1}</span>
                {images[i] ? (
                  <img src={images[i]} alt={`Image ${i + 1}`} />
                ) : (
                  <span className="placeholder">Click to upload</span>
                )}
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => e.target.files[0] && handleImageUpload(i, e.target.files[0])}
                />
              </label>
            ))}
          </div>
          <div style={{ textAlign: 'center' }}>
            <button className="button" onClick={startGame}>
              {images.length > 0 ? 'Start with uploaded images' : 'Start with default emojis'}
            </button>
            <p className="info-text">Upload at least 1 image for custom cards</p>
          </div>
        </div>
      </div>
    );
  }

  if (page === 'game' && gameState) {
    const currentPlayerId = playerIdRef.current;
    const currentOpponentId = opponentIdRef.current;
    const isMyTurn = gameState.currentTurn === currentPlayerId;
    const myScore = gameState.scores[currentPlayerId] || 0;
    const otherPlayerId = currentOpponentId || gameState.players?.find(p => p !== currentPlayerId);
    const otherScore = otherPlayerId ? (gameState.scores[otherPlayerId] || 0) : 0;

    return (
      <div className="app">
        <button className="button secondary back-button" onClick={leaveGame}>Leave</button>
        <h1 className="title">Memory Game</h1>

        <div className="game-board">
          <div className="game-header">
            <div className={`player-info ${isMyTurn ? 'active' : ''}`}>
              <div className="name">You</div>
              <div className="score">{myScore}</div>
            </div>
            <div className="turn-indicator">
              {isMyTurn ? "Your turn!" : "Their turn"}
            </div>
            <div className="player-info">
              <div className="name">Opponent</div>
              <div className="score">{otherScore}</div>
            </div>
          </div>

          {status && (
            <div className={`status-message ${status.type}`}>
              {status.text}
            </div>
          )}

          <div className="cards-grid">
            {gameState.cards.map((card) => (
              <div
                key={card.id}
                className={`card ${(card.matched || gameState.flippedCards.includes(card.id)) ? 'flipped' : ''} ${card.matched ? 'matched' : ''}`}
                onClick={() => flipCard(card.id)}
              >
                <div className="card-inner">
                  <div className="card-face card-back"></div>
                  <div className="card-face card-front">
                    {card.image.startsWith('data:image') ? (
                      <img src={card.image} alt="card" />
                    ) : (
                      <span className="emoji">{card.image}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {gameState.phase === 'finished' && (
          <div className="modal-overlay">
            <div className="modal">
              <h2>Game Over!</h2>
              <div className="winner">
                {gameState.winner === 'tie'
                  ? "It's a Tie!"
                  : (gameState.winner === currentPlayerId ? 'You Win!' : 'You Lose!')}
              </div>
              <div className="score">
                You: {myScore} - Opponent: {otherScore}
              </div>
              <button className="button" onClick={leaveGame}>Play Again</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return <div className="app">Loading...</div>;
}

export default App;