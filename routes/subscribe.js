const express = require('express');
const router = express.Router();
const Subscription = require('../models/Subscription');
const { sendWelcomeEmail } = require('../services/emailService');

// Subscribe endpoint
router.post('/', async (req, res) => {
  try {
    const { email, source = 'website' } = req.body;

    // Validate email
    if (!email || !email.includes('@')) {
      return res.status(400).json({ message: 'Valid email is required' });
    }

    // Check if already subscribed
    const existingSubscription = await Subscription.findOne({ email });
    if (existingSubscription) {
      return res.status(400).json({ message: 'Email already subscribed' });
    }

    // Create subscription
    const subscription = new Subscription({
      email,
      source,
      isActive: true
    });

    await subscription.save();

    // Send welcome email (no discount code)
    const emailSent = await sendWelcomeEmail(email);

    if (emailSent) {
      res.status(201).json({ 
        message: 'Welcome to the cult! Check your email for our welcome message.'
      });
    } else {
      // Still success but notify about email issue
      res.status(201).json({ 
        message: 'Welcome to the cult! However, there was an issue sending the welcome email.'
      });
    }

  } catch (error) {
    console.error('Subscription error:', error);
    res.status(500).json({ message: 'Server error during subscription' });
  }
});

// Get subscription status
router.get('/status', async (req, res) => {
  try {
    const { email } = req.query;
    
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const subscription = await Subscription.findOne({ email });
    
    if (subscription && subscription.isActive) {
      res.json({ hasSubscribed: true });
    } else {
      res.json({ hasSubscribed: false });
    }
  } catch (error) {
    console.error('Subscription status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin route to send updates to all subscribers (protected)
router.post('/send-updates', async (req, res) => {
  try {
    const { updates, adminKey } = req.body;
    
    // Simple admin authentication (use proper auth in production)
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const subscribers = await Subscription.find({ isActive: true });
    let sentCount = 0;
    let failedCount = 0;

    for (const subscriber of subscribers) {
      const emailSent = await sendUpdatesEmail(subscriber.email, updates);
      if (emailSent) {
        sentCount++;
      } else {
        failedCount++;
      }
    }

    res.json({
      message: `Updates sent to ${sentCount} subscribers${failedCount > 0 ? `, ${failedCount} failed` : ''}`
    });

  } catch (error) {
    console.error('Send updates error:', error);
    res.status(500).json({ message: 'Server error sending updates' });
  }
});

module.exports = router;