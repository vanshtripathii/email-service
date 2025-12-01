const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  productId: {
    type: String,
    required: [true, 'Product ID is required'],
    trim: true,
    validate: {
      validator: function(v) {
        return v && v.toString().trim().length > 0;
      },
      message: 'Product ID cannot be empty'
    }
  },
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true
  },
  price: {
    type: Number,
    required: [true, 'Price is required'],
    min: [0, 'Price cannot be negative']
  },
  image: {
    type: String,
    default: ''
  },
  quantity: {
    type: Number,
    default: 1,
    min: [1, 'Quantity must be at least 1']
  },
  // Add product reference for better querying
  productRef: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  }
}, {
  _id: true // Ensure each item has its own ID
});

const cartSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true // One cart per user
  },
  items: {
    type: [cartItemSchema],
    default: [] // Always start with empty array
  },
  subtotal: {
    type: Number,
    default: 0,
    min: 0
  },
  shipping: {
    type: Number,
    default: 0,
    min: 0
  },
  tax: {
    type: Number,
    default: 0,
    min: 0
  },
  total: {
    type: Number,
    default: 0,
    min: 0
  },
  // Add cart status for better management
  status: {
    type: String,
    enum: ['active', 'processing', 'completed', 'abandoned'],
    default: 'active'
  },
  // Add last activity timestamp
  lastActivity: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for better performance
cartSchema.index({ userId: 1 });
cartSchema.index({ status: 1 });
cartSchema.index({ lastActivity: 1 });

// Pre-save middleware to clean invalid items and update totals
cartSchema.pre('save', function(next) {
  // Update last activity
  this.lastActivity = new Date();
  
  if (this.items && Array.isArray(this.items)) {
    // Filter out any items with invalid productId
    this.items = this.items.filter(item => 
      item && 
      item.productId && 
      item.productId.toString().trim().length > 0
    );
    
    // Recalculate totals whenever items change
    this.recalculateTotals();
  } else {
    this.items = [];
    this.subtotal = 0;
    this.shipping = 0;
    this.tax = 0;
    this.total = 0;
  }
  next();
});

// Method to recalculate cart totals
cartSchema.methods.recalculateTotals = function() {
  let subtotal = 0;
  
  for (const item of this.items) {
    subtotal += (item.price || 0) * (item.quantity || 1);
  }
  
  this.subtotal = parseFloat(subtotal.toFixed(2));
  this.shipping = subtotal > 0 ? 99 : 0; // ₹99 shipping for India
  this.tax = parseFloat((subtotal * 0.18).toFixed(2)); // 18% GST
  this.total = parseFloat((subtotal + this.shipping + this.tax).toFixed(2));
};

// Method to add item to cart
cartSchema.methods.addItem = function(productData) {
  const { productId, name, price, image, productRef } = productData;
  
  const existingItemIndex = this.items.findIndex(
    item => item.productId === productId.toString().trim()
  );

  if (existingItemIndex > -1) {
    // Update quantity if item exists
    this.items[existingItemIndex].quantity += 1;
  } else {
    // Add new item to cart
    this.items.push({
      productId: productId.toString().trim(),
      name: name,
      price: parseFloat(price),
      image: image || '',
      quantity: 1,
      productRef: productRef
    });
  }
  
  this.recalculateTotals();
  return this;
};

// Method to remove item from cart
cartSchema.methods.removeItem = function(productId) {
  const initialLength = this.items.length;
  this.items = this.items.filter(item => item.productId !== productId.toString().trim());
  
  if (this.items.length < initialLength) {
    this.recalculateTotals();
    return true; // Item was removed
  }
  
  return false; // Item not found
};

// Method to update item quantity
cartSchema.methods.updateQuantity = function(productId, quantity) {
  const itemIndex = this.items.findIndex(item => item.productId === productId.toString().trim());
  
  if (itemIndex === -1) {
    return false; // Item not found
  }

  if (quantity < 1) {
    // Remove item if quantity is 0 or negative
    this.items.splice(itemIndex, 1);
  } else {
    this.items[itemIndex].quantity = parseInt(quantity);
  }
  
  this.recalculateTotals();
  return true;
};

// Method to clear cart
cartSchema.methods.clearCart = function() {
  this.items = [];
  this.subtotal = 0;
  this.shipping = 0;
  this.tax = 0;
  this.total = 0;
  return this;
};

// Method to get cart summary
cartSchema.methods.getSummary = function() {
  return {
    itemsCount: this.items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: this.subtotal,
    shipping: this.shipping,
    tax: this.tax,
    total: this.total,
    items: this.items.map(item => ({
      productId: item.productId,
      name: item.name,
      price: item.price,
      image: item.image,
      quantity: item.quantity,
      itemTotal: item.price * item.quantity
    }))
  };
};

// Static method to safely find or create cart
cartSchema.statics.findOrCreate = async function(userId) {
  let cart = await this.findOne({ userId });
  
  if (!cart) {
    cart = new this({
      userId,
      items: [],
      subtotal: 0,
      shipping: 0,
      tax: 0,
      total: 0,
      status: 'active'
    });
    await cart.save();
  }
  
  return cart;
};

// Static method to find abandoned carts (older than 7 days)
cartSchema.statics.findAbandonedCarts = function(days = 7) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  
  return this.find({
    status: 'active',
    lastActivity: { $lt: cutoffDate }
  });
};

// Static method to cleanup old abandoned carts
cartSchema.statics.cleanupAbandonedCarts = async function(days = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  
  const result = await this.deleteMany({
    status: 'active',
    lastActivity: { $lt: cutoffDate },
    items: { $size: 0 } // Only empty carts
  });
  
  return result.deletedCount;
};

module.exports = mongoose.model('Cart', cartSchema);
