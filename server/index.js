require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const authRoutes = require('./routes/auth');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/auth', authRoutes);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const JWT_SECRET = process.env.JWT_SECRET || 'JWT_secret';

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/tictactoe';
mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

const games = new Map();
let waitingQueue = [];
const userSocketMap = new Map(); // socket.id -> { userId, username }

// Socket Middleware for Auth
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication error'));
  
  jwt.verify(token, JWT_SECRET, async (err, decoded) => {
    if (err) return next(new Error('Authentication error'));
    const user = await User.findById(decoded.userId);
    if (!user) return next(new Error('User not found'));
    socket.user = user;
    next();
  });
});

function calculateWinner(squares) {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];
  for (const [a, b, c] of lines) {
    if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c]) {
      return { winner: squares[a], line: [a, b, c] };
    }
  }
  if (!squares.includes(null)) {
    return { winner: 'Draw', line: null };
  }
  return null;
}

const K_FACTOR = 32;
const expectedScore = (r1, r2) => 1 / (1 + Math.pow(10, (r2 - r1) / 400));

async function updateGameResults(game, winnerSymbol) {
  const { players, usernames } = game;
  const isDraw = winnerSymbol === 'Draw';
  
  const p1 = await User.findById(players[0]);
  const p2 = await User.findById(players[1]);

  if (!p1 || !p2) return;

  const wExp = expectedScore(p1.rank, p2.rank);
  const lExp = expectedScore(p2.rank, p1.rank);

  if (isDraw) {
    p1.draws++;
    p2.draws++;
    p1.rank += K_FACTOR * (0.5 - wExp);
    p2.rank += K_FACTOR * (0.5 - lExp);
  } else {
    const winner = winnerSymbol === 'X' ? p1 : p2;
    const loser = winnerSymbol === 'X' ? p2 : p1;
    const winnerExp = winnerSymbol === 'X' ? wExp : lExp;
    const loserExp = winnerSymbol === 'X' ? lExp : wExp;

    winner.wins++;
    loser.losses++;
    winner.rank += K_FACTOR * (1 - winnerExp);
    loser.rank += K_FACTOR * (0 - loserExp);
  }

  p1.rank = Math.max(0, Math.round(p1.rank));
  p2.rank = Math.max(0, Math.round(p2.rank));
  p1.activeMatchId = null;
  p2.activeMatchId = null;

  await p1.save();
  await p2.save();
  game.status = 'finished';
}

async function applyPenalty(userId, roomId) {
  const user = await User.findById(userId);
  if (!user) return;

  user.penaltyCount += 1;
  user.activeMatchId = null;
  
  const game = games.get(roomId);
  if (game && game.status === 'playing') {
    const opponentId = game.players.find(id => id !== userId.toString());
    const opponent = await User.findById(opponentId);
    
    if (opponent) {
      const uExp = expectedScore(user.rank, opponent.rank);
      const oExp = expectedScore(opponent.rank, user.rank);

      user.losses++;
      user.rank += K_FACTOR * (0 - uExp);
      opponent.wins++;
      opponent.rank += K_FACTOR * (1 - oExp);
      
      user.rank = Math.max(0, Math.round(user.rank));
      opponent.rank = Math.max(0, Math.round(opponent.rank));
      opponent.activeMatchId = null;
      await opponent.save();
    }
    
    game.status = 'finished';
    io.to(roomId).emit('opponent_surrendered', { winner: opponent ? opponent.username : 'Opponent' });
    games.delete(roomId);
  }

  // Ban formula: 5 mins * penaltyCount
  const banMinutes = user.penaltyCount * 5;
  user.banUntil = new Date(Date.now() + banMinutes * 60 * 1000);
  await user.save();
}

async function createGame(roomId, p1, p2) {
  const game = {
    id: roomId,
    players: [p1.userId.toString(), p2.userId.toString()],
    usernames: [p1.username, p2.username],
    board: Array(9).fill(null),
    isXNext: true,
    winner: null,
    winningLine: null,
    chat: [],
    rematchVotes: new Set(),
    status: 'playing',
    disconnectTimeouts: new Map()
  };
  games.set(roomId, game);

  await User.updateMany(
    { _id: { $in: [p1.userId, p2.userId] } },
    { $set: { activeMatchId: roomId } }
  );
  
  io.to(p1.socketId).emit('game_start', { 
    symbol: 'X', roomId, board: game.board, isXNext: true, opponent: p2.username 
  });
  io.to(p2.socketId).emit('game_start', { 
    symbol: 'O', roomId, board: game.board, isXNext: true, opponent: p1.username 
  });
}

io.on('connection', async (socket) => {
  const userId = socket.user._id;
  const username = socket.user.username;
  console.log(`User ${username} connected`);

  // Reconnection Logic
  if (socket.user.activeMatchId) {
    const roomId = socket.user.activeMatchId;
    const game = games.get(roomId);
    if (game && game.status === 'playing') {
      // Cancel disconnect timeout if it exists
      if (game.disconnectTimeouts.has(userId.toString())) {
        clearTimeout(game.disconnectTimeouts.get(userId.toString()));
        game.disconnectTimeouts.delete(userId.toString());
      }

      socket.join(roomId);
      const myIndex = game.players.indexOf(userId.toString());
      const mySymbol = myIndex === 0 ? 'X' : 'O';
      const opponentName = game.usernames[myIndex === 0 ? 1 : 0];

      socket.emit('reconnect_game', {
        symbol: mySymbol,
        roomId,
        board: game.board,
        isXNext: game.isXNext,
        opponent: opponentName,
        chat: game.chat,
        winner: game.winner
      });
      socket.to(roomId).emit('opponent_reconnected');
    } else {
      // Game ended while user was away
      await User.findByIdAndUpdate(userId, { $set: { activeMatchId: null } });
    }
  }

  socket.on('get_user_data', async () => {
    const user = await User.findById(userId);
    socket.emit('user_data', user);
  });

  socket.on('get_leaderboard', async () => {
    const leaderboard = await User.find().sort({ rank: -1 }).limit(10);
    socket.emit('leaderboard_data', leaderboard);
  });

  socket.on('join_random', async () => {
    const user = await User.findById(userId);
    if (user.banUntil && user.banUntil > Date.now()) {
      return socket.emit('error_message', `You are banned until ${user.banUntil.toLocaleTimeString()}`);
    }

    if (waitingQueue.some(p => p.userId.toString() === userId.toString())) return;
    
    if (waitingQueue.length > 0) {
      const opponent = waitingQueue.shift();
      const roomId = `room_${Math.random().toString(36).substr(2, 9)}`;
      socket.join(roomId);
      const opponentSocket = io.sockets.sockets.get(opponent.socketId);
      if (opponentSocket) opponentSocket.join(roomId);
      await createGame(roomId, opponent, { socketId: socket.id, userId, username });
    } else {
      waitingQueue.push({ socketId: socket.id, userId, username });
      socket.emit('waiting_for_opponent');
    }
  });

  socket.on('create_private', async () => {
    const user = await User.findById(userId);
    if (user.banUntil && user.banUntil > Date.now()) {
      return socket.emit('error_message', `You are banned until ${user.banUntil.toLocaleTimeString()}`);
    }

    const roomId = Math.random().toString(36).substr(2, 4).toUpperCase();
    socket.join(roomId);
    games.set(roomId, { 
      id: roomId, players: [userId.toString()], usernames: [username],
      board: Array(9).fill(null), isXNext: true, isPrivate: true,
      chat: [], rematchVotes: new Set(), status: 'waiting',
      disconnectTimeouts: new Map()
    });
    socket.emit('private_room_created', roomId);
  });

  socket.on('join_private', async (roomId) => {
    const game = games.get(roomId);
    if (game && game.isPrivate && game.players.length === 1) {
      socket.join(roomId);
      game.players.push(userId.toString());
      game.usernames.push(username);
      await createGame(roomId, { socketId: Array.from(io.sockets.sockets.values()).find(s => s.user._id.toString() === game.players[0]).id, userId: game.players[0], username: game.usernames[0] }, { socketId: socket.id, userId, username });
    } else {
      socket.emit('error_message', 'Invalid room code or room is full.');
    }
  });

  socket.on('join_spectator', (roomId) => {
    const game = games.get(roomId);
    if (game) {
      socket.join(roomId);
      socket.emit('spectator_joined', {
        roomId,
        board: game.board,
        isXNext: game.isXNext,
        winner: game.winner,
        usernames: game.usernames,
        chat: game.chat,
        status: game.status
      });
    } else {
      socket.emit('error_message', 'Room not found.');
    }
  });

  socket.on('make_move', async ({ roomId, index }) => {
    const game = games.get(roomId);
    if (!game || game.winner || game.status !== 'playing') return;

    const playerIndex = game.players.indexOf(userId.toString());
    if (playerIndex === -1) return;

    const symbol = playerIndex === 0 ? 'X' : 'O';
    const isPlayersTurn = (symbol === 'X' && game.isXNext) || (symbol === 'O' && !game.isXNext);

    if (isPlayersTurn && !game.board[index]) {
      game.board[index] = symbol;
      game.isXNext = !game.isXNext;
      const result = calculateWinner(game.board);
      
      if (result) {
        game.winner = result.winner;
        game.winningLine = result.line;
        await updateGameResults(game, result.winner);
      }
      
      io.to(roomId).emit('update_state', {
        board: game.board,
        isXNext: game.isXNext,
        winner: game.winner,
        winningLine: game.winningLine
      });
    }
  });

  socket.on('send_chat', ({ roomId, message }) => {
    const game = games.get(roomId);
    if (!game || !message.trim()) return;
    
    // Spectator check: if socket is not in game.players, ignore chat (frontend also hides input)
    if (!game.players.includes(userId.toString())) return;

    const chatMsg = { username, text: message.trim(), time: Date.now() };
    game.chat.push(chatMsg);
    io.to(roomId).emit('receive_chat', chatMsg);
  });

  socket.on('cancel_matchmaking', async ({ roomId }) => {
    waitingQueue = waitingQueue.filter(p => p.userId.toString() !== userId.toString());
    if (roomId) {
      const game = games.get(roomId);
      if (game && game.status === 'waiting') {
        games.delete(roomId);
        socket.leave(roomId);
      }
    }
    socket.emit('match_left');
  });

  socket.on('surrender', async ({ roomId }) => {
    await applyPenalty(userId, roomId);
  });

  socket.on('leave_match', async ({ roomId }) => {
    const game = games.get(roomId);
    if (!game) return;

    if (game.players.includes(userId.toString())) {
      if (game.status === 'playing') {
        // Leaving active match is surrender
        await applyPenalty(userId, roomId);
      } else {
        socket.leave(roomId);
        await User.findByIdAndUpdate(userId, { $set: { activeMatchId: null } });
      }
    } else {
      // Spectator leaving
      socket.leave(roomId);
    }
    socket.emit('match_left');
  });

  socket.on('vote_rematch', ({ roomId }) => {
    const game = games.get(roomId);
    if (!game || game.status !== 'finished') return;
    game.rematchVotes.add(userId.toString());
    
    if (game.rematchVotes.size === 2) {
      game.board = Array(9).fill(null);
      game.isXNext = true;
      game.winner = null;
      game.winningLine = null;
      game.rematchVotes = new Set();
      game.status = 'playing';
      io.to(roomId).emit('rematch_started', { board: game.board, isXNext: true });
    } else {
      socket.to(roomId).emit('opponent_voted_rematch');
    }
  });

  socket.on('disconnect', () => {
    console.log(`User ${username} disconnected`);
    waitingQueue = waitingQueue.filter(p => p.socketId !== socket.id);
    
    for (const [roomId, game] of games.entries()) {
      if (game.players.includes(userId.toString()) && game.status === 'playing') {
        socket.to(roomId).emit('opponent_disconnected_waiting');
        
        // Start 30s reconnection timer
        const timeout = setTimeout(async () => {
          console.log(`User ${username} failed to reconnect to ${roomId}. Applying penalty.`);
          await applyPenalty(userId, roomId);
        }, 30000);
        
        game.disconnectTimeouts.set(userId.toString(), timeout);
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
