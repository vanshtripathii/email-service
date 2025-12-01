const express = require('express');
const { auth } = require('../middleware/auth');
const Payment = require('../models/Payment');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const mongoose = require('mongoose');

const router = express.Router();

// Reserve product for payment (5-minute window)
router.post('/reserve', auth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { productId } = req.body;
    
    // Find the product
    const product = await Product.findById(productId).session(session);
    
    if (!product) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Product not found' });
    }
    
    // Check if product is available
    if (product.inventoryStatus !== 'available') {
      await session.abortTransaction();
      
      if (product.inventoryStatus === 'reserved') {
        const timeLeft = Math.max(0, product.reservedUntil - new Date());
        return res.status(409).json({ 
          message: 'Product is currently reserved by another user',
          timeLeft: Math.ceil(timeLeft / 1000), // seconds
          reservedUntil: product.reservedUntil
        });
      } else {
        return res.status(410).json({ 
          message: 'Product is already sold out',
          status: 'sold_out'
        });
      }
    }
    
    // Reserve the product for 5 minutes
    const reservationId = `res_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const reservedUntil = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    
    product.inventoryStatus = 'reserved';
    product.reservedUntil = reservedUntil;
    product.reservationId = reservationId;
    
    await product.save({ session });
    await session.commitTransaction();
    
    res.json({
      success: true,
      reservationId,
      reservedUntil,
      message: 'Product reserved for 5 minutes. Complete payment within this time.',
      timeLeft: 5 * 60 // 5 minutes in seconds
    });
    
  } catch (error) {
    await session.abortTransaction();
    console.error('Reservation error:', error);
    res.status(500).json({ message: 'Reservation failed' });
  } finally {
    session.endSession();
  }
});

// Create payment intent with inventory lock
router.post('/create', auth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { productId, reservationId } = req.body;

    // Verify reservation is still valid
    const product = await Product.findOne({
      _id: productId,
      reservationId,
      inventoryStatus: 'reserved',
      reservedUntil: { $gt: new Date() }
    }).session(session);

    if (!product) {
      await session.abortTransaction();
      return res.status(410).json({ 
        message: 'Reservation expired or invalid. Please try again.',
        status: 'reservation_expired'
      });
    }

    // Create order for single piece
    const order = new Order({
      user: req.user.id,
      items: [{
        product: productId,
        quantity: 1,
        price: product.price,
        name: product.name
      }],
      totalAmount: product.price,
      status: 'pending_payment',
      shippingAddress: req.body.shippingAddress || {}
    });

    await order.save({ session });

    // Create payment record
    const payment = new Payment({
      userId: req.user.id,
      orderId: order._id,
      amount: product.price,
      currency: 'USD',
      paymentMethod: 'card',
      status: 'pending',
      reservationId: reservationId,
      paymentDetails: {
        productId: productId,
        productName: product.name
      }
    });

    await payment.save({ session });
    await session.commitTransaction();

    // Simulate payment gateway (replace with Stripe/Razorpay)
    const paymentIntent = {
      id: payment._id,
      clientSecret: `pi_${Math.random().toString(36).substr(2, 14)}_secret_${Math.random().toString(36).substr(2, 20)}`,
      amount: payment.amount,
      currency: payment.currency,
      status: 'requires_payment_method'
    };

    res.json({
      paymentIntent,
      order: {
        id: order._id,
        amount: order.totalAmount,
        product: product.name
      },
      reservationValidUntil: product.reservedUntil
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Payment creation error:', error);
    res.status(500).json({ message: 'Payment creation failed' });
  } finally {
    session.endSession();
  }
});

// Confirm payment and finalize sale
router.post('/confirm', auth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { paymentIntentId, reservationId } = req.body;

    // Find payment and verify reservation
    const payment = await Payment.findOne({
      _id: paymentIntentId,
      userId: req.user.id,
      status: 'pending'
    }).session(session);

    if (!payment) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Payment not found' });
    }

    const product = await Product.findOne({
      _id: payment.paymentDetails.productId,
      reservationId: reservationId,
      inventoryStatus: 'reserved'
    }).session(session);

    if (!product) {
      await session.abortTransaction();
      return res.status(410).json({ 
        message: 'Product reservation lost. Item may have been sold to another user.',
        status: 'sold_out'
      });
    }

    // Simulate payment processing (90% success rate)
    const isPaymentSuccessful = Math.random() > 0.1;

    if (isPaymentSuccessful) {
      // Mark product as SOLD
      product.inventoryStatus = 'sold';
      product.reservedUntil = null;
      product.reservationId = null;
      await product.save({ session });

      // Update payment status
      payment.status = 'completed';
      payment.transactionId = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      payment.paymentDetails.confirmedAt = new Date();
      await payment.save({ session });

      // Update order status
      const order = await Order.findById(payment.orderId).session(session);
      order.status = 'confirmed';
      order.paymentStatus = 'paid';
      await order.save({ session });

      await session.commitTransaction();

      res.json({
        success: true,
        message: 'Payment confirmed successfully! This exclusive piece is now yours.',
        payment: {
          id: payment._id,
          status: payment.status,
          transactionId: payment.transactionId,
          amount: payment.amount
        },
        order: {
          id: order._id,
          status: order.status
        },
        product: {
          id: product._id,
          name: product.name,
          status: 'sold_to_you'
        }
      });

    } else {
      // Payment failed - release reservation
      product.inventoryStatus = 'available';
      product.reservedUntil = null;
      product.reservationId = null;
      await product.save({ session });

      payment.status = 'failed';
      payment.paymentDetails.failureReason = 'Payment was declined';
      await payment.save({ session });

      await session.commitTransaction();

      res.status(400).json({
        success: false,
        message: 'Payment failed. Reservation released. Please try again if still available.',
        status: 'payment_failed'
      });
    }

  } catch (error) {
    await session.abortTransaction();
    console.error('Payment confirmation error:', error);
    res.status(500).json({ message: 'Payment confirmation failed' });
  } finally {
    session.endSession();
  }
});

// Release reservation (if user cancels)
router.post('/release', auth, async (req, res) => {
  try {
    const { reservationId } = req.body;
    
    const product = await Product.findOne({
      reservationId,
      inventoryStatus: 'reserved'
    });
    
    if (product) {
      product.inventoryStatus = 'available';
      product.reservedUntil = null;
      product.reservationId = null;
      await product.save();
      
      res.json({ 
        success: true, 
        message: 'Reservation released' 
      });
    } else {
      res.status(404).json({ 
        success: false, 
        message: 'Reservation not found' 
      });
    }
    
  } catch (error) {
    console.error('Reservation release error:', error);
    res.status(500).json({ message: 'Failed to release reservation' });
  }
});


// Get payment status
router.get('/:orderId', auth, async (req, res) => {
  try {
    const { orderId } = req.params;

    const payment = await Payment.findOne({ 
      orderId,
      userId: req.user.id 
    }).populate('orderId');

    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    res.json({
      payment: {
        id: payment._id,
        orderId: payment.orderId._id,
        amount: payment.amount,
        status: payment.status,
        reservationId: payment.reservationId,
        createdAt: payment.createdAt
      }
    });

  } catch (error) {
    console.error('Get payment status error:', error);
    res.status(500).json({ message: 'Failed to get payment status' });
  }
});

// Cleanup expired reservations (run this periodically)
router.post('/cleanup-expired', async (req, res) => {
  try {
    const result = await Product.updateMany(
      {
        inventoryStatus: 'reserved',
        reservedUntil: { $lt: new Date() }
      },
      {
        $set: {
          inventoryStatus: 'available',
          reservedUntil: null,
          reservationId: null
        }
      }
    );
    
    res.json({
      message: `Released ${result.modifiedCount} expired reservations`,
      released: result.modifiedCount
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({ message: 'Cleanup failed' });
  }
});

module.exports = router;
