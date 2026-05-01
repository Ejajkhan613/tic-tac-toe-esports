import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import './App.css';

type Player = 'X' | 'O' | null;
type ChatMessage = { username: string; text: string; time: number };
type UserStats = { 
  username: string; 
  email: string;
  wins: number; 
  losses: number; 
  draws: number; 
  winRate: number;
  rank: number;
  penaltyCount: number;
  banUntil: string | null;
};

type GameState = {
  board: Player[];
  isXNext: boolean;
  winner: Player | 'Draw';
  winningLine: number[] | null;
  roomId: string | null;
  mySymbol: Player;
  opponent: string | null;
  chat: ChatMessage[];
  status: 'playing' | 'finished' | 'waiting';
};

const SOCKET_URL = 'http://localhost:3001';
const API_URL = 'http://localhost:3001/api/auth';

function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [user, setUser] = useState<UserStats | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  
  // Auth States
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'otp' | 'forgot' | 'reset'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authUsername, setAuthUsername] = useState('');
  const [authOTP, setAuthOTP] = useState('');
  const [authNewPassword, setAuthNewPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Game States
  const [gameState, setGameState] = useState<GameState>({
    board: Array(9).fill(null),
    isXNext: true,
    winner: null,
    winningLine: null,
    roomId: null,
    mySymbol: null,
    opponent: null,
    chat: [],
    status: 'waiting',
  });
  
  const [status, setStatus] = useState<'hub' | 'waiting' | 'playing' | 'error' | 'spectating'>('hub');
  const [errorMessage, setErrorMessage] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [privateRoomCode, setPrivateRoomCode] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<UserStats[]>([]);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [opponentRematch, setOpponentRematch] = useState(false);
  const [votedRematch, setVotedRematch] = useState(false);
  const [opponentDisconnected, setOpponentDisconnected] = useState(false);
  const [surrenderWarning, setSurrenderWarning] = useState(false);
  const [banTimeLeft, setBanTimeLeft] = useState<number>(0);

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!token) return;

    const newSocket = io(SOCKET_URL, {
      auth: { token }
    });
    setSocket(newSocket);

    newSocket.on('user_data', (userData) => {
      setUser(userData);
      if (userData.banUntil) {
        const left = new Date(userData.banUntil).getTime() - Date.now();
        if (left > 0) setBanTimeLeft(Math.ceil(left / 1000));
      }
    });

    newSocket.on('leaderboard_data', (data) => {
      setLeaderboard(data);
    });

    newSocket.on('waiting_for_opponent', () => {
      setStatus('waiting');
    });

    newSocket.on('private_room_created', (code) => {
      setPrivateRoomCode(code);
      setStatus('waiting');
    });

    newSocket.on('game_start', ({ symbol, roomId, board, isXNext, opponent }) => {
      setGameState(prev => ({ 
        ...prev, 
        mySymbol: symbol, roomId, board, isXNext, opponent,
        winner: null, winningLine: null, chat: [], status: 'playing'
      }));
      setStatus('playing');
      setVotedRematch(false);
      setOpponentRematch(false);
      setOpponentDisconnected(false);
    });

    newSocket.on('reconnect_game', (data) => {
      setGameState({
        board: data.board,
        isXNext: data.isXNext,
        winner: data.winner,
        winningLine: null,
        roomId: data.roomId,
        mySymbol: data.symbol,
        opponent: data.opponent,
        chat: data.chat,
        status: data.winner ? 'finished' : 'playing'
      });
      setStatus('playing');
    });

    newSocket.on('update_state', ({ board, isXNext, winner, winningLine }) => {
      setGameState(prev => ({ ...prev, board, isXNext, winner, winningLine }));
    });

    newSocket.on('receive_chat', (msg) => {
      setGameState(prev => ({ ...prev, chat: [...prev.chat, msg] }));
    });

    newSocket.on('opponent_disconnected_waiting', () => {
      setOpponentDisconnected(true);
    });

    newSocket.on('opponent_reconnected', () => {
      setOpponentDisconnected(false);
    });

    newSocket.on('opponent_surrendered', ({ winner }) => {
      setErrorMessage(`${winner === user?.username ? 'Opponent' : winner} surrendered! You win!`);
      setStatus('hub'); // Move back to hub or show special modal
    });

    newSocket.on('opponent_voted_rematch', () => {
      setOpponentRematch(true);
    });

    newSocket.on('rematch_started', ({ board, isXNext }) => {
      setGameState(prev => ({ ...prev, board, isXNext, winner: null, winningLine: null, status: 'playing' }));
      setVotedRematch(false);
      setOpponentRematch(false);
    });

    newSocket.on('match_left', () => {
      backToHub(true);
    });

    newSocket.on('spectator_joined', (data) => {
      setGameState({
        board: data.board,
        isXNext: data.isXNext,
        winner: data.winner,
        winningLine: null,
        roomId: data.roomId,
        mySymbol: null,
        opponent: `${data.usernames[0]} vs ${data.usernames[1]}`,
        chat: data.chat,
        status: data.status === 'playing' ? 'playing' : 'finished'
      });
      setStatus('spectating');
    });

    newSocket.on('error_message', (msg) => {
      setErrorMessage(msg);
      setStatus('error');
    });

    newSocket.emit('get_user_data');

    return () => {
      newSocket.close();
    };
  }, [token]);

  useEffect(() => {
    if (banTimeLeft > 0) {
      const timer = setTimeout(() => setBanTimeLeft(banTimeLeft - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [banTimeLeft]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [gameState.chat]);

  // Auth Handlers
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      if (authMode === 'login') {
        const res = await axios.post(`${API_URL}/login`, { email: authEmail, password: authPassword });
        localStorage.setItem('token', res.data.token);
        setToken(res.data.token);
      } else if (authMode === 'register') {
        await axios.post(`${API_URL}/register`, { username: authUsername, email: authEmail, password: authPassword });
        setAuthMode('otp');
      } else if (authMode === 'otp') {
        const res = await axios.post(`${API_URL}/verify-otp`, { email: authEmail, otp: authOTP });
        localStorage.setItem('token', res.data.token);
        setToken(res.data.token);
      } else if (authMode === 'forgot') {
        await axios.post(`${API_URL}/forgot-password`, { email: authEmail });
        setAuthMode('reset');
      } else if (authMode === 'reset') {
        await axios.post(`${API_URL}/reset-password`, { email: authEmail, otp: authOTP, newPassword: authNewPassword });
        setAuthMode('login');
      }
    } catch (err: any) {
      setAuthError(err.response?.data?.message || 'Something went wrong');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    socket?.disconnect();
  };

  // Game Handlers
  const fetchLeaderboard = () => {
    socket?.emit('get_leaderboard');
    setShowLeaderboard(true);
  };

  const joinRandom = () => {
    if (banTimeLeft > 0) return;
    socket?.emit('join_random');
  };

  const createPrivate = () => {
    if (banTimeLeft > 0) return;
    socket?.emit('create_private');
  };

  const joinPrivate = () => {
    if (joinCode.length === 4) {
      socket?.emit('join_private', joinCode.toUpperCase());
    }
  };

  const watchGame = () => {
    if (joinCode) {
      socket?.emit('join_spectator', joinCode);
    }
  };

  const sendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (chatInput.trim() && gameState.roomId) {
      socket?.emit('send_chat', { roomId: gameState.roomId, message: chatInput });
      setChatInput('');
    }
  };

  const voteRematch = () => {
    socket?.emit('vote_rematch', { roomId: gameState.roomId });
    setVotedRematch(true);
  };

  const handleClick = (index: number) => {
    if (gameState.board[index] || gameState.winner || status !== 'playing') return;
    const isMyTurn = (gameState.mySymbol === 'X' && gameState.isXNext) || (gameState.mySymbol === 'O' && !gameState.isXNext);
    if (!isMyTurn) return;
    socket?.emit('make_move', { roomId: gameState.roomId, index });
  };

  const exitMatch = () => {
    if (status === 'playing' && !gameState.winner) {
      setSurrenderWarning(true);
    } else {
      socket?.emit('leave_match', { roomId: gameState.roomId });
    }
  };

  const confirmSurrender = () => {
    socket?.emit('surrender', { roomId: gameState.roomId });
    setSurrenderWarning(false);
  };

  const backToHub = (skipNotify = false) => {
    if (!skipNotify && gameState.roomId) {
      socket?.emit('leave_match', { roomId: gameState.roomId });
    }
    setStatus('hub');
    setGameState({
      board: Array(9).fill(null),
      isXNext: true,
      winner: null,
      winningLine: null,
      roomId: null,
      mySymbol: null,
      opponent: null,
      chat: [],
      status: 'waiting',
    });
    setErrorMessage('');
    setJoinCode('');
    setPrivateRoomCode(null);
    setVotedRematch(false);
    setOpponentRematch(false);
    setOpponentDisconnected(false);
    socket?.emit('get_user_data');
  };

  if (!token) {
    return (
      <div className="container">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="auth-card">
          <h1 className="title">E-SPORTS ARENA</h1>
          <form onSubmit={handleAuth} className="auth-form">
            {authMode === 'register' && (
              <input type="text" placeholder="Username" value={authUsername} onChange={e => setAuthUsername(e.target.value)} required className="auth-input" />
            )}
            <input type="email" placeholder="Email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} required className="auth-input" />
            {(authMode === 'login' || authMode === 'register') && (
              <input type="password" placeholder="Password" value={authPassword} onChange={e => setAuthPassword(e.target.value)} required className="auth-input" />
            )}
            {(authMode === 'otp' || authMode === 'reset') && (
              <input type="text" placeholder="6-digit OTP" maxLength={6} value={authOTP} onChange={e => setAuthOTP(e.target.value)} required className="auth-input" />
            )}
            {authMode === 'reset' && (
              <input type="password" placeholder="New Password" value={authNewPassword} onChange={e => setAuthNewPassword(e.target.value)} required className="auth-input" />
            )}
            
            <button type="submit" disabled={authLoading} className="lobby-button">
              {authLoading ? 'Please Wait...' : 
               authMode === 'login' ? 'Enter Arena' : 
               authMode === 'register' ? 'Create Account' : 
               authMode === 'otp' ? 'Verify OTP' : 
               authMode === 'forgot' ? 'Send Reset OTP' : 'Reset Password'}
            </button>
            
            {authError && <p className="error-text">{authError}</p>}
          </form>

          <div className="auth-switch">
            {authMode === 'login' ? (
              <>
                <p onClick={() => setAuthMode('register')}>New here? Join the league</p>
                <p onClick={() => setAuthMode('forgot')}>Forgot password?</p>
              </>
            ) : (
              <p onClick={() => setAuthMode('login')}>Already a pro? Sign in</p>
            )}
          </div>
        </motion.div>
      </div>
    );
  }

  if (status === 'hub') {
    return (
      <div className="container hub-layout">
        <div className="hub-header">
          <div className="hub-user">
            <div className="hub-avatar">{(user?.username || '?')[0].toUpperCase()}</div>
            <div className="hub-info">
              <h2>{user?.username} <span className="rank-badge">RANK {user?.rank}</span></h2>
              <p>Win Rate: {user?.winRate.toFixed(1)}% | Wins: {user?.wins}</p>
            </div>
          </div>
          <div className="hub-actions">
            <button className="nav-btn" onClick={fetchLeaderboard}>Leaderboard</button>
            <button className="nav-btn logout" onClick={handleLogout}>Logout</button>
          </div>
        </div>

        {banTimeLeft > 0 && (
          <motion.div initial={{ y: -50 }} animate={{ y: 0 }} className="ban-banner">
            SUSPENDED: MATCHMAKING BLOCKED FOR {Math.floor(banTimeLeft / 60)}:{(banTimeLeft % 60).toString().padStart(2, '0')}
          </motion.div>
        )}

        <AnimatePresence>
          {showLeaderboard ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="hub-modal">
              <div className="leaderboard-content">
                <h2>GLOBAL RANKINGS</h2>
                <div className="leaderboard-list">
                  {leaderboard.map((entry, i) => (
                    <div key={i} className={`leader-item ${entry.username === user?.username ? 'me' : ''}`}>
                      <span className="rank">#{i+1}</span>
                      <span className="name">{entry.username}</span>
                      <span className="score">{entry.rank} ELO</span>
                    </div>
                  ))}
                </div>
                <button className="lobby-button secondary" onClick={() => setShowLeaderboard(false)}>Back to Hub</button>
              </div>
            </motion.div>
          ) : (
            <div className="hub-main">
              <div className="matchmaking-cards">
                <div className={`mm-card ${banTimeLeft > 0 ? 'disabled' : ''}`} onClick={joinRandom}>
                  <div className="mm-icon">⚡</div>
                  <h3>QUICK MATCH</h3>
                  <p>Join the competitive queue</p>
                </div>
                <div className={`mm-card secondary ${banTimeLeft > 0 ? 'disabled' : ''}`} onClick={createPrivate}>
                  <div className="mm-icon">🛡️</div>
                  <h3>PRIVATE BATTLE</h3>
                  <p>Challenge a rival directly</p>
                </div>
              </div>

              <div className="watch-section">
                <div className="separator">SPECTATE MATCH</div>
                <div className="watch-controls">
                  <input 
                    type="text" 
                    placeholder="ENTER ROOM CODE" 
                    value={joinCode} 
                    onChange={e => setJoinCode(e.target.value.toUpperCase())}
                    className="code-input"
                  />
                  <div className="watch-buttons">
                    <button className="lobby-button join" onClick={joinPrivate}>Join</button>
                    <button className="lobby-button watch" onClick={watchGame}>Spectate</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  if (status === 'waiting') {
    return (
      <div className="container">
        <div className="waiting-arena">
          <div className="arena-loader">
            <div className="scan-line"></div>
            <h1 className="title">SCANNING FOR RIVALS...</h1>
          </div>
          {privateRoomCode && (
            <div className="room-info">
              <p>BATTLE CODE: <span className="highlight">{privateRoomCode}</span></p>
              <p className="subtext">Awaiting challenger to enter the code...</p>
            </div>
          )}
          <button className="reset-button" onClick={() => socket?.emit('cancel_matchmaking', { roomId: privateRoomCode })}>Abort Mission</button>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="container">
        <h1 className="title">COMM-LINK FAILURE</h1>
        <p className="error-msg">{errorMessage}</p>
        <button className="reset-button" onClick={backToHub}>Return to Hub</button>
      </div>
    );
  }

  const isMyTurn = (gameState.mySymbol === 'X' && gameState.isXNext) || (gameState.mySymbol === 'O' && !gameState.isXNext);

  return (
    <div className="container game-arena">
      <div className="arena-main">
        <div className="arena-header">
          <div className="match-id">ROOM: {gameState.roomId?.replace('room_', '')}</div>
          <button className="exit-match-btn" onClick={exitMatch}>
            {status === 'spectating' ? 'LEAVE' : 'SURRENDER'}
          </button>
        </div>

        <div className="players-hud">
          <div className={`hud-player x ${gameState.isXNext ? 'active' : ''}`}>
            <div className="hud-symbol">X</div>
            <div className="hud-name">{gameState.mySymbol === 'X' ? 'YOU' : (gameState.opponent?.split(' vs ')[0] || gameState.opponent)}</div>
          </div>
          <div className="hud-vs">VS</div>
          <div className={`hud-player o ${!gameState.isXNext ? 'active' : ''}`}>
            <div className="hud-symbol">O</div>
            <div className="hud-name">{gameState.mySymbol === 'O' ? 'YOU' : (gameState.opponent?.split(' vs ')[1] || gameState.opponent)}</div>
          </div>
        </div>

        {opponentDisconnected && !gameState.winner && (
          <div className="discon-alert">OPPONENT DISCONNECTED... WAITING 30S</div>
        )}

        <div className="board">
          {gameState.board.map((value, i) => (
            <button
              key={i}
              className={`square ${value ? value.toLowerCase() : ''} ${gameState.winningLine?.includes(i) ? 'winner' : ''}`}
              onClick={() => handleClick(i)}
              disabled={!isMyTurn || !!value || !!gameState.winner || status === 'spectating'}
            >
              {value}
            </button>
          ))}
        </div>

        <div className="arena-status">
          {gameState.winner ? (
            <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1 }} className="winner-tag">
              {gameState.winner === 'Draw' ? 'STALEMATE' : `${gameState.winner} DOMINATED`}
            </motion.div>
          ) : (
            <div className={`turn-tag ${isMyTurn ? 'my-turn' : ''}`}>
              {status === 'spectating' ? (gameState.isXNext ? "X's TURN" : "O's TURN") : (isMyTurn ? 'YOUR TURN' : "WAITING FOR RIVAL...")}
            </div>
          )}
        </div>

        <AnimatePresence>
          {gameState.winner && status !== 'spectating' && (
            <div className="rematch-box">
              {!votedRematch ? (
                <button className="lobby-button rematch" onClick={voteRematch}>REQUEST REMATCH</button>
              ) : (
                <div className="rematch-status">
                  {opponentRematch ? "REMATCH ACCEPTED" : "AWAITING RIVAL'S DECISION..."}
                </div>
              )}
            </div>
          )}
        </AnimatePresence>
      </div>

      <div className="arena-sidebar">
        <div className="chat-box">
          <div className="chat-header">COMM-LINK</div>
          <div className="chat-feed">
            {gameState.chat.map((msg, i) => (
              <div key={i} className={`chat-line ${msg.username === user?.username ? 'me' : ''}`}>
                <span className="line-user">{msg.username}:</span>
                <span className="line-text">{msg.text}</span>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          {status !== 'spectating' && (
            <form className="chat-form" onSubmit={sendChat}>
              <input type="text" placeholder="TRANSMIT MESSAGE..." value={chatInput} onChange={e => setChatInput(e.target.value)} />
              <button type="submit">SEND</button>
            </form>
          )}
        </div>
      </div>

      <AnimatePresence>
        {surrenderWarning && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="modal-overlay">
            <div className="warning-modal">
              <h2>SURRENDER WARNING</h2>
              <p>Abandoning a live match will result in a **RANK PENALTY (-20 ELO)** and a temporary matchmaking **BAN**.</p>
              <div className="modal-buttons">
                <button className="lobby-button surrender-confirm" onClick={confirmSurrender}>CONFIRM FORFEIT</button>
                <button className="lobby-button secondary" onClick={() => setSurrenderWarning(false)}>RETURN TO BATTLE</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
