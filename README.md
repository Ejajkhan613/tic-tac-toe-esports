# Cosmic Tic Tac Toe - Advanced Multiplayer

A visually stunning, real-time multiplayer Tic Tac Toe game with an authoritative server and persistent stats.

## Features
- **Cosmic Neon UI:** Glassmorphism and glow effects with smooth Framer Motion animations.
- **Authoritative Server:** Cheat-proof game logic handled by Node.js/Socket.io.
- **Persistent Stats:** MongoDB integration for global leaderboards and player win/loss records.
- **Live Chat:** Real-time messaging during games.
- **Spectator Mode:** Watch live matches using room codes.
- **Rematch System:** Synchronized "Play Again" voting.

## Setup

1. **Prerequisites:**
   - Node.js
   - MongoDB (Local or Atlas)

2. **Server Configuration:**
   Create a `.env` file in the `server` directory:
   ```env
   MONGODB_URI=mongodb://localhost:27017/tictactoe
   PORT=3001
   JWT_SECRET=jwt_secret
   EMAIL_USER=email@testmail.com
   EMAIL_PASS=app-password
   ```

3. **Install Dependencies:**
   ```bash
   npm install
   cd server
   npm install
   ```

4. **Run Development:**
   From the root directory:
   ```bash
   npm run dev
   ```

## Tech Stack
- **Frontend:** React, TypeScript, Vite, Framer Motion, Socket.io-client.
- **Backend:** Node.js, Express, Socket.io, Mongoose.
- **Database:** MongoDB.
