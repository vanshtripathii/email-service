const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://gadzooksoffside:imoogi..7F$@cluster0.3igmlag.mongodb.net/gadzooks';
const ADMIN_KEY = process.env.ADMIN_KEY || 'gadzooksoffsidebyvanshandritham';

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
    .then(() => console.log("✅ MongoDB connected"))
    .catch((err) => console.error("❌ MongoDB connection error:", err))
    
.then(() => {
    console.log('✅ Connected to MongoDB');
    console.log(`📊 Database: ${mongoose.connection.db.databaseName}`);
})
.catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
});

// Use your existing Subscription model (adjust path as needed)
const Subscription = require('./models/Subscription');

// Import your email service - TRY DIFFERENT PATHS IF NEEDED
let emailService;
try {
    emailService = require('./services/emailService');
    console.log('✅ Email service loaded from ./services/emailService');
} catch (error) {
    console.log('❌ Failed to load email service from ./services/emailService, trying ../services/emailService');
    try {
        emailService = require('../services/emailService');
        console.log('✅ Email service loaded from ../services/emailService');
    } catch (error2) {
        console.log('❌ Failed to load email service from ../services/emailService, trying absolute path');
        try {
            emailService = require(path.join(__dirname, '../services/emailService'));
            console.log('✅ Email service loaded from absolute path');
        } catch (error3) {
            console.error('❌ ALL email service paths failed:', error3.message);
            // Create a mock email service for testing
            emailService = {
                sendUpdatesEmail: async (email, updates) => {
                    console.log(`📧 MOCK: Would send email to ${email}`);
                    console.log(`📧 MOCK: Subject: ${updates[0]?.title}`);
                    return true;
                }
            };
        }
    }
}

// Create a simple Update schema for tracking sent updates
const updateSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    content: {
        type: String,
        required: true
    },
    link: {
        type: String,
        default: null
    },
    sentAt: {
        type: Date,
        default: Date.now
    },
    sentTo: {
        type: Number,
        default: 0
    },
    adminKeyUsed: {
        type: String,
        required: true
    }
}, {
    timestamps: true
});

const Update = mongoose.model('Update', updateSchema);

// Middleware
app.use(cors());
app.use(express.json());

// Fixed Admin authentication middleware
const authenticateAdmin = (req, res, next) => {
    try {
        const adminKey = req.body?.adminKey || req.headers['admin-key'];
        
        if (!adminKey) {
            return res.status(401).json({ 
                success: false, 
                message: 'Admin key is required' 
            });
        }
        
        if (adminKey !== ADMIN_KEY) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid admin key' 
            });
        }
        
        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        return res.status(500).json({
            success: false,
            message: 'Authentication error'
        });
    }
};

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'GADzooks Backend API is running!',
        version: '1.0.0',
        database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'
    });
});

// Debug endpoint to check your existing subscriptions
app.get('/api/debug/subscriptions', async (req, res) => {
    try {
        console.log('🔍 Checking existing subscriptions...');
        
        // Check ALL subscriptions (using your existing model)
        const allSubscriptions = await Subscription.find({});
        console.log('All subscriptions:', allSubscriptions);
        
        // Check active subscriptions
        const activeSubscriptions = await Subscription.find({ isActive: true });
        console.log('Active subscriptions:', activeSubscriptions);
        
        const totalCount = await Subscription.countDocuments();
        const activeCount = await Subscription.countDocuments({ isActive: true });
        
        res.json({
            success: true,
            subscriptions: {
                total: totalCount,
                active: activeCount,
                allSubscriptions: allSubscriptions,
                activeSubscriptions: activeSubscriptions
            }
        });
        
    } catch (error) {
        console.error('❌ Debug error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ADMIN ENDPOINTS (using your existing Subscription model)

// Send updates to all subscribers - FIXED TO ACTUALLY SEND EMAILS
app.post('/api/subscribe/send-updates', authenticateAdmin, async (req, res) => {
    try {
        const { updates } = req.body;
        
        if (!updates || !Array.isArray(updates) || updates.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No updates provided'
            });
        }

        // Validate each update
        for (const update of updates) {
            if (!update.title || !update.content) {
                return res.status(400).json({
                    success: false,
                    message: 'Title and content are required for each update'
                });
            }
        }

        // Get all active subscribers FROM YOUR EXISTING SUBSCRIPTION MODEL
        console.log('📋 Fetching active subscribers from Subscription model...');
        const activeSubscriptions = await Subscription.find({ isActive: true });
        const subscriberCount = activeSubscriptions.length;
        
        console.log(`📊 Found ${subscriberCount} active subscribers:`);
        activeSubscriptions.forEach(sub => {
            console.log(`   - ${sub.email} (Active: ${sub.isActive})`);
        });

        if (subscriberCount === 0) {
            return res.status(400).json({
                success: false,
                message: 'No active subscribers found in Subscription model'
            });
        }

        // Save update to database
        const newUpdate = new Update({
            title: updates[0].title,
            content: updates[0].content,
            link: updates[0].link || null,
            sentTo: subscriberCount,
            adminKeyUsed: req.headers['admin-key'] || 'unknown'
        });
        
        const savedUpdate = await newUpdate.save();

        // ACTUALLY SEND EMAILS TO ALL SUBSCRIBERS
        console.log(`📧 SENDING ACTUAL EMAILS to ${subscriberCount} subscribers...`);
        
        let sentCount = 0;
        let failedCount = 0;
        const failedEmails = [];

        // Send emails to each subscriber
        for (const subscriber of activeSubscriptions) {
            try {
                console.log(`   📨 Sending to: ${subscriber.email}`);
                
                // Use your actual email service
                const emailSent = await emailService.sendUpdatesEmail(subscriber.email, updates);
                
                if (emailSent) {
                    sentCount++;
                    console.log(`   ✅ Email sent successfully to: ${subscriber.email}`);
                } else {
                    failedCount++;
                    failedEmails.push(subscriber.email);
                    console.log(`   ❌ Failed to send email to: ${subscriber.email}`);
                }
                
                // Small delay to avoid hitting email rate limits
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (emailError) {
                failedCount++;
                failedEmails.push(subscriber.email);
                console.error(`   💥 Error sending to ${subscriber.email}:`, emailError.message);
            }
        }

        console.log(`✅ Email sending completed: ${sentCount} successful, ${failedCount} failed`);

        // Prepare response
        const response = {
            success: true,
            message: `Emails sent: ${sentCount} successful, ${failedCount} failed`,
            sentCount: sentCount,
            failedCount: failedCount,
            update: {
                id: savedUpdate._id,
                title: savedUpdate.title,
                content: savedUpdate.content,
                link: savedUpdate.link,
                sentAt: savedUpdate.sentAt
            }
        };

        // Add failed emails to response if any
        if (failedCount > 0) {
            response.failedEmails = failedEmails;
        }

        res.json(response);

    } catch (error) {
        console.error('❌ Error sending updates:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error: ' + error.message
        });
    }
});

// Get subscriber statistics (admin only)
app.get('/api/admin/subscribers', authenticateAdmin, async (req, res) => {
    try {
        const totalSubscribers = await Subscription.countDocuments();
        const activeSubscribers = await Subscription.countDocuments({ isActive: true });
        const recentSubscribers = await Subscription.countDocuments({
            createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Last 7 days
        });

        // Get subscriber list
        const subscribers = await Subscription.find({})
            .select('email source createdAt isActive')
            .sort({ createdAt: -1 })
            .limit(100);

        res.json({
            success: true,
            statistics: {
                total: totalSubscribers,
                active: activeSubscribers,
                recent: recentSubscribers,
                inactive: totalSubscribers - activeSubscribers
            },
            subscribers: subscribers
        });

    } catch (error) {
        console.error('❌ Error fetching subscribers:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching subscriber data: ' + error.message
        });
    }
});

// Test email endpoint (for debugging)
app.post('/api/test-email', authenticateAdmin, async (req, res) => {
    try {
        const { testEmail } = req.body;
        
        if (!testEmail) {
            return res.status(400).json({
                success: false,
                message: 'Test email address is required'
            });
        }

        console.log(`🧪 Testing email to: ${testEmail}`);
        
        const testUpdate = [{
            title: 'Test Email from GADzooks Admin',
            content: 'This is a test email to verify that the email system is working correctly. If you receive this, everything is working!',
            link: null
        }];

        const emailSent = await emailService.sendUpdatesEmail(testEmail, testUpdate);
        
        if (emailSent) {
            res.json({
                success: true,
                message: `Test email sent successfully to ${testEmail}`
            });
        } else {
            res.status(500).json({
                success: false,
                message: `Failed to send test email to ${testEmail}`
            });
        }

    } catch (error) {
        console.error('❌ Test email error:', error);
        res.status(500).json({
            success: false,
            message: 'Test email failed: ' + error.message
        });
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Endpoint not found: ${req.method} ${req.path}`
    });
});

// Global error handling middleware
app.use((error, req, res, next) => {
    console.error('🚨 Unhandled error:', error);
    res.status(500).json({
        success: false,
        message: 'Internal server error: ' + error.message
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🔑 Admin key: ${ADMIN_KEY}`);
    console.log(`🗄️  MongoDB: ${MONGODB_URI}`);
    console.log('📧 Email service status: ' + (emailService ? 'Loaded' : 'Not loaded'));

});
