const express = require('express');
const Product = require('../models/Product');
const router = express.Router();

// Get product availability - THIS MUST COME BEFORE THE :id ROUTE
router.get('/availability', async (req, res) => {
  try {
    const products = await Product.find({}, 'productId name price inventoryStatus images category isSinglePiece reservedUntil reservedBy');
    const now = new Date();
    
    const availability = {};
    const productsToUpdate = [];
    
    products.forEach(product => {
      // Check if reservation has expired
      const reservationExpired = product.inventoryStatus === 'reserved' && 
                                 product.reservedUntil && 
                                 product.reservedUntil < now;
      
      // If reservation expired, mark it for update and treat as available
      let actualStatus = product.inventoryStatus;
      let actualReservedUntil = product.reservedUntil;
      let actualReservedBy = product.reservedBy;
      
      if (reservationExpired) {
        actualStatus = 'available';
        actualReservedUntil = null;
        actualReservedBy = null;
        
        // Queue for async update
        productsToUpdate.push({
          _id: product._id,
          productId: product.productId
        });
      }
      
      const isReserved = actualStatus === 'reserved' && 
                        actualReservedUntil && 
                        now < actualReservedUntil;
      
      const isAvailable = actualStatus === 'available';
      
      availability[product._id] = {
        productId: product.productId,
        name: product.name,
        price: product.price,
        inventoryStatus: actualStatus,
        images: product.images,
        category: product.category,
        isSinglePiece: product.isSinglePiece,
        reservedUntil: actualReservedUntil,
        reservedBy: actualReservedBy ? actualReservedBy.toString() : null,
        isAvailable: isAvailable,
        isReserved: isReserved,
        canBeReserved: isAvailable && product.isSinglePiece
      };
      
      if (product.productId) {
        availability[product.productId] = availability[product._id];
      }
    });
    
    // Update expired reservations in background (don't wait for it)
    if (productsToUpdate.length > 0) {
      productsToUpdate.forEach(async (productInfo) => {
        try {
          let updateQuery;
          const productIdStr = productInfo._id ? productInfo._id.toString() : '';
          
          if (productIdStr.match(/^[0-9a-fA-F]{24}$/)) {
            updateQuery = { _id: productInfo._id };
          } else if (productInfo.productId) {
            updateQuery = { productId: productInfo.productId };
          } else {
            updateQuery = { _id: productInfo._id };
          }
          
          await Product.updateOne(updateQuery, {
            $set: {
              inventoryStatus: 'available',
              reservedUntil: null,
              reservationId: null,
              reservedBy: null
            }
          });
        } catch (error) {
          console.error(`Error updating expired product ${productInfo._id || productInfo.productId}:`, error);
        }
      });
    }
    
    res.json(availability);
  } catch (error) {
    console.error('Error fetching product availability:', error);
    res.status(500).json({ message: 'Failed to fetch product availability' });
  }
});

// Get all products - Returns ALL products regardless of status (available, reserved, sold)
// Products are NEVER deleted, only their status changes
router.get('/', async (req, res) => {
  try {
    const products = await Product.find({});
    console.log(`📦 Returning ${products.length} products (all statuses: available, reserved, sold)`);
    res.json(products);
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get product by ID - FIXED VERSION
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Skip if it's a reserved route name
    if (['availability', 'check-availability', 'status', 'can-reserve'].includes(id)) {
      return res.status(404).json({ message: 'Product not found' });
    }
    
    let product;
    
    // Check if it's a valid MongoDB ObjectId (24 character hex string)
    if (id.match(/^[0-9a-fA-F]{24}$/)) {
      product = await Product.findById(id);
    } else {
      // If not ObjectId, search by productId field
      product = await Product.findOne({ productId: id });
    }
    
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    
    res.json(product);
  } catch (error) {
    console.error('Get product error:', error);
    
    if (error.kind === 'ObjectId') {
      return res.status(404).json({ message: 'Product not found' });
    }
    
    res.status(500).json({ message: 'Server error' });
  }
});

// Get product by productId (your custom ID)
router.get('/by-productId/:productId', async (req, res) => {
  try {
    const product = await Product.findOne({ productId: req.params.productId });
    
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    
    res.json(product);
  } catch (error) {
    console.error('Get product by productId error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get single product status with detailed info
router.get('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    
    let product;
    
    if (id.match(/^[0-9a-fA-F]{24}$/)) {
      product = await Product.findById(id);
    } else {
      product = await Product.findOne({ productId: id });
    }
    
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const now = new Date();
    const isReserved = product.inventoryStatus === 'reserved' && 
                      product.reservedUntil && 
                      now < product.reservedUntil;
    
    const isAvailable = product.inventoryStatus === 'available';

    res.json({
      _id: product._id,
      productId: product.productId,
      name: product.name,
      price: product.price,
      inventoryStatus: product.inventoryStatus,
      images: product.images,
      isSinglePiece: product.isSinglePiece,
      reservedUntil: product.reservedUntil,
      category: product.category,
      isAvailable: isAvailable,
      isReserved: isReserved,
      canBeReserved: isAvailable && product.isSinglePiece,
      timeLeft: isReserved ? Math.max(0, product.reservedUntil - now) : 0
    });
  } catch (error) {
    console.error('Get product status error:', error);
    res.status(500).json({ message: 'Failed to fetch product status' });
  }
});

// Check if product can be reserved (for real-time validation)
router.get('/:id/can-reserve', async (req, res) => {
  try {
    const { id } = req.params;
    
    let product;
    
    if (id.match(/^[0-9a-fA-F]{24}$/)) {
      product = await Product.findById(id);
    } else {
      product = await Product.findOne({ productId: id });
    }
    
    if (!product) {
      return res.json({ canReserve: false, reason: 'Product not found' });
    }

    const now = new Date();
    const canReserve = product.inventoryStatus === 'available' && 
                      product.isSinglePiece;

    if (!canReserve) {
      let reason = 'Product not available';
      if (product.inventoryStatus === 'sold') {
        reason = 'Product already sold';
      } else if (product.inventoryStatus === 'reserved') {
        if (product.reservedUntil && now < product.reservedUntil) {
          reason = 'Product is currently reserved';
        } else {
          reason = 'Product reservation expired, will be available soon';
        }
      } else if (!product.isSinglePiece) {
        reason = 'Product is not a single piece item';
      }
      
      return res.json({ canReserve: false, reason });
    }

    res.json({ 
      canReserve: true,
      productId: product._id,
      productIdCustom: product.productId,
      name: product.name,
      price: product.price
    });
  } catch (error) {
    console.error('Check reserve eligibility error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});


// Cleanup expired reservations (admin utility)
router.post('/cleanup-expired', async (req, res) => {
  try {
    const cleanedCount = await Product.cleanupExpiredReservations();
    
    res.json({
      message: `Cleaned up ${cleanedCount} expired reservations`,
      cleanedCount
    });
  } catch (error) {
    console.error('Cleanup expired reservations error:', error);
    res.status(500).json({ message: 'Server error during cleanup' });
  }
});

// Get product statistics (admin)
router.get('/admin/statistics', async (req, res) => {
  try {
    const totalProducts = await Product.countDocuments();
    const availableProducts = await Product.countDocuments({ inventoryStatus: 'available' });
    const reservedProducts = await Product.countDocuments({ inventoryStatus: 'reserved' });
    const soldProducts = await Product.countDocuments({ inventoryStatus: 'sold' });
    
    const categories = await Product.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          available: {
            $sum: { $cond: [{ $eq: ['$inventoryStatus', 'available'] }, 1, 0] }
          }
        }
      },
      { $sort: { count: -1 } }
    ]);

    res.json({
      total: totalProducts,
      available: availableProducts,
      reserved: reservedProducts,
      sold: soldProducts,
      categories
    });
  } catch (error) {
    console.error('Get product statistics error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;