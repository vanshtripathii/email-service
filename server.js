const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// MongoDB Connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/gadzooks', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB connected successfully');

    // Create indexes for better performance
    await createIndexes();
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

// Function to create database indexes with proper error handling
const createIndexes = async () => {
  try {
    console.log('Checking and creating database indexes...');
    
    const cartCollection = mongoose.connection.db.collection('carts');
    const paymentCollection = mongoose.connection.db.collection('payments');
    const productCollection = mongoose.connection.db.collection('products');
    const manualPaymentCollection = mongoose.connection.db.collection('payments'); // For manual payments

    // Get existing indexes to check for conflicts
    const cartIndexes = await cartCollection.indexes();
    const paymentIndexes = await paymentCollection.indexes();
    const productIndexes = await productCollection.indexes();

    console.log('Existing cart indexes:', cartIndexes.map(idx => idx.name));
    
    // Drop the specific conflicting index
    const conflictingIndexName = 'userId_1_items.productId_1';
    if (cartIndexes.some(idx => idx.name === conflictingIndexName)) {
      try {
        await cartCollection.dropIndex(conflictingIndexName);
        console.log(`✅ Successfully dropped conflicting index: ${conflictingIndexName}`);
      } catch (dropError) {
        console.log(`⚠️ Could not drop index ${conflictingIndexName}:`, dropError.message);
      }
    }

    // Create cart indexes with new names
    try {
      await cartCollection.createIndex({ "userId": 1 }, { 
        name: "cart_user_id_idx",
        background: true 
      });
      console.log('✅ Created cart user index');
    } catch (error) {
      console.log('⚠️ Cart user index already exists or failed:', error.message);
    }

    try {
      await cartCollection.createIndex({ "createdAt": 1 }, { 
        name: "cart_created_at_idx",
        background: true 
      });
      console.log('✅ Created cart created_at index');
    } catch (error) {
      console.log('⚠️ Cart created_at index already exists or failed:', error.message);
    }

    try {
      await cartCollection.createIndex({ "userId": 1, "items.productId": 1 }, { 
        name: "cart_user_product_idx",
        background: true 
      });
      console.log('✅ Created cart user_product composite index');
    } catch (error) {
      console.log('⚠️ Cart user_product index already exists or failed:', error.message);
    }

    // Create payment indexes
    try {
      await paymentCollection.createIndex({ "userId": 1 }, { 
        name: "payment_user_id_idx",
        background: true 
      });
      console.log('✅ Created payment user index');
    } catch (error) {
      console.log('⚠️ Payment user index already exists or failed:', error.message);
    }

    try {
      await paymentCollection.createIndex({ "orderId": 1 }, { 
        name: "payment_order_id_idx",
        background: true 
      });
      console.log('✅ Created payment order_id index');
    } catch (error) {
      console.log('⚠️ Payment order_id index already exists or failed:', error.message);
    }

    try {
      await paymentCollection.createIndex({ "transactionId": 1 }, { 
        name: "payment_transaction_id_idx",
        background: true 
      });
      console.log('✅ Created payment transaction_id index');
    } catch (error) {
      console.log('⚠️ Payment transaction_id index already exists or failed:', error.message);
    }

    try {
      await paymentCollection.createIndex({ "createdAt": 1 }, { 
        name: "payment_created_at_idx",
        background: true 
      });
      console.log('✅ Created payment created_at index');
    } catch (error) {
      console.log('⚠️ Payment created_at index already exists or failed:', error.message);
    }

    // Create product indexes
    try {
      await productCollection.createIndex({ "inventoryStatus": 1 }, { 
        name: "product_inventory_status_idx",
        background: true 
      });
      console.log('✅ Created product inventory_status index');
    } catch (error) {
      console.log('⚠️ Product inventory_status index already exists or failed:', error.message);
    }

    try {
      await productCollection.createIndex({ "reservedUntil": 1 }, { 
        name: "product_reserved_until_idx",
        expireAfterSeconds: 0,
        background: true 
      });
      console.log('✅ Created product reserved_until TTL index');
    } catch (error) {
      console.log('⚠️ Product reserved_until index already exists or failed:', error.message);
    }

    // Create manual payment indexes
    try {
      await manualPaymentCollection.createIndex({ "status": 1 }, { 
        name: "manual_payment_status_idx",
        background: true 
      });
      console.log('✅ Created manual payment status index');
    } catch (error) {
      console.log('⚠️ Manual payment status index already exists or failed:', error.message);
    }

    try {
      await manualPaymentCollection.createIndex({ "reservationExpiresAt": 1 }, { 
        name: "manual_payment_reservation_expires_idx",
        background: true 
      });
      console.log('✅ Created manual payment reservation expires index');
    } catch (error) {
      console.log('⚠️ Manual payment reservation expires index already exists or failed:', error.message);
    }

    try {
      await manualPaymentCollection.createIndex({ "orderId": 1 }, { 
        name: "manual_payment_order_id_idx",
        background: true,
        unique: true 
      });
      console.log('✅ Created manual payment order_id index');
    } catch (error) {
      console.log('⚠️ Manual payment order_id index already exists or failed:', error.message);
    }

    try {
      await manualPaymentCollection.createIndex({ "userId": 1 }, { 
        name: "manual_payment_user_id_idx",
        background: true 
      });
      console.log('✅ Created manual payment user_id index');
    } catch (error) {
      console.log('⚠️ Manual payment user_id index already exists or failed:', error.message);
    }

    try {
      await manualPaymentCollection.createIndex({ "productId": 1 }, { 
        name: "manual_payment_product_id_idx",
        background: true 
      });
      console.log('✅ Created manual payment product_id index');
    } catch (error) {
      console.log('⚠️ Manual payment product_id index already exists or failed:', error.message);
    }

    console.log('✅ Database index setup completed');

  } catch (error) {
    console.error('❌ Error in index creation process:', error.message);
    console.log('⚠️ Continuing without indexes - this may affect performance');
  }
};

connectDB();

// Models
const User = require('./models/User');
const Product = require('./models/Product');
const Order = require('./models/Order');
const Subscription = require('./models/Subscription');
const Payment = require('./models/Payment'); // Add Payment model

app.post('/api/cleanup-carts', async (req, res) => {
  try {
    const result = await mongoose.connection.db.collection('carts').updateMany(
      { "items.productId": { $exists: false } },
      { $set: { "items": [] } }
    );
    
    console.log(`Cleaned up ${result.modifiedCount} carts with invalid items`);
    res.json({ message: `Cleaned ${result.modifiedCount} carts` });
  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({ error: 'Cleanup failed' });
  }
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/cart', require('./routes/cart'));
app.use('/api/subscribe', require('./routes/subscribe'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/checkout', require('./routes/checkout'));

// NEW ROUTES FOR MANUAL PAYMENT SYSTEM
app.use('/api/manual-payments', require('./routes/manual-payments'));
app.use('/api/admin/payments', require('./routes/admin-payments'));

// Health check route
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Enhanced PRODUCT AVAILABILITY ENDPOINT
app.get('/api/products/availability', async (req, res) => {
  try {
    const products = await Product.find({}, 'productId name price inventoryStatus images category isSinglePiece reservedUntil');
    
    // Create availability map using product IDs
    const availability = {};
    products.forEach(product => {
      const now = new Date();
      const isReserved = product.inventoryStatus === 'reserved' && 
                        product.reservedUntil && 
                        now < product.reservedUntil;
      
      const isAvailable = product.inventoryStatus === 'available';
      
      // Use both MongoDB _id and custom productId
      availability[product._id] = {
        productId: product.productId,
        name: product.name,
        price: product.price,
        inventoryStatus: product.inventoryStatus,
        images: product.images,
        category: product.category,
        isSinglePiece: product.isSinglePiece,
        reservedUntil: product.reservedUntil,
        isAvailable: isAvailable,
        isReserved: isReserved,
        canBeReserved: isAvailable && product.isSinglePiece
      };
      
      if (product.productId) {
        availability[product.productId] = availability[product._id];
      }
    });
    
    res.json(availability);
  } catch (error) {
    console.error('Error fetching product availability:', error);
    res.status(500).json({ message: 'Failed to fetch product availability' });
  }
});

// System status endpoint
app.get('/api/system-status', async (req, res) => {
  try {
    const totalProducts = await Product.countDocuments();
    const availableProducts = await Product.countDocuments({ inventoryStatus: 'available' });
    const reservedProducts = await Product.countDocuments({ inventoryStatus: 'reserved' });
    const soldProducts = await Product.countDocuments({ inventoryStatus: 'sold' });
    
    const pendingPayments = await Payment.countDocuments({ status: 'pending' });
    const verifiedPayments = await Payment.countDocuments({ status: 'verified' });
    const failedPayments = await Payment.countDocuments({ status: 'failed' });

    res.json({
      system: {
        status: 'operational',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      },
      products: {
        total: totalProducts,
        available: availableProducts,
        reserved: reservedProducts,
        sold: soldProducts
      },
      payments: {
        pending: pendingPayments,
        verified: verifiedPayments,
        failed: failedPayments
      },
      database: {
        status: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        name: mongoose.connection.name
      }
    });
  } catch (error) {
    console.error('System status error:', error);
    res.status(500).json({ message: 'Failed to get system status' });
  }
});

// CLEANUP JOBS

// Cleanup expired product reservations (run every minute)
// IMPORTANT: This only updates product status, NEVER deletes products
setInterval(async () => {
  try {
    const now = new Date();
    
    // Find all products with expired reservations
    const expiredProducts = await Product.find({
      inventoryStatus: 'reserved',
      reservedUntil: { $lt: now }
    });

    let cleanedCount = 0;
    
    for (const product of expiredProducts) {
      try {
        // Handle both ObjectId and custom string IDs
        let updateQuery;
        const productIdStr = product._id ? product._id.toString() : '';
        
        if (productIdStr.match(/^[0-9a-fA-F]{24}$/)) {
          // Valid ObjectId
          updateQuery = { _id: product._id };
        } else if (product.productId) {
          // Custom string ID
          updateQuery = { productId: product.productId };
        } else {
          // Fallback to _id even if it's a string
          updateQuery = { _id: product._id };
        }

        // IMPORTANT: Only update status, NEVER delete the product
        // Verify product exists before update
        const productBefore = await Product.findOne(updateQuery);
        if (!productBefore) {
          console.error(`❌ Product not found before update - this should never happen: ${product.name || product.productId || product._id}`);
          continue;
        }
        
        const updateResult = await Product.updateOne(updateQuery, {
          $set: {
            inventoryStatus: 'available',
            reservedUntil: null,
            reservationId: null,
            reservedBy: null
          }
        });
        
        // Verify product still exists after update (safeguard against deletion)
        const productAfter = await Product.findOne(updateQuery);
        if (!productAfter) {
          console.error(`❌ CRITICAL: Product was deleted during update! This should never happen: ${product.name || product.productId || product._id}`);
          // Try to restore the product (this shouldn't be necessary, but as a safeguard)
          continue;
        }
        
        if (updateResult.matchedCount === 0) {
          console.warn(`⚠️ Product not found for update: ${product.name || product.productId || product._id}`);
        } else if (updateResult.modifiedCount === 0) {
          console.warn(`⚠️ Product not modified (may already be available): ${product.name || product.productId || product._id}`);
        } else {
          cleanedCount++;
          console.log(`✅ Released expired reservation for product: ${product.name || product.productId || product._id} (ID: ${product._id || product.productId}) - Product still exists in database`);
        }
      } catch (error) {
        console.error(`❌ Error releasing product ${product._id || product.productId}:`, error);
        // Don't throw - continue with other products
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`✅ Cleaned up ${cleanedCount} expired product reservations (products remain in database)`);
    }
  } catch (error) {
    console.error('❌ Error cleaning up expired product reservations:', error);
  }
}, 60 * 1000); // Run every minute

// Cleanup expired manual payments (run every minute)
setInterval(async () => {
  try {
    const expiredPayments = await Payment.find({
      status: 'pending',
      reservationExpiresAt: { $lt: new Date() }
    });

    for (const payment of expiredPayments) {
      try {
        // Mark payment as expired
        payment.status = 'expired';
        await payment.save();

        // Release the product - handle both productId (ObjectId) and productIdString
        let updateQuery;
        if (payment.productId) {
          const productIdStr = payment.productId.toString();
          if (productIdStr.match(/^[0-9a-fA-F]{24}$/)) {
            updateQuery = { _id: payment.productId };
          } else {
            // If productId is not a valid ObjectId, try to find by productIdString
            if (payment.productIdString) {
              updateQuery = { productId: payment.productIdString };
            } else {
              console.warn(`Cannot release product for payment ${payment.orderId}: invalid productId`);
              continue;
            }
          }
        } else if (payment.productIdString) {
          updateQuery = { productId: payment.productIdString };
        } else {
          console.warn(`Cannot release product for payment ${payment.orderId}: no productId or productIdString`);
          continue;
        }

        await Product.updateOne(updateQuery, {
          $set: {
            inventoryStatus: 'available',
            reservedUntil: null,
            reservationId: null,
            reservedBy: null
          }
        });

        console.log(`🔄 Expired payment cleaned up: ${payment.orderId}`);
      } catch (error) {
        console.error(`Error cleaning up payment ${payment.orderId}:`, error);
      }
    }

    if (expiredPayments.length > 0) {
      console.log(`🔄 Cleaned up ${expiredPayments.length} expired payments`);
    }
  } catch (error) {
    console.error('Error in payment cleanup job:', error);
  }
}, 60 * 1000); // Run every minute

// Cleanup expired orders (run every minute)
setInterval(async () => {
  try {
    const expiredOrders = await Order.find({
      status: 'reserved',
      reservationExpiresAt: { $lt: new Date() }
    });

    for (const order of expiredOrders) {
      try {
        // Release all products in the order
        for (const item of order.items) {
          await Product.updateOne(
            { _id: item.product },
            { 
              $set: { 
                inventoryStatus: 'available',
                reservedUntil: null,
                reservationId: null,
                reservedBy: null
              }
            }
          );
        }

        // Mark order as expired
        order.status = 'expired';
        if (order.paymentInfo) {
          order.paymentInfo.paymentStatus = 'expired';
        }
        await order.save();

        console.log(`🔄 Expired order cleaned up: ${order.orderId}`);
      } catch (error) {
        console.error(`Error cleaning up order ${order.orderId}:`, error);
      }
    }

    if (expiredOrders.length > 0) {
      console.log(`🔄 Cleaned up ${expiredOrders.length} expired orders`);
    }
  } catch (error) {
    console.error('Error in order cleanup job:', error);
  }
}, 60 * 1000); // Run every minute

// Manual cleanup endpoint for admin
app.post('/api/admin/cleanup', async (req, res) => {
  try {
    const productCleanup = await Product.cleanupExpiredReservations();
    const paymentCleanup = await Payment.updateMany(
      {
        status: 'pending',
        reservationExpiresAt: { $lt: new Date() }
      },
      {
        status: 'expired'
      }
    );

    res.json({
      message: 'Manual cleanup completed',
      results: {
        products: `${productCleanup} expired reservations cleaned`,
        payments: `${paymentCleanup.modifiedCount} expired payments marked`
      }
    });
  } catch (error) {
    console.error('Manual cleanup error:', error);
    res.status(500).json({ message: 'Manual cleanup failed' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { 
      error: error.message,
      stack: error.stack 
    })
  });
});

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({ 
    success: false,
    message: 'Route not found',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 API endpoints available at http://localhost:${PORT}/api`);
  console.log('📋 Available routes:');
  console.log('   - GET    /api/health');
  console.log('   - GET    /api/system-status');
  console.log('   - GET    /api/products/availability');
  console.log('   -        /api/auth/*');
  console.log('   -        /api/products/*');
  console.log('   -        /api/cart/*');
  console.log('   -        /api/subscribe/*');
  console.log('   -        /api/payments/*');
  console.log('   -        /api/checkout/*');
  console.log('   -        /api/manual-payments/*');
  console.log('   -        /api/admin/payments/*');
  console.log('   - POST   /api/cleanup-carts');
  console.log('   - POST   /api/admin/cleanup');
  console.log('');
  console.log('🔄 Cleanup jobs running every minute:');
  console.log('   - Expired product reservations');
  console.log('   - Expired manual payments');
  console.log('   - Expired orders');
  console.log('');
  console.log('⚡ Manual Payment System: ACTIVE');
  console.log('   - 15-minute reservation system');
  console.log('   - UPI & Bank Transfer support');
  console.log('   - Admin verification dashboard');
});
