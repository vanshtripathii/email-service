const express = require('express');
const { auth } = require('../middleware/auth');
const Cart = require('../models/Cart');
const Product = require('../models/Product');

const router = express.Router();

// FIX: add findOrCreate if not defined in model
Cart.findOrCreate = Cart.findOrCreate || async function (userId) {
  let cart = await Cart.findOne({ userId });
  if (!cart) cart = new Cart({ userId, items: [] });
  return cart;
};

// Get user cart
router.get('/items', auth, async (req, res) => {
  try {
    const cart = await Cart.findOrCreate(req.user.id);
    res.json(cart);
  } catch (error) {
    console.error('Get cart error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Add item to cart
router.post('/add', auth, async (req, res) => {
  try {
    const { productId, name, price, image } = req.body;

    console.log('Adding to cart:', { productId, name, price });

    if (!productId || !name || price === undefined) {
      return res.status(400).json({
        message: 'Product ID, name, and price are required'
      });
    }

    if (productId.toString().trim().length === 0) {
      return res.status(400).json({ message: 'Invalid product ID' });
    }

    const product = await Product.findOne({
      $or: [
        { _id: productId.toString().trim() },
        { productId: productId.toString().trim() }
      ]
    });

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const cart = await Cart.findOrCreate(req.user.id);

    cart.addItem({
      productId: productId,
      name: name,
      price: price,
      image: image,
      productRef: product._id
    });

    await cart.save();

    res.json({
      success: true,
      cart: cart,
      message: 'Product added to cart'
    });

  } catch (error) {
    console.error('Add to cart error:', error);

    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors
      });
    }

    res.status(500).json({ message: 'Server error' });
  }
});

// Update cart items
router.put('/items', auth, async (req, res) => {
  try {
    const { items } = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({ message: 'Items must be an array' });
    }

    const cart = await Cart.findOrCreate(req.user.id);

    const validItems = items.filter(item =>
      item &&
      item.productId &&
      item.productId.toString().trim().length > 0 &&
      item.name &&
      item.price !== undefined &&
      item.quantity > 0
    ).map(item => ({
      productId: item.productId.toString().trim(),
      name: item.name,
      price: parseFloat(item.price),
      image: item.image || '',
      quantity: parseInt(item.quantity)
    }));

    cart.items = validItems;
    await cart.save();

    res.json(cart);

  } catch (error) {
    console.error('Update cart error:', error);

    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors
      });
    }

    res.status(500).json({ message: 'Server error' });
  }
});

// Remove item from cart
// FIXED: Delete item from cart
router.delete('/:productId', auth, async (req, res) => {
  try {
    const { productId } = req.params;
    const userId = req.user.id;

    console.log('Removing item from cart:', { userId, productId });

    // Find user's cart
    let cart = await Cart.findOne({ userId });
    
    if (!cart) {
      return res.status(404).json({ message: 'Cart not found' });
    }

    // Remove the item from cart items array
    // Match by both productId string and converted string
    cart.items = cart.items.filter(item => {
      const itemProductId = item.productId ? item.productId.toString().trim() : '';
      const searchProductId = productId ? productId.toString().trim() : '';
      return itemProductId !== searchProductId;
    });
    
    // Save the updated cart
    await cart.save();

    console.log('Item removed from cart successfully');

    res.json({
      success: true,
      message: 'Item removed from cart',
      cart: cart
    });

  } catch (error) {
    console.error('Remove from cart error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to remove item from cart',
      error: error.message 
    });
  }
});

// Update item quantity
router.put('/items/:productId/quantity', auth, async (req, res) => {
  try {
    const { productId } = req.params;
    const { quantity } = req.body;

    if (!productId || productId.toString().trim().length === 0) {
      return res.status(400).json({ message: 'Invalid product ID' });
    }

    if (!quantity || quantity < 1) {
      return res.status(400).json({ message: 'Quantity must be at least 1' });
    }

    const cart = await Cart.findOrCreate(req.user.id);

    const updated = cart.updateQuantity(productId, quantity);

    if (!updated) {
      return res.status(404).json({ message: 'Item not found in cart' });
    }

    await cart.save();

    res.json({
      success: true,
      cart: cart,
      message: 'Quantity updated successfully'
    });

  } catch (error) {
    console.error('Update quantity error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Clear entire cart
router.delete('/clear', auth, async (req, res) => {
  try {
    const cart = await Cart.findOrCreate(req.user.id);

    cart.clearCart();
    await cart.save();

    res.json({
      success: true,
      cart: cart,
      message: 'Cart cleared successfully'
    });

  } catch (error) {
    console.error('Clear cart error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get cart summary
router.get('/summary', auth, async (req, res) => {
  try {
    const cart = await Cart.findOrCreate(req.user.id);
    const summary = cart.getSummary();

    res.json({
      success: true,
      summary: summary
    });

  } catch (error) {
    console.error('Get cart summary error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
