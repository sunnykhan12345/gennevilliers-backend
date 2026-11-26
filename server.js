const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
require('dotenv').config();

const Product = require('./models/Product');
const Order = require('./models/Order');
const Admin = require('./models/Admin');
const Setting = require('./models/Setting');
const authMiddleware = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/gennevilliers';

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static uploads folder
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
app.use('/uploads', express.static(UPLOADS_DIR));

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
    cb(null, uniqueName);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/jpeg|jpg|png|webp|svg/i.test(path.extname(file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error('Format d’image non supporté (JPEG, PNG, WEBP, SVG uniquement).'));
    }
  }
});

// Database Connection with graceful fallback
let dbConnected = false;
mongoose.connect(MONGODB_URI)
  .then(() => {
    dbConnected = true;
    console.log('✓ Connecté à MongoDB avec succès sur', MONGODB_URI);
  })
  .catch((err) => {
    console.warn('⚠️ Avertissement MongoDB :', err.message);
    console.warn('Mode JSON actif en secours.');
  });

// JSON fallback file paths
const DATA_DIR = path.join(__dirname, '..', 'gennevilliers-shop', 'data');
const PRODUCTS_JSON = path.join(DATA_DIR, 'products.json');
const ORDERS_JSON = path.join(DATA_DIR, 'orders.json');

function readJson(file, fallback = []) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Erreur écriture JSON:', err);
  }
}

// ==========================================
// PUBLIC API ROUTES
// ==========================================

// 1. Get all published products
app.get('/api/products', async (req, res) => {
  try {
    if (dbConnected) {
      const { cat, q, sort } = req.query;
      let filter = { published: true };
      if (cat && cat !== 'all') filter.cat = cat;
      if (q) {
        filter.$or = [
          { name: { $regex: q, $options: 'i' } },
          { desc: { $regex: q, $options: 'i' } },
          { specs: { $regex: q, $options: 'i' } }
        ];
      }
      let query = Product.find(filter);
      if (sort === 'low') query = query.sort({ price: 1 });
      else if (sort === 'high') query = query.sort({ price: -1 });
      else query = query.sort({ featured: -1, createdAt: -1 });

      const products = await query.exec();
      return res.json(products);
    } else {
      const products = readJson(PRODUCTS_JSON, []);
      return res.json(products);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Get single product by id
app.get('/api/products/:id', async (req, res) => {
  try {
    if (dbConnected) {
      const product = await Product.findOne({ id: req.params.id });
      if (!product) return res.status(404).json({ error: 'Produit introuvable.' });
      return res.json(product);
    } else {
      const products = readJson(PRODUCTS_JSON, []);
      const p = products.find(x => x.id === req.params.id);
      if (!p) return res.status(404).json({ error: 'Produit introuvable.' });
      return res.json(p);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Create Cash-on-Delivery order
app.post('/api/orders', async (req, res) => {
  try {
    const { customer, items } = req.body;
    if (!customer?.name || !customer?.phone || !customer?.city || !customer?.address || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'Coordonnées de livraison et panier requis.' });
    }

    const orderId = 'GN-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.floor(1000 + Math.random() * 9000);

    let lines = [];
    let total = 0;

    if (dbConnected) {
      for (const item of items) {
        const p = await Product.findOne({ id: item.id });
        if (!p) return res.status(400).json({ error: `Article introuvable (${item.id})` });
        const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));
        if (p.stock < qty) return res.status(409).json({ error: `Stock insuffisant pour ${p.name}` });
        
        // Decrement stock
        p.stock -= qty;
        await p.save();

        lines.push({
          id: p.id,
          name: p.name,
          quantity: qty,
          price: p.price
        });
        total += p.price * qty;
      }

      const order = new Order({
        id: orderId,
        customer: {
          name: customer.name.trim(),
          phone: customer.phone.trim(),
          city: customer.city.trim(),
          address: customer.address.trim(),
          details: (customer.details || '').trim()
        },
        items: lines,
        total,
        payment: 'Cash à la livraison',
        status: 'Nouvelle'
      });

      await order.save();
      return res.status(201).json(order);
    } else {
      const products = readJson(PRODUCTS_JSON, []);
      const orders = readJson(ORDERS_JSON, []);

      for (const item of items) {
        const p = products.find(x => x.id === item.id);
        if (!p) return res.status(400).json({ error: 'Article introuvable' });
        const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));
        if (p.stock < qty) return res.status(409).json({ error: `Stock insuffisant pour ${p.name}` });
        p.stock -= qty;
        lines.push({ id: p.id, name: p.name, quantity: qty, price: p.price });
        total += p.price * qty;
      }

      writeJson(PRODUCTS_JSON, products);
      const order = {
        id: orderId,
        createdAt: new Date().toISOString(),
        customer: {
          name: customer.name.trim(),
          phone: customer.phone.trim(),
          city: customer.city.trim(),
          address: customer.address.trim(),
          details: (customer.details || '').trim()
        },
        items: lines,
        total,
        payment: 'Cash à la livraison',
        status: 'Nouvelle'
      };
      orders.unshift(order);
      writeJson(ORDERS_JSON, orders);
      return res.status(201).json(order);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Get public settings
app.get('/api/settings', async (req, res) => {
  try {
    if (dbConnected) {
      const settings = await Setting.find();
      const map = {};
      settings.forEach(s => map[s.key] = s.value);
      return res.json(map);
    } else {
      return res.json({
        phone: '06 14 09 59 99',
        whatsapp: '+212614095999',
        email: 'rachid@gennevilliers.mav'
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// ADMIN AUTHENTICATION
// ==========================================

app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Identifiant et mot de passe requis.' });
    }

    if (dbConnected) {
      const admin = await Admin.findOne({ username });
      if (!admin) {
        return res.status(401).json({ error: 'Identifiants invalides.' });
      }
      const isMatch = await admin.comparePassword(password);
      if (!isMatch) {
        return res.status(401).json({ error: 'Identifiants invalides.' });
      }

      const token = jwt.sign(
        { id: admin._id, username: admin.username },
        process.env.JWT_SECRET || 'fallback_secret',
        { expiresIn: '7d' }
      );

      return res.json({
        token,
        admin: { username: admin.username }
      });
    } else {
      // Fallback auth
      const validUser = process.env.ADMIN_USERNAME || 'admin';
      const validPass = process.env.ADMIN_PASSWORD || 'Gennevilliers2026!';
      if (username === validUser && password === validPass) {
        const token = jwt.sign(
          { username },
          process.env.JWT_SECRET || 'fallback_secret',
          { expiresIn: '7d' }
        );
        return res.json({ token, admin: { username } });
      }
      return res.status(401).json({ error: 'Identifiants invalides.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/me', authMiddleware, async (req, res) => {
  res.json({ admin: req.admin });
});

// ==========================================
// ADMIN DASHBOARD & CRUD (PROTECTED)
// ==========================================

// 1. Dashboard Metrics
app.get('/api/admin/metrics', authMiddleware, async (req, res) => {
  try {
    if (dbConnected) {
      const [totalProducts, pcCount, totalOrders, pendingOrders, lowStock] = await Promise.all([
        Product.countDocuments(),
        Product.countDocuments({ cat: 'pc' }),
        Order.countDocuments(),
        Order.countDocuments({ status: { $in: ['Nouvelle', 'Confirmée', 'En préparation'] } }),
        Product.countDocuments({ stock: { $lt: 3 } })
      ]);

      return res.json({
        totalProducts,
        pcCount,
        totalOrders,
        pendingOrders,
        lowStock
      });
    } else {
      const products = readJson(PRODUCTS_JSON, []);
      const orders = readJson(ORDERS_JSON, []);
      return res.json({
        totalProducts: products.length,
        pcCount: products.filter(p => p.cat === 'pc').length,
        totalOrders: orders.length,
        pendingOrders: orders.filter(o => ['Nouvelle', 'Confirmée', 'En préparation'].includes(o.status)).length,
        lowStock: products.filter(p => (Number(p.stock) || 0) < 3).length
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Admin Products CRUD
app.get('/api/admin/products', authMiddleware, async (req, res) => {
  try {
    if (dbConnected) {
      const products = await Product.find().sort({ createdAt: -1 });
      return res.json(products);
    } else {
      return res.json(readJson(PRODUCTS_JSON, []));
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/products', authMiddleware, async (req, res) => {
  try {
    const data = req.body;
    if (!data.name || !data.cat || Number(data.price) < 0) {
      return res.status(400).json({ error: 'Nom, catégorie et prix valide obligatoires.' });
    }

    const id = (data.id || data.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));

    if (dbConnected) {
      const exists = await Product.findOne({ id });
      if (exists) return res.status(409).json({ error: 'Cet identifiant de produit existe déjà.' });

      const product = new Product({ ...data, id });
      await product.save();
      return res.status(201).json(product);
    } else {
      const products = readJson(PRODUCTS_JSON, []);
      if (products.some(p => p.id === id)) return res.status(409).json({ error: 'Cet identifiant existe déjà.' });
      const newP = { ...data, id };
      products.unshift(newP);
      writeJson(PRODUCTS_JSON, products);
      return res.status(201).json(newP);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/products/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const data = req.body;

    if (dbConnected) {
      const query = /^[0-9a-fA-F]{24}$/.test(id) ? { $or: [{ _id: id }, { id }] } : { id };
      const product = await Product.findOneAndUpdate(query, data, { new: true });
      if (!product) return res.status(404).json({ error: 'Produit introuvable.' });
      return res.json(product);
    } else {
      const products = readJson(PRODUCTS_JSON, []);
      const idx = products.findIndex(p => p.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Produit introuvable.' });
      products[idx] = { ...products[idx], ...data };
      writeJson(PRODUCTS_JSON, products);
      return res.json(products[idx]);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/products/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    if (dbConnected) {
      const query = /^[0-9a-fA-F]{24}$/.test(id) ? { $or: [{ _id: id }, { id }] } : { id };
      const product = await Product.findOneAndDelete(query);
      if (!product) return res.status(404).json({ error: 'Produit introuvable.' });
      return res.json({ ok: true });
    } else {
      let products = readJson(PRODUCTS_JSON, []);
      const next = products.filter(p => p.id !== id);
      if (next.length === products.length) return res.status(404).json({ error: 'Produit introuvable.' });
      writeJson(PRODUCTS_JSON, next);
      return res.json({ ok: true });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Admin Orders Management
app.get('/api/admin/orders', authMiddleware, async (req, res) => {
  try {
    if (dbConnected) {
      const orders = await Order.find().sort({ createdAt: -1 });
      return res.json(orders);
    } else {
      return res.json(readJson(ORDERS_JSON, []));
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/orders/:id', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    const validStates = ['Nouvelle', 'Confirmée', 'En préparation', 'Expédiée', 'Livrée', 'Annulée'];
    if (!validStates.includes(status)) {
      return res.status(400).json({ error: 'Statut de commande invalide.' });
    }

    if (dbConnected) {
      const order = await Order.findOneAndUpdate({ id: req.params.id }, { status }, { new: true });
      if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
      return res.json(order);
    } else {
      const orders = readJson(ORDERS_JSON, []);
      const order = orders.find(o => o.id === req.params.id);
      if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
      order.status = status;
      writeJson(ORDERS_JSON, orders);
      return res.json(order);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Image Upload Endpoint
app.post('/api/admin/upload', authMiddleware, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Aucun fichier fourni.' });
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ url: fileUrl, filename: req.file.filename });
});

// 5. Update Website Content Settings
app.put('/api/admin/settings', authMiddleware, async (req, res) => {
  try {
    const settings = req.body; // { key: value, ... }
    if (dbConnected) {
      for (const [key, value] of Object.entries(settings)) {
        await Setting.findOneAndUpdate({ key }, { key, value }, { upsert: true });
      }
      return res.json({ ok: true, settings });
    } else {
      return res.json({ ok: true, settings });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start Server (local only — Vercel uses module.exports = app)
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`✓ Serveur Express démarré sur http://localhost:${PORT}`);
  });
}

module.exports = app;
