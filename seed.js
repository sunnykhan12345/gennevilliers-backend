const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const Product = require('./models/Product');
const Admin = require('./models/Admin');
const Setting = require('./models/Setting');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/gennevilliers';

async function seed() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connecté à MongoDB pour le seeding.');

    // 1. Seed Admin
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'Gennevilliers2026!';
    
    let admin = await Admin.findOne({ username: adminUser });
    if (!admin) {
      admin = new Admin({ username: adminUser, password: adminPass });
      await admin.save();
      console.log(`✓ Administrateur créé: ${adminUser}`);
    } else {
      console.log(`✓ Administrateur existant: ${adminUser}`);
    }

    // 2. Seed Products
    const productsPath = path.join(__dirname, '..', 'gennevilliers-shop', 'data', 'products.json');
    if (fs.existsSync(productsPath)) {
      const data = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
      const count = await Product.countDocuments();
      if (count === 0) {
        for (const item of data) {
          await Product.create({
            ...item,
            featured: item.cat === 'pc' || item.id === 'gan-65w' || item.id === 'station-3in1',
            published: true
          });
        }
        console.log(`✓ ${data.length} produits insérés dans MongoDB.`);
      } else {
        console.log(`✓ Le catalogue contient déjà ${count} produits.`);
      }
    }

    // 3. Seed Default Website Settings
    const defaultSettings = [
      { key: 'announcement_fr', value: 'Gennevilliers Casablanca · PC Reconditionnés · Accessoires certifiés · Réparation · Coworking' },
      { key: 'announcement_en', value: 'Gennevilliers Casablanca · Certified Refurbished PCs · Fast Chargers · Screen Repair · Coworking' },
      { key: 'phone', value: '06 14 09 59 99' },
      { key: 'whatsapp', value: '+212614095999' },
      { key: 'email', value: 'rachid@gennevilliers.mav' },
      { key: 'address', value: '13 rue Maarakat Ouhoud, ex Maréchal, Casablanca 20080 · Maroc' }
    ];

    for (const s of defaultSettings) {
      await Setting.findOneAndUpdate({ key: s.key }, s, { upsert: true });
    }
    console.log('✓ Paramètres du site initialisés.');

    console.log('Seeding terminé avec succès.');
    process.exit(0);
  } catch (err) {
    console.error('Erreur lors du seeding:', err);
    process.exit(1);
  }
}

seed();
