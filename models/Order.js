const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  customer: {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    city: { type: String, required: true },
    address: { type: String, required: true },
    details: { type: String, default: '' }
  },
  items: [{
    id: { type: String, required: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 }
  }],
  total: { type: Number, required: true, min: 0 },
  payment: { type: String, default: 'Cash à la livraison' },
  status: { 
    type: String, 
    default: 'Nouvelle',
    enum: ['Nouvelle', 'Confirmée', 'En préparation', 'Expédiée', 'Livrée', 'Annulée'] 
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Order', orderSchema);
