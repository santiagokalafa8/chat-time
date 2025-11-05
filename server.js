require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'postgres',
  password: '0000',
  port: 5432,
});

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

function verifyToken(req, res, next) {
  const token = req.headers['authorization'];
  if (!token) return res.status(403).json({ error: 'Token requerido' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'clave_insegura');
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Token inválido' });
  }
}

app.post('/api/register', async (req, res) => {
  try {
    const { email, password, nickname } = req.body;

    if (!email || !password || !nickname) {
      return res.status(400).json({ error: 'Campos requeridos' });
    }

    const gmailRegex = /^[a-zA-Z0-9._%+-]+@gmail\.com$/;
    if (!gmailRegex.test(email)) {
      return res.status(400).json({ error: 'Solo se permiten correos de Gmail válidos' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (email, password_hash, nickname) VALUES ($1, $2, $3)',
      [email, passwordHash, nickname]
    );

    res.json({ success: true });
  } catch (err) {
    if (err.code === '23505') {
      // Código de error de PostgreSQL para violación de restricción UNIQUE
      return res.status(400).json({ error: 'El correo ya está registrado' });
    }

    console.error('❌ Error en registro:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Campos requeridos' });

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user) return res.status(400).json({ error: 'Usuario no encontrado' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Contraseña incorrecta' });

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'clave_insegura');
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.post('/api/favorites', verifyToken, async (req, res) => {

  const userId = req.user.id;
  const { favoriteId } = req.body;

  console.log('🧪 Intentando guardar favorito:', { userId, favoriteId });

  if (!favoriteId) return res.status(400).json({ error: 'Falta el ID del favorito' });

  try {
    // Verificar que el usuario favorito exista
    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [favoriteId]);
    if (userCheck.rows.length === 0) {
      return res.status(400).json({ error: 'El usuario favorito no existe' });
    }

    // Verificar si ya está guardado
    const existing = await pool.query(
      'SELECT * FROM favorites WHERE user_id = $1 AND favorite_id = $2',
      [userId, favoriteId]
    );

    if (existing.rows.length > 0) {
      return res.status(200).json({ success: true, message: 'Ya estaba guardado' });
    }

    // Guardar favorito
    await pool.query(
      'INSERT INTO favorites (user_id, favorite_id) VALUES ($1, $2)',
      [userId, favoriteId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error al guardar favorito:', err.message);
    res.status(500).json({ error: 'No se pudo guardar el favorito' });
  }
});



app.get('/api/favorites', verifyToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT u.id, u.nickname, f.saved_at
       FROM favorites f
       JOIN users u ON u.id = f.favorite_id
       WHERE f.user_id = $1
       ORDER BY f.saved_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener favoritos:', err);
    res.status(500).json({ error: 'No se pudo obtener favoritos' });
  }
});


app.delete('/api/favorites/:id', verifyToken, async (req, res) => {
    const userId = req.user.id;
    const favoriteIdToDelete = req.params.id; 

    if (!favoriteIdToDelete) {
        return res.status(400).json({ error: 'Falta el ID del favorito a eliminar' });
    }

    try {
        console.log('Parámetros DELETE:', [userId, favoriteIdToDelete]); // ⬅️ NUEVA LÍNEA
        const result = await pool.query(
            'DELETE FROM favorites WHERE user_id = $1 AND favorite_id = $2 RETURNING *',
            [userId, favoriteIdToDelete]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Favorito no encontrado o no autorizado' });
        }

        res.json({ success: true, message: 'Favorito eliminado' });
    } catch (err) {
        console.error('❌ Error al eliminar favorito:', err.message);
        res.status(500).json({ error: 'No se pudo eliminar el favorito' });
    }
});

app.post('/api/favorites/status', verifyToken, async (req, res) => {
    // favorites: un array de IDs de usuario [1, 5, 8]
    const { favoriteIds } = req.body; 

    if (!Array.isArray(favoriteIds) || favoriteIds.length === 0) {
        return res.json({});
    }

    // Mapear los IDs de usuario a sus estados (online/offline)
    const statusMap = {};
    favoriteIds.forEach(id => {
        // Verificamos si el ID de usuario existe en nuestro mapa de onlineUsers
        statusMap[id] = onlineUsers.has(id) ? 'online' : 'offline';
    });
    
    res.json(statusMap);
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Token requerido'));

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'clave_insegura');
    socket.userId = payload.id;
    next();
  } catch (err) {
    next(new Error('Token inválido'));
  }
});

const waitingUsers = [];
const onlineUsers = new Map();

function removeFromWaiting(socket) {
  const index = waitingUsers.findIndex(s => s.id === socket.id);
  if (index !== -1) waitingUsers.splice(index, 1);
}

function tryPairRandomUsers() {
  waitingUsers.sort(() => Math.random() - 0.5);
  while (waitingUsers.length > 1) {
    const firstUser = waitingUsers.shift();
    const secondUser = waitingUsers.shift();

    firstUser.partnerId = secondUser.id;
    secondUser.partnerId = firstUser.id;

    firstUser.partnerUserId = secondUser.userId;
    secondUser.partnerUserId = firstUser.userId;

    firstUser.emit('paired', {
      partnerId: secondUser.id,
      partnerUserId: secondUser.userId
    });

    secondUser.emit('paired', {
      partnerId: firstUser.id,
      partnerUserId: firstUser.userId
    });
  }
}

io.on('connection', (socket) => {
  console.log('Conectado:', socket.id);
  onlineUsers.set(socket.userId, socket.id);

  if (!waitingUsers.find(s => s.id === socket.id)) {
    waitingUsers.push(socket);
    tryPairRandomUsers();
  }

  socket.on('offer', (offer, to) => {
    if (socket.partnerId === to) io.to(to).emit('offer', offer, socket.id);
  });

  socket.on('answer', (answer, to) => {
    if (socket.partnerId === to) io.to(to).emit('answer', answer);
  });

  socket.on('ice-candidate', (candidate, to) => {
    if (socket.partnerId === to) io.to(to).emit('ice-candidate', candidate);
  });

  socket.on('next-call', () => {
    if (socket.partnerId) {
      io.to(socket.partnerId).emit('partner-disconnected');
      const partnerSocket = io.sockets.sockets.get(socket.partnerId);
      if (partnerSocket) partnerSocket.partnerId = null;
      socket.partnerId = null;
    }

    if (!waitingUsers.find(s => s.id === socket.id)) {
      waitingUsers.push(socket);
    }

    tryPairRandomUsers();
  });

  socket.on('end-call', (to) => {
    if (to && socket.partnerId === to) {
      io.to(to).emit('partner-disconnected');
      const partnerSocket = io.sockets.sockets.get(to);
      if (partnerSocket) partnerSocket.partnerId = null;
    }

    socket.partnerId = null;
  });

  socket.on('disconnect', () => {
    console.log('Desconectado:', socket.id);
    removeFromWaiting(socket);
    onlineUsers.delete(socket.userId);
    if (socket.partnerId) {
      io.to(socket.partnerId).emit('partner-disconnected');
      const partnerSocket = io.sockets.sockets.get(socket.partnerId);
      if (partnerSocket) partnerSocket.partnerId = null;
    }
  });
  socket.on('direct-call', (targetUserId) => {
    const targetSocketId = onlineUsers.get(targetUserId);

    if (targetSocketId && !socket.partnerId && !io.sockets.sockets.get(targetSocketId).partnerId) {
      // Marcar como emparejados temporalmente (solo para la llamada)
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      
      socket.partnerId = targetSocketId;
      targetSocket.partnerId = socket.id;
      
      socket.partnerUserId = targetUserId;
      targetSocket.partnerUserId = socket.userId;

      // Notificar a ambos que están emparejados (con sus IDs de usuario)
      socket.emit('paired', { partnerId: targetSocketId, partnerUserId: targetUserId });
      targetSocket.emit('paired', { partnerId: socket.id, partnerUserId: socket.userId });

      // El iniciador de la llamada creará la conexión Peer (ver app.js)
      socket.emit('start-direct-call'); 
      
      // Remover de la lista de espera (si estaban allí)
      removeFromWaiting(socket);
      removeFromWaiting(targetSocket);
      
      console.log(`📞 Llamada directa iniciada: ${socket.userId} -> ${targetUserId}`);

    } else if (targetSocketId) {
      socket.emit('call-failed', { reason: 'busy' });
    } else {
      socket.emit('call-failed', { reason: 'offline' });
    }
  });
});

server.listen(3000, () => {
  console.log('Servidor corriendo en http://localhost:3000');
});