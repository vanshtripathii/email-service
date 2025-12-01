const express = require('express');
const mongoose = require('mongoose');
const { auth } = require('../middleware/auth');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Cart = require('../models/Cart');

const router = express.Router();

// Constants
const RESERVATION_DURATION = 15 * 60 * 1000; // 15 minutes
const UPI_ID = process.env.UPI_ID || 'yourbrand@upi';
const UPI_QR_CODE = process.env.UPI_QR_CODE || 'https://example.com/upi-qr.jpg';

// Middleware to check product availability
const checkProductAvailability = async (req, res, next) => {
  try {
    const { productId } = req.body;
    
    const product = await Product.findOne({
      $or: [
        { _id: productId },
        { productId: productId }
      ]
    });

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    if (product.inventoryStatus === 'sold') {
      return res.status(410).json({ message: 'Product is already sold' });
    }

    if (product.inventoryStatus === 'reserved') {
      const timeLeft = product.reservedUntil - new Date();
      if (timeLeft > 0) {
        return res.status(409).json({ 
          message: 'Product is currently reserved', 
          timeLeft: Math.ceil(timeLeft / 1000),
          reservedUntil: product.reservedUntil 
        });
      }
    }

    req.product = product;
    next();
  } catch (error) {
    console.error('Availability check error:', error);
    res.status(500).json({ message: 'Server error during availability check' });
  }
};

// BUY NOW - Single product checkout
router.post('/buy-now', auth, checkProductAvailability, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { productId } = req.body;
    const {
      fullName, email, phoneNumber, addressLine1, addressLine2, 
      city, state, pincode
    } = req.body;

    // Validate required fields
    if (!fullName || !email || !phoneNumber || !addressLine1 || !city || !state || !pincode) {
      await session.abortTransaction();
      return res.status(400).json({ 
        message: 'All address fields are required',
        required: ['fullName', 'email', 'phoneNumber', 'addressLine1', 'city', 'state', 'pincode']
      });
    }

    const product = req.product;
    const reservationId = `res_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const reservationExpiresAt = new Date(Date.now() + RESERVATION_DURATION);

    // Reserve the product
    product.inventoryStatus = 'reserved';
    product.reservedUntil = reservationExpiresAt;
    product.reservationId = reservationId;
    await product.save({ session });

    // Create order
    const order = new Order({
      orderId: `ORD_${Date.now()}_${Math.random().toString(36).substr(2, 5).toUpperCase()}`,
      user: req.user.id,
      items: [{
        product: product._id,
        productId: product.productId,
        name: product.name,
        price: product.price,
        quantity: 1
      }],
      totalAmount: product.price,
      status: 'reserved',
      customerInfo: {
        fullName,
        email,
        phoneNumber,
        addressLine1,
        addressLine2,
        city,
        state,
        pincode
      },
      paymentInfo: {
        upiId: UPI_ID,
        upiQrCode: UPI_QR_CODE,
        paymentStatus: 'pending'
      },
      reservationExpiresAt,
      reservationId
    });

    await order.save({ session });
    await session.commitTransaction();

    res.status(201).json({
      success: true,
      message: 'Product reserved for 15 minutes. Complete payment via UPI.',
      order: {
        id: order._id,
        orderId: order.orderId,
        totalAmount: order.totalAmount,
        reservationExpiresAt: order.reservationExpiresAt,
        timeLeft: RESERVATION_DURATION / 1000
      },
      payment: {
        upiId: UPI_ID,
        upiQrCode: UPI_QR_CODE,
        instructions: `Pay ₹${order.totalAmount} to ${UPI_ID} and confirm payment`
      },
      product: {
        id: product._id,
        name: product.name,
        price: product.price
      }
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Buy Now error:', error);
    res.status(500).json({ message: 'Failed to process Buy Now order' });
  } finally {
    session.endSession();
  }
});

// CART CHECKOUT - Multiple products
router.post('/cart', auth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      fullName, email, phoneNumber, addressLine1, addressLine2, 
      city, state, pincode
    } = req.body;

    // Validate required fields
    if (!fullName || !email || !phoneNumber || !addressLine1 || !city || !state || !pincode) {
      await session.abortTransaction();
      return res.status(400).json({ 
        message: 'All address fields are required' 
      });
    }

    // Get user's cart
    const cart = await Cart.findOne({ userId: req.user.id }).session(session);
    if (!cart || cart.items.length === 0) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Cart is empty' });
    }

    const reservationId = `res_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const reservationExpiresAt = new Date(Date.now() + RESERVATION_DURATION);
    let totalAmount = 0;
    const orderItems = [];

    // Check availability and reserve each product
    for (const cartItem of cart.items) {
      const product = await Product.findOne({
        $or: [
          { _id: cartItem.productId },
          { productId: cartItem.productId }
        ]
      }).session(session);

      if (!product) {
        await session.abortTransaction();
        return res.status(404).json({ 
          message: `Product "${cartItem.name}" not found` 
        });
      }

      if (product.inventoryStatus !== 'available') {
        await session.abortTransaction();
        return res.status(409).json({ 
          message: `Product "${product.name}" is not available`,
          productId: product.productId,
          status: product.inventoryStatus
        });
      }

      // Reserve the product
      product.inventoryStatus = 'reserved';
      product.reservedUntil = reservationExpiresAt;
      product.reservationId = reservationId;
      await product.save({ session });

      orderItems.push({
        product: product._id,
        productId: product.productId,
        name: product.name,
        price: product.price,
        quantity: 1
      });

      totalAmount += product.price;
    }

    // Create order
    const order = new Order({
      orderId: `ORD_${Date.now()}_${Math.random().toString(36).substr(2, 5).toUpperCase()}`,
      user: req.user.id,
      items: orderItems,
      totalAmount,
      status: 'reserved',
      customerInfo: {
        fullName,
        email,
        phoneNumber,
        addressLine1,
        addressLine2,
        city,
        state,
        pincode
      },
      paymentInfo: {
        upiId: UPI_ID,
        upiQrCode: UPI_QR_CODE,
        paymentStatus: 'pending'
      },
      reservationExpiresAt,
      reservationId
    });

    await order.save({ session });

    // Clear cart after successful reservation
    cart.items = [];
    cart.subtotal = 0;
    cart.shipping = 0;
    cart.tax = 0;
    cart.total = 0;
    await cart.save({ session });

    await session.commitTransaction();

    res.status(201).json({
      success: true,
      message: `${orderItems.length} product(s) reserved for 15 minutes. Complete payment via UPI.`,
      order: {
        id: order._id,
        orderId: order.orderId,
        totalAmount: order.totalAmount,
        itemCount: orderItems.length,
        reservationExpiresAt: order.reservationExpiresAt,
        timeLeft: RESERVATION_DURATION / 1000
      },
      payment: {
        upiId: UPI_ID,
        upiQrCode: UPI_QR_CODE,
        instructions: `Pay ₹${order.totalAmount} to ${UPI_ID} and confirm payment`
      }
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Cart checkout error:', error);
    res.status(500).json({ message: 'Failed to process cart checkout' });
  } finally {
    session.endSession();
  }
});

// Get UPI Payment Details
router.get('/upi-details/:orderId', auth, async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findOne({ 
      _id: orderId, 
      user: req.user.id 
    });

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.status !== 'reserved') {
      return res.status(400).json({ 
        message: 'Order is not in reserved state',
        currentStatus: order.status
      });
    }

    res.json({
      upiId: order.paymentInfo.upiId,
      upiQrCode: order.paymentInfo.upiQrCode,
      amount: order.totalAmount,
      orderId: order.orderId,
      timeLeft: Math.max(0, order.reservationExpiresAt - new Date()) / 1000
    });

  } catch (error) {
    console.error('Get UPI details error:', error);
    res.status(500).json({ message: 'Failed to get UPI details' });
  }
});

// Confirm Payment (Manual UPI Payment)
router.post('/confirm-payment', auth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { orderId, transactionId } = req.body;

    if (!transactionId) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Transaction ID is required' });
    }

    const order = await Order.findOne({ 
      _id: orderId, 
      user: req.user.id,
      status: 'reserved'
    }).session(session);

    if (!order) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Valid reserved order not found' });
    }

    // Check if reservation expired
    if (new Date() > order.reservationExpiresAt) {
      await session.abortTransaction();
      return res.status(410).json({ 
        message: 'Reservation expired. Please place a new order.',
        status: 'expired'
      });
    }

    // Update order status to SOLD
    order.status = 'sold';
    order.paymentInfo.paymentStatus = 'completed';
    order.paymentInfo.transactionId = transactionId;
    order.paymentInfo.paidAt = new Date();
    await order.save({ session });

    // Update all products in the order to SOLD
    for (const item of order.items) {
      await Product.updateOne(
        { _id: item.product },
        { 
          $set: { 
            inventoryStatus: 'sold',
            reservedUntil: null,
            reservationId: null
          }
        },
        { session }
      );
    }

    await session.commitTransaction();

    res.json({
      success: true,
      message: 'Payment confirmed successfully! Your order is confirmed.',
      order: {
        id: order._id,
        orderId: order.orderId,
        status: order.status,
        totalAmount: order.totalAmount
      },
      products: order.items.map(item => ({
        name: item.name,
        status: 'sold'
      }))
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Payment confirmation error:', error);
    res.status(500).json({ message: 'Failed to confirm payment' });
  } finally {
    session.endSession();
  }
});

// Get Order Status
router.get('/order/:orderId', auth, async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findOne({ 
      _id: orderId, 
      user: req.user.id 
    }).populate('items.product', 'name images');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const timeLeft = Math.max(0, order.reservationExpiresAt - new Date()) / 1000;

    res.json({
      order: {
        id: order._id,
        orderId: order.orderId,
        status: order.status,
        totalAmount: order.totalAmount,
        reservationExpiresAt: order.reservationExpiresAt,
        timeLeft: timeLeft,
        customerInfo: order.customerInfo,
        items: order.items,
        paymentInfo: {
          paymentStatus: order.paymentInfo.paymentStatus,
          upiId: order.paymentInfo.upiId,
          transactionId: order.paymentInfo.transactionId
        }
      }
    });

  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ message: 'Failed to get order details' });
  }
});

// Cancel Reservation
router.post('/cancel/:orderId', auth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { orderId } = req.params;

    const order = await Order.findOne({ 
      _id: orderId, 
      user: req.user.id,
      status: 'reserved'
    }).session(session);

    if (!order) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Reserved order not found' });
    }

    // Release all products
    for (const item of order.items) {
      await Product.updateOne(
        { _id: item.product },
        { 
          $set: { 
            inventoryStatus: 'available',
            reservedUntil: null,
            reservationId: null
          }
        },
        { session }
      );
    }

    // Update order status
    order.status = 'cancelled';
    order.paymentInfo.paymentStatus = 'expired';
    await order.save({ session });

    await session.commitTransaction();

    res.json({
      success: true,
      message: 'Reservation cancelled successfully',
      orderId: order.orderId
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Cancel reservation error:', error);
    res.status(500).json({ message: 'Failed to cancel reservation' });
  } finally {
    session.endSession();
  }
});

module.exports = router;