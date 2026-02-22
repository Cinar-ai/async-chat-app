const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose'); // MongoDB için eklendi
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// --- MONGODB BAĞLANTISI ---
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ ASYNC: MongoDB Bulut Bağlantısı Başarılı!'))
  .catch(err => console.error('❌ MongoDB Bağlantı Hatası:', err));

// --- VERİ MODELLERİ (Şemalar) ---
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const MessageSchema = new mongoose.Schema({
  sender: String,
  text: String,
  timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);

const JWT_SECRET = process.env.JWT_SECRET || 'gizli-anahtar';

// --- API ENDPOINTLERİ ---

// Kayıt Ol
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const existingUser = await User.findOne({ email });
    
    if (existingUser) return res.status(400).json({ error: 'Bu email zaten kayıtlı.' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ name, email, password: hashedPassword });
    await user.save();

    const token = jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, name, email } });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Giriş Yap
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ error: 'Geçersiz bilgiler.' });
    }

    const token = jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email } });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Eski Mesajları Getir
app.get('/api/messages', async (req, res) => {
  const messages = await Message.find().sort({ timestamp: 1 });
  res.json(messages);
});

// --- REAL-TIME BAĞLANTISI (SOCKET.IO) ---
const onlineUsers = new Map();

io.on('connection', (socket) => {
  console.log('Kullanıcı bağlandı:', socket.id);

  socket.on('user:join', (userData) => {
    onlineUsers.set(socket.id, userData);
    io.emit('users:update', Array.from(onlineUsers.values()));
  });

  socket.on('message:send', async (messageData) => {
    const message = new Message({
      sender: messageData.sender,
      text: messageData.text
    });
    await message.save(); // Mesajı MongoDB'ye kalıcı kaydet
    io.emit('message:receive', message);
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    io.emit('users:update', Array.from(onlineUsers.values()));
  });
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});