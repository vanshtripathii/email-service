const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Cart = require('../models/Cart');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// Rate limit for login
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: 'Too many login attempts, try again later.' },
  skipSuccessfulRequests: true
});

router.use('/login', authLimiter);

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "7d" });
};

// =============================
//        REGISTER USER
// =============================
router.post('/register', async (req, res) => {
  try {
    console.log("Registration Request:", req.body);

    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        message: "Please provide name, email, and password"
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists with this email" });
    }

    const user = new User({ name, email, password });
    await user.save();

// Auto-create cart
try {
  const cart = new Cart({
    userId: user._id,
    items: [],
    subtotal: 0,
    shipping: 0,
    tax: 0,
    total: 0
  });
  
  // Validate the cart before saving
  await cart.validate();
  await cart.save();
  console.log(`Cart created for new user: ${user._id}`);
  
} catch (err) {
  console.error("Cart creation failed:", err);
  // Don't fail registration if cart creation fails
  if (err.name === 'ValidationError') {
    console.log('Cart validation error details:', err.errors);
  }
}

  } catch (error) {
    console.error("Registration Error:", error);

    if (error.code === 11000) {
      return res.status(400).json({ message: "Email already exists" });
    }

    res.status(500).json({ message: "Server error during registration" });
  }
});

// =============================
//           LOGIN USER
// =============================
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ message: "Please provide email and password" });

    const user = await User.findOne({ email }).select("+password");
    if (!user)
      return res.status(400).json({ message: "Invalid credentials" });

    const isPasswordValid = await user.correctPassword(password);
    if (!isPasswordValid)
      return res.status(400).json({ message: "Invalid credentials" });

    // Ensure cart exists
    try {
      let cart = await Cart.findOne({ userId: user._id });
      if (!cart) {
        cart = new Cart({
          userId: user._id,
          items: [],
          subtotal: 0,
          shipping: 0,
          tax: 0,
          total: 0
        });
        await cart.save();
      }
    } catch (err) {
      console.error("Cart check error:", err);
    }

    const token = generateToken(user._id);

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });

  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ message: "Server error during login" });
  }
});

// =============================
//       VERIFY TOKEN
// =============================
router.get('/verify', async (req, res) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");

    if (!token)
      return res.status(401).json({ message: "No token provided" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user)
      return res.status(401).json({ message: "Invalid token" });

    // Ensure cart exists
    try {
      let cart = await Cart.findOne({ userId: user._id });
      if (!cart) {
        cart = new Cart({
          userId: user._id,
          items: [],
          subtotal: 0,
          shipping: 0,
          tax: 0,
          total: 0
        });
        await cart.save();
      }
    } catch (err) {
      console.error("Cart create during verify error:", err);
    }

    res.json({
      id: user._id,
      name: user.name,
      email: user.email
    });

  } catch (error) {
    console.error("Verify Token Error:", error);

    if (error.name === "TokenExpiredError")
      return res.status(401).json({ message: "Token has expired" });

    if (error.name === "JsonWebTokenError")
      return res.status(401).json({ message: "Invalid token" });

    res.status(500).json({ message: "Server error verifying token" });
  }
});

module.exports = router;
