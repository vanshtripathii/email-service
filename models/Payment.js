const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  orderId: {
    type: String,
    required: true,
    unique: true
  },
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: false  // Optional because products might have string _id values
  },
  productIdString: {
    type: String,  // Store custom productId string for products with string _id
    required: false
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  customerDetails: {
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    address: {
      street: { type: String, required: true },
      street2: { type: String, default: '' },
      city: { type: String, required: true },
      state: { type: String, required: true },
      pincode: { type: String, required: true },
      country: { type: String, default: 'India' }
    }
  },
  paymentMethod: {
    type: String,
    enum: ['upi', 'bank_transfer'],
    required: false  // Will be set in step 2 (payment details submission)
  },
  paymentDetails: {
    // For UPI
    upiTransactionId: { 
      type: String, 
      required: function() { return this.paymentMethod === 'upi'; } 
    },
    upiId: String,
    
    // For Bank Transfer
    bankReferenceNumber: { 
      type: String, 
      required: function() { return this.paymentMethod === 'bank_transfer'; } 
    },
    transferAmount: Number,
    transferDate: Date
  },
  amount: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'verified', 'failed', 'expired'],
    default: 'pending'
  },
  reservationExpiresAt: {
    type: Date,
    required: true
  },
  adminNotes: String,
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  verifiedAt: Date
}, {
  timestamps: true
});

// Indexes for efficient queries
paymentSchema.index({ status: 1 });
paymentSchema.index({ reservationExpiresAt: 1 });
paymentSchema.index({ orderId: 1 });
paymentSchema.index({ createdAt: 1 });
paymentSchema.index({ userId: 1 });
paymentSchema.index({ productId: 1 });

// Static method to generate order ID
paymentSchema.statics.generateOrderId = function() {
  const timestamp = Date.now().toString();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `GZ${timestamp}${random}`;
};

// Method to check if reservation is still valid
paymentSchema.methods.isReservationValid = function() {
  return new Date() < this.reservationExpiresAt && this.status === 'pending';
};

module.exports = mongoose.model('Payment', paymentSchema);