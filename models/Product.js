const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  cat: { 
    type: String, 
    required: true, 
    enum: ['pc', 'accessoires', 'reparation', 'materiel', 'digital'] 
  },
  price: { type: Number, required: true, min: 0 },
  desc: { type: String, default: '' },
  specs: { type: String, default: '' },
  condition: { type: String, default: '' }, // 'A' | 'B' | 'C'
  stock: { type: Number, default: 1, min: 0 },
  badge: { type: String, default: '' },
  photo: { type: String, required: true },
  tone: { type: String, default: '#f4f3f0' },
  featured: { type: Boolean, default: false },
  published: { type: Boolean, default: true }
}, {
  timestamps: true
});

module.exports = mongoose.model('Product', productSchema);
