const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true,
    lowercase: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
  },
  isVerified: {
    type: Boolean,
    default: false,
  },
  otp: String,
  otpExpiry: Date,
  wins: {
    type: Number,
    default: 0,
    index: -1,
  },
  losses: {
    type: Number,
    default: 0,
  },
  draws: {
    type: Number,
    default: 0,
  },
  winRate: {
    type: Number,
    default: 0,
    index: -1,
  },
  rank: {
    type: Number,
    default: 1000, // ELO starting point
    index: -1,
  },
  penaltyCount: {
    type: Number,
    default: 0,
  },
  banUntil: {
    type: Date,
    default: null,
  },
  activeMatchId: {
    type: String,
    default: null,
  }
});

module.exports = mongoose.model('User', UserSchema);
