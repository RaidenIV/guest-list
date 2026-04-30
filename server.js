const express = require('express');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'xmg_guest_lists';
const collectionName = process.env.COLLECTION_NAME || 'guest_lists';
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

let client;
let collection;

app.use(express.json({ limit: '2mb' }));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

async function getCollection() {
  if (!mongoUri) throw new Error('MONGODB_URI is not configured.');
  if (!client) {
    client = new MongoClient(mongoUri);
    await client.connect();
    collection = client.db(dbName).collection(collectionName);
    await collection.createIndex({ updatedAt: -1 });
    await collection.createIndex({ name: 1 });
  }
  return collection;
}

function cleanString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

app.get('/api/health', async (req, res) => {
  try {
    await getCollection();
    res.json({ ok: true, connected: true, dbName, collectionName });
  } catch (err) {
    res.status(500).json({ ok: false, connected: false, error: err.message });
  }
});

app.get('/api/guest-lists', async (req, res) => {
  try {
    const col = await getCollection();
    const items = await col.find({}, { projection: { data: 0 } }).sort({ updatedAt: -1 }).limit(100).toArray();
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/guest-lists', async (req, res) => {
  try {
    const col = await getCollection();
    const data = req.body?.data;
    if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Missing guest list data.' });
    const now = new Date();
    const doc = {
      name: cleanString(req.body.name, cleanString(data.showName, 'Guest List')) || 'Guest List',
      showName: cleanString(req.body.showName, cleanString(data.showName)),
      date: cleanString(req.body.date, cleanString(data.date)),
      headliner: cleanString(req.body.headliner, cleanString(data.headliner)),
      data,
      createdAt: now,
      updatedAt: now
    };
    const result = await col.insertOne(doc);
    res.status(201).json({ item: { ...doc, _id: result.insertedId } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/guest-lists/:id', async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid guest list id.' });
    const col = await getCollection();
    const item = await col.findOne({ _id: new ObjectId(req.params.id) });
    if (!item) return res.status(404).json({ error: 'Guest list not found.' });
    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/guest-lists/:id', async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid guest list id.' });
    const col = await getCollection();
    await col.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'guest_list.html')));

app.listen(port, () => console.log(`Guest List Generator running on port ${port}`));

process.on('SIGINT', async () => {
  if (client) await client.close();
  process.exit(0);
});
