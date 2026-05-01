const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const mongoose = require("mongoose");
const User = require("../models/User");

// ✅ Enforce JWT secret
if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET must be defined");
}
const JWT_SECRET = process.env.JWT_SECRET;

// Nodemailer setup
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false
    }
});

const generateOTP = () =>
    Math.floor(100000 + Math.random() * 900000).toString();

const calculateWinRate = (user) => {
    const total = user.wins + user.losses + user.draws;
    user.winRate = total > 0 ? (user.wins / total) * 100 : 0;
};

// ================= REGISTER =================
router.post("/register", async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({ message: "All fields required" });
        }

        let user = await User.findOne({ $or: [{ email }, { username }] });
        if (user) {
            return res
                .status(400)
                .json({ message: "User or Email already exists" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const otp = generateOTP();

        user = new User({
            username,
            email,
            password: hashedPassword,
            otp,
            otpExpiry: new Date(Date.now() + 10 * 60 * 1000)
        });

        await user.save();

        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: "Cosmic Tic Tac Toe - Verify Your Account",
            text: `Your OTP is ${otp}. Expires in 10 minutes.`
        });

        res.status(201).json({
            message: "User registered. Check email for OTP."
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});

// ================= VERIFY OTP =================
router.post("/verify-otp", async (req, res) => {
    try {
        const { email, otp } = req.body;

        const user = await User.findOne({ email });

        if (!user) return res.status(404).json({ message: "User not found" });

        if (!user.otp || user.otp !== otp || user.otpExpiry < Date.now()) {
            return res.status(400).json({ message: "Invalid or expired OTP" });
        }

        user.isVerified = true;
        user.otp = undefined;
        user.otpExpiry = undefined;

        await user.save();

        const token = jwt.sign({ userId: user._id }, JWT_SECRET, {
            expiresIn: "7d"
        });

        res.json({
            token,
            user: {
                username: user.username,
                email: user.email,
                rank: user.rank
            }
        });
    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});

// ================= LOGIN =================
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });

        if (!user)
            return res.status(404).json({ message: "Invalid credentials" });
        if (!user.isVerified)
            return res.status(401).json({ message: "Account not verified" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch)
            return res.status(400).json({ message: "Invalid credentials" });

        const token = jwt.sign({ userId: user._id }, JWT_SECRET, {
            expiresIn: "7d"
        });

        res.json({
            token,
            user: {
                username: user.username,
                email: user.email,
                rank: user.rank
            }
        });
    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});

// ================= FORGOT PASSWORD =================
router.post("/forgot-password", async (req, res) => {
    try {
        const { email } = req.body;

        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ message: "User not found" });

        const otp = generateOTP();

        user.otp = otp;
        user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

        await user.save();

        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: "Password Reset OTP",
            text: `Your OTP is ${otp}. Expires in 10 minutes.`
        });

        res.json({ message: "OTP sent to email" });
    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});

// ================= RESET PASSWORD =================
router.post("/reset-password", async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;

        const user = await User.findOne({ email });

        if (!user) return res.status(404).json({ message: "User not found" });

        if (!user.otp || user.otp !== otp || user.otpExpiry < Date.now()) {
            return res.status(400).json({ message: "Invalid or expired OTP" });
        }

        user.password = await bcrypt.hash(newPassword, 10);
        user.otp = undefined;
        user.otpExpiry = undefined;

        await user.save();

        res.json({ message: "Password reset successful" });
    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});

// ================= MATCH RESULT =================
router.post("/match-result", async (req, res) => {
    const session = await mongoose.startSession();

    try {
        const { winnerId, loserId, isDraw } = req.body;

        if (!winnerId || !loserId || winnerId === loserId) {
            return res.status(400).json({ message: "Invalid match data" });
        }

        session.startTransaction();

        const winner = await User.findById(winnerId).session(session);
        const loser = await User.findById(loserId).session(session);

        if (!winner || !loser) {
            throw new Error("User not found");
        }

        // ✅ Match validation
        if (winner.activeMatchId !== loser.activeMatchId) {
            throw new Error("Invalid match pairing");
        }

        // Stats update
        if (isDraw) {
            winner.draws++;
            loser.draws++;
        } else {
            winner.wins++;
            loser.losses++;
        }

        calculateWinRate(winner);
        calculateWinRate(loser);

        // ELO
        const K = 32;
        const expected = (r1, r2) => 1 / (1 + Math.pow(10, (r2 - r1) / 400));

        const wExp = expected(winner.rank, loser.rank);
        const lExp = expected(loser.rank, winner.rank);

        if (isDraw) {
            winner.rank += K * (0.5 - wExp);
            loser.rank += K * (0.5 - lExp);
        } else {
            winner.rank += K * (1 - wExp);
            loser.rank += K * (0 - lExp);
        }

        winner.rank = Math.max(0, Math.round(winner.rank));
        loser.rank = Math.max(0, Math.round(loser.rank));

        // Clear match
        winner.activeMatchId = null;
        loser.activeMatchId = null;

        await winner.save({ session });
        await loser.save({ session });

        await session.commitTransaction();
        session.endSession();

        res.json({
            message: "Match processed",
            winner: { username: winner.username, rank: winner.rank },
            loser: { username: loser.username, rank: loser.rank }
        });
    } catch (err) {
        await session.abortTransaction();
        session.endSession();

        console.error(err);
        res.status(500).json({ message: err.message || "Server error" });
    }
});

module.exports = router;
