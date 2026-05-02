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

## Demo Images
<img width="960" height="540" alt="Screenshot_1" src="https://github.com/user-attachments/assets/ad6e2ba9-f501-42c8-83fe-30e9206b61ff" />
<br />
<img width="960" height="540" alt="Screenshot_2" src="https://github.com/user-attachments/assets/b6ef6981-59e3-4a34-bb7e-659bd8478bf7" />
<br />
<img width="960" height="540" alt="Screenshot_3" src="https://github.com/user-attachments/assets/d3b4b843-0b26-4c02-bebe-00a522ed2eaf" />
<br />
<img width="960" height="540" alt="Screenshot_4" src="https://github.com/user-attachments/assets/1d4a35b3-4adc-405f-9a75-8d25a2608c8a" />
<br />
<img width="960" height="540" alt="Screenshot_5" src="https://github.com/user-attachments/assets/b657c7f9-3894-46ff-8d7b-ef38a2f3ef09" />
<br />
<img width="960" height="540" alt="Screenshot_6" src="https://github.com/user-attachments/assets/2f524d97-98b1-415b-b7cb-e338dc5f11f9" />


