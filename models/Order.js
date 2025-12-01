const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  orderId: {
    type: String,
    required: true,
    unique: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  items: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    productId: {
      type: String,
      required: true
    },
    name: {
      type: String,
      required: true
    },
    price: {
      type: Number,
      required: true
    },
    quantity: {
      type: Number,
      default: 1
    }
  }],
  totalAmount: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'reserved', 'confirmed', 'sold', 'expired', 'cancelled'],
    default: 'pending'
  },
  // Checkout Form Data
  customerInfo: {
    fullName: {
      type: String,
      required: true
    },
    email: {
      type: String,
      required: true
    },
    phoneNumber: {
      type: String,
      required: true
    },
    addressLine1: {
      type: String,
      required: true
    },
    addressLine2: String,
    city: {
      type: String,
      required: true
    },
    state: {
      type: String,
      required: true
    },
    pincode: {
      type: String,
      required: true
    }
  },
  paymentInfo: {
    upiId: String,
    upiQrCode: String,
    paymentStatus: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'expired'],
      default: 'pending'
    },
    transactionId: String,
    paidAt: Date
  },
  reservationExpiresAt: {
    type: Date,
    required: true
  },
  reservationId: {
    type: String,
    required: true
  }
}, {
  timestamps: true
});

// Index for reservation cleanup
orderSchema.index({ reservationExpiresAt: 1 }, { expireAfterSeconds: 0 });
orderSchema.index({ status: 1 });
orderSchema.index({ reservationId: 1 });

module.exports = mongoose.model('Order', orderSchema);