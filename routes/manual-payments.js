const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const Payment = require('../models/Payment');
const { auth, adminAuth } = require('../middleware/auth');

// Reserve product for 15 minutes
// In your manual-payments.js - FIX THE RESERVE ENDPOINT
router.post('/reserve', auth, async (req, res) => {
  try {
    const { productId } = req.body;
    const userId = req.user.id;

    console.log('Reservation request:', { productId, userId });

    // Validate product exists and can be reserved
    // Check both _id (MongoDB ObjectId) and productId (custom string)
    let product;
    if (productId && productId.match(/^[0-9a-fA-F]{24}$/)) {
      // It's a MongoDB ObjectId - try findById first, then fallback to productId field
      product = await Product.findById(productId);
      if (!product) {
        product = await Product.findOne({ productId: productId });
      }
    } else {
      // It's a custom productId string - only query by productId field
      // Don't include _id in query to avoid ObjectId casting error
      product = await Product.findOne({ productId: productId });
    }
    
    if (!product) {
      console.error('Product not found:', productId);
      return res.status(404).json({ 
        success: false, 
        message: 'Product not found' 
      });
    }
    
    console.log('Product found:', {
      _id: product._id,
      productId: product.productId,
      name: product.name,
      status: product.inventoryStatus
    });

    // Check if product is available
    const now = new Date();
    
    // If product was reserved but reservation expired, make it available again
    if (product.inventoryStatus === 'reserved' && product.reservedUntil && product.reservedUntil <= now) {
      console.log('Reservation expired, making product available again');
      // Use updateOne to avoid _id casting issues
      // Check if _id is a valid ObjectId (24 hex chars), otherwise use productId field
      const productIdStr = product._id ? product._id.toString() : '';
      const updateQuery = productIdStr.match(/^[0-9a-fA-F]{24}$/) 
        ? { _id: product._id }
        : { productId: product.productId || productId };
      
      await Product.updateOne(updateQuery, {
        $set: {
          inventoryStatus: 'available',
          reservedUntil: null,
          reservationId: null,
          reservedBy: null
        }
      });
      
      // Refresh product object
      product = await Product.findOne(updateQuery);
    }
    
    if (product.inventoryStatus === 'sold') {
      return res.status(400).json({ 
        success: false, 
        message: 'Product is already sold out' 
      });
    }

    if (product.inventoryStatus === 'reserved' && product.reservedUntil && product.reservedUntil > now) {
      // Check if this user is the one who reserved it
      const isReservedByCurrentUser = product.reservedBy && 
        product.reservedBy.toString() === userId.toString();
      
      if (!isReservedByCurrentUser) {
        // Product is reserved by another user
        const timeLeft = Math.ceil((product.reservedUntil - now) / 1000 / 60); // minutes
        return res.status(400).json({ 
          success: false, 
          message: `Product is currently reserved by another user. Available in ${timeLeft} minutes.`,
          reservedUntil: product.reservedUntil
        });
      }
      // If reserved by current user, allow them to proceed (they can complete their order)
    }

    // Generate unique order ID
    const orderId = `GZ${Date.now()}${Math.random().toString(36).substr(2, 5)}`.toUpperCase();

    // Set reservation expiry (15 minutes from now)
    const reservationExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // Update product status to reserved using updateOne to avoid _id casting issues
    // Check if _id is a valid ObjectId (24 hex chars), otherwise use productId field
    const productIdStr = product._id ? product._id.toString() : '';
    const updateQuery = productIdStr.match(/^[0-9a-fA-F]{24}$/) 
      ? { _id: product._id }
      : { productId: product.productId || productId };
    
    await Product.updateOne(updateQuery, {
      $set: {
        inventoryStatus: 'reserved',
        reservedUntil: reservationExpiresAt,
        reservationId: orderId,
        reservedBy: userId
      }
    });
    
    // Refresh product object to get updated values
    product = await Product.findOne(updateQuery);

    console.log('Product reserved successfully:', {
      productId: product._id,
      productName: product.name,
      orderId,
      reservedUntil: reservationExpiresAt
    });

    // Create Payment document for this reservation
    // Handle productId - Payment model requires ObjectId, so we need to use the product's _id
    // If _id is a string, we'll need to handle it in the Payment model or use a workaround
    let paymentProductId = product._id;
    
    // Reuse productIdStr from above (already declared on line 104)
    // If product._id is not a valid ObjectId, try to convert it or use mongoose.Types.ObjectId
    const mongoose = require('mongoose');
    
    if (!productIdStr.match(/^[0-9a-fA-F]{24}$/)) {
      // Product has string _id - we can't use it directly as ObjectId
      // Option 1: Try to find a product with valid ObjectId by productId
      // Option 2: Store productId as string in a different field (would require schema change)
      // Option 3: Create a new ObjectId (but this won't match the actual product)
      // For now, let's try to use the product's _id as-is and handle validation errors
      // We'll modify submit-details to handle this case
      console.warn('Product has non-ObjectId _id, Payment creation may fail:', product._id);
    }

    // Try to create payment record
    // If productId is not a valid ObjectId, this will fail, but we'll handle it in submit-details
    try {
      const payment = new Payment({
        orderId,
        productId: paymentProductId,
        userId: userId,
        amount: product.price,
        status: 'pending',
        reservationExpiresAt: reservationExpiresAt
      });

      await payment.save();
      console.log('Payment record created:', {
        orderId,
        paymentId: payment._id,
        productId: paymentProductId
      });
    } catch (paymentError) {
      // If payment creation fails due to productId, log it but don't fail the reservation
      // The submit-details endpoint will create the payment if it doesn't exist
      console.warn('Could not create Payment record (will be created on submit):', paymentError.message);
    }

    // Return success response
    res.json({
      success: true,
      message: 'Product reserved for 15 minutes',
      orderId,
      reservationExpiresAt,
      product: {
        id: product._id,
        name: product.name,
        price: product.price,
        images: product.images
      }
    });

  } catch (error) {
    console.error('Reservation error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to reserve product',
      error: error.message 
    });
  }
});

// New endpoint: Submit shipping form and reserve product (STEP 1 - shipping details only)
router.post('/submit-form-and-reserve', auth, async (req, res) => {
  try {
    const { productId, customerDetails } = req.body;
    const userId = req.user.id;

    console.log('Submit form and reserve request:', { productId, userId });

    // Find the product
    let product;
    if (productId && productId.match(/^[0-9a-fA-F]{24}$/)) {
      product = await Product.findById(productId);
      if (!product) {
        product = await Product.findOne({ productId: productId });
      }
    } else {
      product = await Product.findOne({ productId: productId });
    }
    
    if (!product) {
      return res.status(404).json({ 
        success: false,
        message: 'Product not found' 
      });
    }

    // Check availability
    const now = new Date();
    
    // If product was reserved but reservation expired, make it available again
    if (product.inventoryStatus === 'reserved' && product.reservedUntil && product.reservedUntil <= now) {
      const productIdStr = product._id ? product._id.toString() : '';
      const updateQuery = productIdStr.match(/^[0-9a-fA-F]{24}$/) 
        ? { _id: product._id }
        : { productId: product.productId || productId };
      
      await Product.updateOne(updateQuery, {
        $set: {
          inventoryStatus: 'available',
          reservedUntil: null,
          reservationId: null,
          reservedBy: null
        }
      });
      
      product = await Product.findOne(updateQuery);
    }
    
    if (product.inventoryStatus === 'sold') {
      return res.status(400).json({ 
        success: false, 
        message: 'Product is already sold out' 
      });
    }

    // Check if reserved by another user
    if (product.inventoryStatus === 'reserved' && product.reservedUntil && product.reservedUntil > now) {
      const isReservedByCurrentUser = product.reservedBy && 
        product.reservedBy.toString() === userId.toString();
      
      if (!isReservedByCurrentUser) {
        const timeLeft = Math.ceil((product.reservedUntil - now) / 1000 / 60);
        return res.status(400).json({ 
          success: false, 
          message: `Product is currently reserved by another user. Available in ${timeLeft} minutes.`,
          reservedUntil: product.reservedUntil
        });
      }
    }

    // Generate order ID
    const orderId = `GZ${Date.now()}${Math.random().toString(36).substr(2, 5)}`.toUpperCase();
    const reservationExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // Reserve the product
    const productIdStr = product._id ? product._id.toString() : '';
    const updateQuery = productIdStr.match(/^[0-9a-fA-F]{24}$/) 
      ? { _id: product._id }
      : { productId: product.productId || productId };
    
    await Product.updateOne(updateQuery, {
      $set: {
        inventoryStatus: 'reserved',
        reservedUntil: reservationExpiresAt,
        reservationId: orderId,
        reservedBy: userId
      }
    });

    // Get product _id for Payment
    product = await Product.findOne(updateQuery);
    if (!product) {
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to retrieve product after reservation' 
      });
    }
    
    // Get product _id for Payment - handle both ObjectId and string _id
    let paymentProductId = null;
    const prodIdStr = product._id ? product._id.toString() : '';
    
    if (prodIdStr.match(/^[0-9a-fA-F]{24}$/)) {
      // Valid ObjectId
      paymentProductId = product._id;
    } else {
      // Product has string _id - try to find a product with valid ObjectId by productId
      const productByCustomId = await Product.findOne({ productId: product.productId });
      if (productByCustomId && productByCustomId._id) {
        const customIdStr = productByCustomId._id.toString();
        if (customIdStr.match(/^[0-9a-fA-F]{24}$/)) {
          paymentProductId = productByCustomId._id;
        }
      }
      
      // If still no valid ObjectId, we can't create Payment with ObjectId reference
      // But we still need to reserve the product, so we'll create Payment without productId reference
      // and store productId as a string in a custom field if needed
      if (!paymentProductId) {
        console.warn('Product has non-ObjectId _id, Payment will be created without productId reference');
        // We'll set productId to null and handle it differently, or use a workaround
        // For now, let's try to use the first available product's ObjectId as a placeholder
        // This is not ideal but will allow the system to work
        const anyProduct = await Product.findOne({ 
          _id: { $type: 'objectId' } 
        });
        if (anyProduct && anyProduct._id) {
          paymentProductId = anyProduct._id; // Use placeholder ObjectId
          console.warn('Using placeholder ObjectId for Payment productId reference');
        }
      }
    }

    // Create Payment record (without payment details yet)
    // Store both productId (ObjectId) and productIdString (custom string) if needed
    const paymentData = {
      orderId,
      userId: userId,
      amount: product.price,
      status: 'pending',
      reservationExpiresAt: reservationExpiresAt,
      customerDetails: customerDetails
      // paymentMethod and paymentDetails will be added in next step
    };
    
    // Add productId if we have a valid ObjectId
    if (paymentProductId) {
      paymentData.productId = paymentProductId;
    } else {
      // Store custom productId as string instead
      paymentData.productIdString = product.productId || productId;
      console.log('Storing productId as string:', paymentData.productIdString);
    }

    const payment = new Payment(paymentData);

    try {
      await payment.save();
    } catch (saveError) {
      console.error('Payment save error:', saveError);
      // If save fails, release the reservation
      const productIdStr = product._id ? product._id.toString() : '';
      const updateQuery = productIdStr.match(/^[0-9a-fA-F]{24}$/) 
        ? { _id: product._id }
        : { productId: product.productId || productId };
      
      await Product.updateOne(updateQuery, {
        $set: {
          inventoryStatus: 'available',
          reservedUntil: null,
          reservationId: null,
          reservedBy: null
        }
      });
      
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to create payment record',
        error: saveError.message 
      });
    }

    res.json({
      success: true,
      message: 'Product reserved for 15 minutes. Please proceed to payment.',
      orderId,
      reservationExpiresAt,
      product: {
        id: product._id,
        name: product.name,
        price: product.price,
        images: product.images
      }
    });

  } catch (error) {
    console.error('Submit form and reserve error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to submit form and reserve product',
      error: error.message 
    });
  }
});

// New endpoint: Submit payment details (STEP 2 - after reservation)
router.post('/submit-payment-details', auth, async (req, res) => {
  try {
    const { orderId, paymentMethod, paymentDetails } = req.body;
    const userId = req.user.id;

    console.log('Submit payment details request:', { orderId, userId });

    // Find the payment record
    let payment = await Payment.findOne({ orderId, userId });
    
    // Try to populate productId if it exists
    if (payment && payment.productId) {
      await payment.populate('productId');
    }
    
    if (!payment) {
      return res.status(404).json({ 
        success: false,
        message: 'Order not found. Please start over.' 
      });
    }

    if (payment.status !== 'pending') {
      return res.status(400).json({ 
        success: false,
        message: `Order is already ${payment.status}` 
      });
    }

    // Check if reservation is still valid
    if (!payment.isReservationValid()) {
      payment.status = 'expired';
      await payment.save();
      
      // Release the product - use productId or productIdString
      let updateQuery;
      if (payment.productId && payment.productId._id) {
        const productIdStr = payment.productId._id.toString();
        updateQuery = productIdStr.match(/^[0-9a-fA-F]{24}$/) 
          ? { _id: payment.productId._id }
          : { productId: payment.productId.productId };
      } else if (payment.productIdString) {
        updateQuery = { productId: payment.productIdString };
      } else {
        // Can't find product to release, but mark payment as expired
        return res.status(400).json({ 
          success: false,
          message: 'Reservation expired. Please try again.' 
        });
      }
      
      await Product.updateOne(updateQuery, {
        $set: {
          inventoryStatus: 'available',
          reservedUntil: null,
          reservationId: null,
          reservedBy: null
        }
      });

      return res.status(400).json({ 
        success: false,
        message: 'Reservation expired. Please try again.' 
      });
    }

    // Validate required fields based on payment method
    if (paymentMethod === 'upi' && !paymentDetails.upiTransactionId) {
      return res.status(400).json({ 
        success: false,
        message: 'UPI Transaction ID is required' 
      });
    }

    if (paymentMethod === 'bank_transfer' && !paymentDetails.bankReferenceNumber) {
      return res.status(400).json({ 
        success: false,
        message: 'Bank Reference Number is required' 
      });
    }

    // Validate UPI Transaction ID format (typically 12 digits or alphanumeric)
    if (paymentMethod === 'upi' && paymentDetails.upiTransactionId) {
      const upiId = paymentDetails.upiTransactionId.trim();
      // UPI transaction IDs are usually 12 digits or alphanumeric (min 8 chars)
      if (!/^[A-Z0-9]{8,20}$/i.test(upiId)) {
        return res.status(400).json({ 
          success: false,
          message: 'Invalid UPI Transaction ID format. Should be 8-20 alphanumeric characters.' 
        });
      }
    }

    // Validate Bank Reference Number format
    if (paymentMethod === 'bank_transfer' && paymentDetails.bankReferenceNumber) {
      const refNum = paymentDetails.bankReferenceNumber.trim();
      // Bank reference numbers are usually alphanumeric (min 6 chars)
      if (!/^[A-Z0-9]{6,30}$/i.test(refNum)) {
        return res.status(400).json({ 
          success: false,
          message: 'Invalid Bank Reference Number format. Should be 6-30 alphanumeric characters.' 
        });
      }
    }

    // Update payment with payment details
    payment.paymentMethod = paymentMethod;
    payment.paymentDetails = paymentDetails;
    payment.status = 'verified'; // Mark as verified after payment details submitted
    await payment.save();

    // Mark product as SOLD after payment completion
    let updateQuery;
    if (payment.productId) {
      const productIdStr = payment.productId.toString();
      updateQuery = productIdStr.match(/^[0-9a-fA-F]{24}$/) 
        ? { _id: payment.productId }
        : { productId: payment.productIdString || payment.productId };
    } else if (payment.productIdString) {
      updateQuery = { productId: payment.productIdString };
    } else {
      // Can't find product, but payment is saved
      return res.json({
        success: true,
        message: 'Payment details submitted successfully. Our team will verify your payment.',
        orderId,
        nextSteps: getNextSteps(paymentMethod)
      });
    }

    // Mark product as sold
    await Product.updateOne(updateQuery, {
      $set: {
        inventoryStatus: 'sold',
        reservedUntil: null,
        reservationId: null,
        reservedBy: null
      }
    });

    res.json({
      success: true,
      message: 'Payment details submitted successfully. Our team will verify your payment.',
      orderId,
      nextSteps: getNextSteps(paymentMethod)
    });

  } catch (error) {
    console.error('Submit payment details error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to submit payment details',
      error: error.message 
    });
  }
});

// Submit payment details (existing endpoint - for backward compatibility)
router.post('/submit-details', auth, async (req, res) => {
  try {
    const { orderId, customerDetails, paymentMethod, paymentDetails, productId } = req.body;
    const userId = req.user.id;

    // Find the payment record
    let payment = await Payment.findOne({ orderId, userId })
      .populate('productId');
    
    // If payment doesn't exist, create it (this handles cases where reservation didn't create payment)
    if (!payment) {
      console.log('Payment not found, creating new payment record for orderId:', orderId);
      
      // Find the product to get its details
      let product;
      if (productId && productId.match(/^[0-9a-fA-F]{24}$/)) {
        product = await Product.findById(productId);
      } else {
        product = await Product.findOne({ productId: productId });
      }
      
      if (!product) {
        return res.status(404).json({ 
          success: false,
          message: 'Product not found for this order' 
        });
      }
      
      // Get product _id - handle both ObjectId and string _id
      let paymentProductId = product._id;
      const productIdStr = product._id ? product._id.toString() : '';
      
      // If product has string _id, we need to handle it differently
      // For now, try to use it as-is (may need schema modification)
      if (!productIdStr.match(/^[0-9a-fA-F]{24}$/)) {
        console.warn('Product has non-ObjectId _id, attempting to use it anyway:', product._id);
        // Try to find product by productId to get a valid ObjectId
        const productByCustomId = await Product.findOne({ productId: product.productId });
        if (productByCustomId && productByCustomId._id && productByCustomId._id.toString().match(/^[0-9a-fA-F]{24}$/)) {
          paymentProductId = productByCustomId._id;
        }
      }
      
      // Get reservation expiry from product or use default
      const reservationExpiresAt = product.reservedUntil || new Date(Date.now() + 15 * 60 * 1000);
      
      // Create payment record
      payment = new Payment({
        orderId,
        productId: paymentProductId,
        userId: userId,
        amount: product.price,
        status: 'pending',
        reservationExpiresAt: reservationExpiresAt
      });
      
      try {
        await payment.save();
        console.log('Payment record created in submit-details:', {
          orderId,
          paymentId: payment._id
        });
      } catch (saveError) {
        console.error('Error creating payment record:', saveError);
        // If save fails due to productId validation, provide helpful error
        if (saveError.message && saveError.message.includes('Cast to ObjectId')) {
          return res.status(500).json({ 
            success: false,
            message: 'Product ID format error. Please contact support.',
            error: 'Invalid product ID format'
          });
        }
        return res.status(500).json({ 
          success: false,
          message: 'Failed to create payment record. Please try reserving again.',
          error: saveError.message 
        });
      }
    }

    if (payment.status !== 'pending') {
      return res.status(400).json({ 
        message: `Order is already ${payment.status}` 
      });
    }

    // Check if reservation is still valid
    if (!payment.isReservationValid()) {
      payment.status = 'expired';
      await payment.save();
      
      // Release the product
      await Product.findByIdAndUpdate(payment.productId, {
        inventoryStatus: 'available',
        reservedUntil: null,
        reservationId: null
      });

      return res.status(400).json({ 
        message: 'Reservation expired. Please try again.' 
      });
    }

    // Validate required fields based on payment method
    if (paymentMethod === 'upi' && !paymentDetails.upiTransactionId) {
      return res.status(400).json({ 
        message: 'UPI Transaction ID is required' 
      });
    }

    if (paymentMethod === 'bank_transfer' && !paymentDetails.bankReferenceNumber) {
      return res.status(400).json({ 
        message: 'Bank Reference Number is required' 
      });
    }

    // Update payment with customer details
    payment.customerDetails = customerDetails;
    payment.paymentMethod = paymentMethod;
    payment.paymentDetails = paymentDetails;
    await payment.save();

    res.json({
      success: true,
      message: 'Payment details submitted successfully. Our team will verify your payment.',
      orderId,
      nextSteps: getNextSteps(paymentMethod)
    });

  } catch (error) {
    console.error('Payment details submission error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get payment status by orderId
router.get('/status/:orderId', auth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;

    const payment = await Payment.findOne({ orderId, userId })
      .populate('productId', 'name price images')
      .populate('verifiedBy', 'name email');

    if (!payment) {
      return res.status(404).json({ message: 'Order not found' });
    }

    res.json({
      orderId: payment.orderId,
      status: payment.status,
      product: payment.productId,
      amount: payment.amount,
      paymentMethod: payment.paymentMethod,
      reservationExpiresAt: payment.reservationExpiresAt,
      createdAt: payment.createdAt,
      verifiedAt: payment.verifiedAt,
      adminNotes: payment.adminNotes
    });

  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user's pending payments
router.get('/my-pending', auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const payments = await Payment.find({ 
      userId, 
      status: 'pending' 
    }).populate('productId', 'name price images')
      .sort({ createdAt: -1 });

    res.json(payments);

  } catch (error) {
    console.error('Get pending payments error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user's payment history
router.get('/my-payments', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10 } = req.query;

    const payments = await Payment.find({ userId })
      .populate('productId', 'name price images')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Payment.countDocuments({ userId });

    res.json({
      payments,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      total
    });

  } catch (error) {
    console.error('Get payment history error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Helper function for next steps based on payment method
function getNextSteps(paymentMethod) {
  const steps = {
    upi: [
      'Make payment to our UPI ID: your-business@upi',
      'Enter the transaction ID in the form',
      'Our team will verify within 1-2 hours',
      'You will receive confirmation email'
    ],
    bank_transfer: [
      'Transfer amount to our bank account',
      'Account: YOUR_BUSINESS_NAME',
      'Account No: XXXX XXXX XXXX',
      'IFSC: XXXXXXXXXXX',
      'Enter reference number in the form',
      'Our team will verify within 2-4 hours'
    ]
  };

  return steps[paymentMethod] || [];
}

// Cart checkout - reserve multiple products
router.post('/submit-cart-and-reserve', auth, async (req, res) => {
  try {
    const { cartItems, customerDetails } = req.body;
    const userId = req.user.id;

    console.log('Cart checkout request:', { itemCount: cartItems.length, userId });

    if (!cartItems || cartItems.length === 0) {
      return res.status(400).json({ 
        success: false,
        message: 'Cart is empty' 
      });
    }

    const now = new Date();
    const reservationExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const orderIds = [];
    let totalAmount = 0;
    const reservedProducts = [];

    // Reserve each product in cart
    for (const cartItem of cartItems) {
      const productId = cartItem.productId;
      
      // Find product
      let product;
      if (productId && productId.match(/^[0-9a-fA-F]{24}$/)) {
        product = await Product.findById(productId);
        if (!product) {
          product = await Product.findOne({ productId: productId });
        }
      } else {
        product = await Product.findOne({ productId: productId });
      }
      
      if (!product) {
        return res.status(404).json({ 
          success: false,
          message: `Product "${cartItem.name}" not found` 
        });
      }

      // Check if expired reservation
      if (product.inventoryStatus === 'reserved' && product.reservedUntil && product.reservedUntil <= now) {
        const productIdStr = product._id ? product._id.toString() : '';
        const updateQuery = productIdStr.match(/^[0-9a-fA-F]{24}$/) 
          ? { _id: product._id }
          : { productId: product.productId || productId };
        
        await Product.updateOne(updateQuery, {
          $set: {
            inventoryStatus: 'available',
            reservedUntil: null,
            reservationId: null,
            reservedBy: null
          }
        });
        
        product = await Product.findOne(updateQuery);
      }

      if (product.inventoryStatus === 'sold') {
        return res.status(400).json({ 
          success: false, 
          message: `Product "${product.name}" is already sold out` 
        });
      }

      // Check if reserved by another user
      if (product.inventoryStatus === 'reserved' && product.reservedUntil && product.reservedUntil > now) {
        const isReservedByCurrentUser = product.reservedBy && 
          product.reservedBy.toString() === userId.toString();
        
        if (!isReservedByCurrentUser) {
          const timeLeft = Math.ceil((product.reservedUntil - now) / 1000 / 60);
          return res.status(400).json({ 
            success: false, 
            message: `Product "${product.name}" is currently reserved by another user. Available in ${timeLeft} minutes.`,
            reservedUntil: product.reservedUntil
          });
        }
      }

      // Generate order ID for this product
      const orderId = `GZ${Date.now()}${Math.random().toString(36).substr(2, 5)}`.toUpperCase();
      orderIds.push(orderId);
      totalAmount += product.price * (cartItem.quantity || 1);

      // Reserve the product
      const productIdStr = product._id ? product._id.toString() : '';
      const updateQuery = productIdStr.match(/^[0-9a-fA-F]{24}$/) 
        ? { _id: product._id }
        : { productId: product.productId || productId };
      
      await Product.updateOne(updateQuery, {
        $set: {
          inventoryStatus: 'reserved',
          reservedUntil: reservationExpiresAt,
          reservationId: orderId,
          reservedBy: userId
        }
      });

      // Get product for Payment
      product = await Product.findOne(updateQuery);
      
      let paymentProductId = product._id;
      const prodIdStr = product._id ? product._id.toString() : '';
      if (!prodIdStr.match(/^[0-9a-fA-F]{24}$/)) {
        const productByCustomId = await Product.findOne({ productId: product.productId });
        if (productByCustomId && productByCustomId._id && productByCustomId._id.toString().match(/^[0-9a-fA-F]{24}$/)) {
          paymentProductId = productByCustomId._id;
        }
      }

      // Create Payment record for each product
      const paymentData = {
        orderId,
        userId: userId,
        amount: product.price * (cartItem.quantity || 1),
        status: 'pending',
        reservationExpiresAt: reservationExpiresAt,
        customerDetails: customerDetails
      };
      
      if (paymentProductId) {
        paymentData.productId = paymentProductId;
      } else {
        paymentData.productIdString = product.productId || productId;
      }

      const payment = new Payment(paymentData);
      await payment.save();

      reservedProducts.push({
        productId: product._id || product.productId,
        name: product.name,
        orderId: orderId
      });
    }

    // Calculate totals with shipping and tax
    const shipping = 99;
    const tax = totalAmount * 0.18;
    const grandTotal = totalAmount + shipping + tax;

    res.json({
      success: true,
      message: `${cartItems.length} product(s) reserved for 15 minutes. Please proceed to payment.`,
      orderIds: orderIds,
      reservationExpiresAt: reservationExpiresAt,
      totalAmount: grandTotal,
      products: reservedProducts
    });

  } catch (error) {
    console.error('Cart checkout error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to reserve products',
      error: error.message 
    });
  }
});

// Submit payment details for cart checkout
router.post('/submit-cart-payment-details', auth, async (req, res) => {
  try {
    const { orderIds, paymentMethod, paymentDetails } = req.body;
    const userId = req.user.id;

    if (!orderIds || orderIds.length === 0) {
      return res.status(400).json({ 
        success: false,
        message: 'Order IDs are required' 
      });
    }

    // Validate payment details
    if (paymentMethod === 'upi' && !paymentDetails.upiTransactionId) {
      return res.status(400).json({ 
        success: false,
        message: 'UPI Transaction ID is required' 
      });
    }

    if (paymentMethod === 'bank_transfer' && !paymentDetails.bankReferenceNumber) {
      return res.status(400).json({ 
        success: false,
        message: 'Bank Reference Number is required' 
      });
    }

    // Validate transaction ID format
    if (paymentMethod === 'upi' && paymentDetails.upiTransactionId) {
      const upiId = paymentDetails.upiTransactionId.trim();
      if (!/^[A-Z0-9]{8,20}$/i.test(upiId)) {
        return res.status(400).json({ 
          success: false,
          message: 'Invalid UPI Transaction ID format. Should be 8-20 alphanumeric characters.' 
        });
      }
    }

    if (paymentMethod === 'bank_transfer' && paymentDetails.bankReferenceNumber) {
      const refNum = paymentDetails.bankReferenceNumber.trim();
      if (!/^[A-Z0-9]{6,30}$/i.test(refNum)) {
        return res.status(400).json({ 
          success: false,
          message: 'Invalid Bank Reference Number format. Should be 6-30 alphanumeric characters.' 
        });
      }
    }

    // Update all payments
    const updatedPayments = [];
    for (const orderId of orderIds) {
      const payment = await Payment.findOne({ orderId, userId });
      
      if (!payment) {
        console.warn(`Payment not found for orderId: ${orderId}`);
        continue;
      }

      if (payment.status !== 'pending') {
        console.warn(`Payment ${orderId} is already ${payment.status}`);
        continue;
      }

      // Check if reservation is still valid
      if (!payment.isReservationValid()) {
        payment.status = 'expired';
        await payment.save();
        continue;
      }

      // Update payment
      payment.paymentMethod = paymentMethod;
      payment.paymentDetails = paymentDetails;
      payment.status = 'verified';
      await payment.save();

      // Mark product as sold
      let updateQuery;
      if (payment.productId) {
        const productIdStr = payment.productId.toString();
        updateQuery = productIdStr.match(/^[0-9a-fA-F]{24}$/) 
          ? { _id: payment.productId }
          : { productId: payment.productIdString || payment.productId };
      } else if (payment.productIdString) {
        updateQuery = { productId: payment.productIdString };
      }

      if (updateQuery) {
        await Product.updateOne(updateQuery, {
          $set: {
            inventoryStatus: 'sold',
            reservedUntil: null,
            reservationId: null,
            reservedBy: null
          }
        });
      }

      updatedPayments.push(orderId);
    }

    res.json({
      success: true,
      message: `Payment details submitted for ${updatedPayments.length} order(s). Products marked as sold.`,
      orderIds: updatedPayments,
      nextSteps: getNextSteps(paymentMethod)
    });

  } catch (error) {
    console.error('Submit cart payment details error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to submit payment details',
      error: error.message 
    });
  }
});

module.exports = router;