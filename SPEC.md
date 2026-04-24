# Memory Game - Specification

## Core Concept
Two-player turn-based memory card game where players flip cards to find matching pairs. All game state and images stored client-side; server only relays moves between players.

## Game Rules
- 16 cards (8 pairs of matching images)
- Players alternate turns, flipping 2 cards per turn
- Both players can see all flipped cards (no hidden information)
- Match found: player gets another turn (continues)
- No match: cards flip back, turn passes to other player
- Game ends when all pairs are found; player with most matches wins

## Technical Architecture

### Server (Minimal)
- WebSocket server for real-time player communication
- No persistent storage - just relays messages
- Room-based: players join via game code

### Client
- React + Vite frontend
- localStorage for game state and images
- Game code acts as room identifier for WebSocket connection

## UI/UX

### Pages

**1. Landing Page**
- Two options: "Create Game" or "Join Game"
- Create Game: generates unique game code, proceeds to game setup
- Join Game: input field for game code, joins existing room

**2. Game Setup (Creator only)**
- Upload 8 unique images (or use default emoji set as fallback)
- Each image will be duplicated to create 2 matching cards
- "Start Game" button once images selected

**3. Game Board**
- 4x4 grid of cards (16 total)
- Card states: face-down, face-up (flipped), matched (removed from play)
- Turn indicator showing current player
- Score display for both players
- Game over modal with winner announcement

### Visual Design
- Clean, modern card-based design
- Smooth flip animations (CSS transform)
- Clear turn indicators
- Responsive layout (works on mobile)

## Data Structures

### Game State (localStorage per game ID)
```json
{
  "players": ["player1", "player2"],
  "currentTurn": "player1",
  "scores": { "player1": 0, "player2": 0 },
  "cards": [...],
  "flippedCards": [],
  "gamePhase": "playing" | "finished",
  "winner": null
}
```

### Messages (WebSocket)
- `join`: Player joins room
- `uploadImages`: Creator shares image data
- `flipCard`: Player flips a card
- `gameState`: Sync full state to all players
- `playerDisconnected`: Handle disconnect

## Acceptance Criteria
1. ✓ Two players can join same game via code
2. ✓ Creator can upload 8 images that are shared to other player
3. ✓ Both players see same board state in real-time
4. ✓ Turn system works correctly (switch on mismatch, continue on match)
5. ✓ Cards flip with animation
6. ✓ Scores update correctly
7. ✓ Game detects win condition
8. ✓ Works without any server-side storage (images in localStorage)