const express = require('express');
const router = express.Router();
const Payment = require('../models/Payment');
const Product = require('../models/Product');
const { auth } = require('../middleware/auth');

// Middleware to check if user is admin
const adminAuth = async (req, res, next) => {
  try {
    // Add your admin check logic here
    // For now, we'll assume all authenticated users are admins
    // In production, implement proper role-based auth
    if (!req.user) {
      return res.status(401).json({ message: 'Admin access required' });
    }
    next();
  } catch (error) {
    res.status(401).json({ message: 'Admin authentication failed' });
  }
};

// Get all pending payments for admin
router.get('/pending', auth, adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const payments = await Payment.find({ status: 'pending' })
      .populate('productId', 'name price images')
      .populate('userId', 'name email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Payment.countDocuments({ status: 'pending' });

    res.json({
      payments,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      total
    });

  } catch (error) {
    console.error('Admin get pending payments error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Verify a payment (mark as successful)
router.post('/verify/:orderId', auth, adminAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { adminNotes } = req.body;
    const adminId = req.user.id;

    const payment = await Payment.findOne({ orderId })
      .populate('productId');
    
    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    if (payment.status !== 'pending') {
      return res.status(400).json({ 
        message: `Payment is already ${payment.status}` 
      });
    }

    const session = await Payment.startSession();
    session.startTransaction();

    try {
      // Update payment status
      payment.status = 'verified';
      payment.verifiedBy = adminId;
      payment.verifiedAt = new Date();
      payment.adminNotes = adminNotes;
      await payment.save({ session });

      // Mark product as sold
      await Product.findByIdAndUpdate(
        payment.productId,
        {
          inventoryStatus: 'sold',
          reservedUntil: null,
          reservationId: null
        },
        { session }
      );

      await session.commitTransaction();

      // TODO: Send confirmation email to customer
      console.log(`Payment verified for order ${orderId}`);

      res.json({
        success: true,
        message: 'Payment verified successfully',
        orderId
      });

    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }

  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ message: 'Server error during verification' });
  }
});

// Reject a payment (mark as failed)
router.post('/reject/:orderId', auth, adminAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { adminNotes } = req.body;

    const payment = await Payment.findOne({ orderId });
    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    if (payment.status !== 'pending') {
      return res.status(400).json({ 
        message: `Payment is already ${payment.status}` 
      });
    }

    const session = await Payment.startSession();
    session.startTransaction();

    try {
      // Update payment status
      payment.status = 'failed';
      payment.adminNotes = adminNotes;
      await payment.save({ session });

      // Release the product back to available
      await Product.findByIdAndUpdate(
        payment.productId,
        {
          inventoryStatus: 'available',
          reservedUntil: null,
          reservationId: null
        },
        { session }
      );

      await session.commitTransaction();

      // TODO: Send rejection email to customer
      console.log(`Payment rejected for order ${orderId}`);

      res.json({
        success: true,
        message: 'Payment rejected and product released',
        orderId
      });

    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }

  } catch (error) {
    console.error('Payment rejection error:', error);
    res.status(500).json({ message: 'Server error during rejection' });
  }
});

// Get all payments with filtering
router.get('/all', auth, adminAuth, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      status, 
      paymentMethod,
      startDate,
      endDate 
    } = req.query;

    const filter = {};
    
    if (status && status !== 'all') {
      filter.status = status;
    }
    
    if (paymentMethod && paymentMethod !== 'all') {
      filter.paymentMethod = paymentMethod;
    }
    
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const payments = await Payment.find(filter)
      .populate('productId', 'name price images')
      .populate('userId', 'name email')
      .populate('verifiedBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Payment.countDocuments(filter);

    res.json({
      payments,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      total
    });

  } catch (error) {
    console.error('Admin get all payments error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get payment statistics for admin dashboard
router.get('/stats', auth, adminAuth, async (req, res) => {
  try {
    const totalPending = await Payment.countDocuments({ status: 'pending' });
    const totalVerified = await Payment.countDocuments({ status: 'verified' });
    const totalFailed = await Payment.countDocuments({ status: 'failed' });
    const totalExpired = await Payment.countDocuments({ status: 'expired' });

    // Revenue from verified payments
    const revenueResult = await Payment.aggregate([
      { $match: { status: 'verified' } },
      { $group: { _id: null, totalRevenue: { $sum: '$amount' } } }
    ]);
    const totalRevenue = revenueResult.length > 0 ? revenueResult[0].totalRevenue : 0;

    // Recent payments (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentPayments = await Payment.countDocuments({
      createdAt: { $gte: sevenDaysAgo }
    });

    // Payment method distribution
    const methodStats = await Payment.aggregate([
      {
        $group: {
          _id: '$paymentMethod',
          count: { $sum: 1 },
          amount: { $sum: '$amount' }
        }
      }
    ]);

    res.json({
      summary: {
        pending: totalPending,
        verified: totalVerified,
        failed: totalFailed,
        expired: totalExpired,
        total: totalPending + totalVerified + totalFailed + totalExpired
      },
      revenue: totalRevenue,
      recentPayments,
      methodStats
    });

  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;