const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  productId: {
    type: String,
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  price: {
    type: Number,
    required: true
  },
  images: [{
    type: String
  }],
  category: {
    type: String,
    required: true
  },
  isSinglePiece: {
    type: Boolean,
    default: true
  },
  inventoryStatus: {
    type: String,
    enum: ['available', 'reserved', 'sold', 'out_of_stock'],
    default: 'available'
  },
  reservedUntil: {
    type: Date
  },
  reservationId: {
    type: String,
    ref: 'Payment'
  },
  reservedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  quantity: {
    type: Number,
    default: 1
  },
  isAvailable: {
    type: Boolean,
    default: true
  },
  // Additional fields for enhanced functionality
  specifications: {
    type: Map,
    of: String
  },
  featured: {
    type: Boolean,
    default: false
  },
  tags: [{
    type: String
  }],
  // SEO fields
  slug: {
    type: String,
    unique: true
  },
  metaTitle: String,
  metaDescription: String
}, {
  timestamps: true
});

// Index for better query performance
productSchema.index({ inventoryStatus: 1 });
productSchema.index({ category: 1 });
productSchema.index({ isSinglePiece: 1 });
productSchema.index({ reservedUntil: 1 });
productSchema.index({ featured: 1 });
productSchema.index({ slug: 1 });

// Virtual for checking if product is currently reserved
productSchema.virtual('isReserved').get(function() {
  return this.inventoryStatus === 'reserved' && 
         this.reservedUntil && 
         new Date() < this.reservedUntil;
});

// Virtual for checking if reservation has expired
productSchema.virtual('isReservationExpired').get(function() {
  return this.inventoryStatus === 'reserved' && 
         this.reservedUntil && 
         new Date() >= this.reservedUntil;
});

// Method to reserve product
productSchema.methods.reserve = function(reservationId, minutes = 15) {
  this.inventoryStatus = 'reserved';
  this.reservedUntil = new Date(Date.now() + minutes * 60 * 1000);
  this.reservationId = reservationId;
  return this.save();
};

// Method to release reservation
productSchema.methods.releaseReservation = function() {
  this.inventoryStatus = 'available';
  this.reservedUntil = null;
  this.reservationId = null;
  return this.save();
};

// Method to mark as sold
productSchema.methods.markAsSold = function() {
  this.inventoryStatus = 'sold';
  this.reservedUntil = null;
  this.reservationId = null;
  this.isAvailable = false;
  return this.save();
};

// Static method to find available products
productSchema.statics.findAvailable = function() {
  return this.find({
    $or: [
      { inventoryStatus: 'available' },
      { 
        inventoryStatus: 'reserved',
        reservedUntil: { $lt: new Date() }
      }
    ]
  });
};

// Static method to cleanup expired reservations
productSchema.statics.cleanupExpiredReservations = async function() {
  const result = await this.updateMany(
    {
      inventoryStatus: 'reserved',
      reservedUntil: { $lt: new Date() }
    },
    {
      $set: {
        inventoryStatus: 'available',
        reservedUntil: null,
        reservationId: null,
        reservedBy: null // Ensure reservedBy is cleared
      }
    }
  );
  return result.modifiedCount;
};

// Pre-save middleware to sync isAvailable with inventoryStatus
productSchema.pre('save', function(next) {
  this.isAvailable = this.inventoryStatus === 'available';
  next();
});

// Pre-save middleware to generate slug from name
productSchema.pre('save', function(next) {
  if (this.isModified('name') && !this.slug) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-zA-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
  next();
});

module.exports = mongoose.model('Product', productSchema);