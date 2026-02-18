// ======================================================
// State-driven architecture with sessions + negotiation control
// ======================================================

const fs = require('fs');
const https = require('https');
const express = require('express');
const { Server } = require('socket.io');
const cors = require('cors');
const os = require('os');

// ================= CONFIG =================

const PORT = 3000;

const sslOptions = {
  key: fs.readFileSync('./server.key'),
  cert: fs.readFileSync('./server.crt'),
};

// ================= SERVER SETUP =================

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.static('public'));

const server = https.createServer(sslOptions, app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ================= STATE =================

const users = new Map(); // socketId => { id, name }
const sessions = new Map(); // sessionId => { host, participants:Set }

// ================= HELPERS =================

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name in interfaces) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

function broadcastUserList() {
  io.emit('user-list', Array.from(users.values()));
}

function broadcastParticipants(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  io.to(sessionId).emit('participants-update', [...session.participants]);
}

// ===== NEGOTIATION CONTROLLER (PRODUCTION LEVEL) =====

function assignNegotiations(sessionId) {
  const room = io.sockets.adapter.rooms.get(sessionId);
  if (!room) return;

  const participants = Array.from(room);

  for (let i = 0; i < participants.length; i++) {
    for (let j = i + 1; j < participants.length; j++) {
      const a = participants[i];
      const b = participants[j];

      // deterministic negotiation assignment
      if (a < b) {
        io.to(a).emit('create-offer', { targetId: b });
      } else {
        io.to(b).emit('create-offer', { targetId: a });
      }
    }
  }
}

// ================= SOCKET LOGIC =================

io.on('connection', (socket) => {

  console.log('User connected:', socket.id);

  users.set(socket.id, {
    id: socket.id,
    name: `Unknown (${socket.id})`,
  });

  broadcastUserList();

  // REGISTER DEVICE
  socket.on('register-device', ({ name }) => {
    if (!name || typeof name !== 'string') return;

    users.set(socket.id, {
      id: socket.id,
      name: name.trim().slice(0, 30),
    });

    broadcastUserList();
  });

  // JOIN SESSION
  socket.on('join-session', ({ sessionId }) => {
    if (!sessionId) return;

    let session = sessions.get(sessionId);

    if (!session) {
      session = {
        host: socket.id,
        participants: new Set(),
      };
      sessions.set(sessionId, session);
    }

    session.participants.add(socket.id);

    socket.join(sessionId);

    broadcastParticipants(sessionId);

    // PRO negotiation assignment
    assignNegotiations(sessionId);
  });

  // INVITE PARTICIPANT
  socket.on('add-participant', ({ sessionId, targetId }) => {
    if (!sessionId || !targetId) return;

    io.to(targetId).emit('session-invite', {
      sessionId,
      from: socket.id,
    });
  });

  // WEBRTC SIGNAL RELAY
  socket.on('offer', ({ receiverId, offer }) => {
    if (!receiverId || !offer) return;

    io.to(receiverId).emit('offer', {
      senderId: socket.id,
      offer,
    });
  });

  socket.on('answer', ({ receiverId, answer }) => {
    if (!receiverId || !answer) return;

    io.to(receiverId).emit('answer', {
      senderId: socket.id,
      answer,
    });
  });

  socket.on('candidate', ({ receiverId, candidate }) => {
    if (!receiverId || !candidate) return;

    io.to(receiverId).emit('candidate', {
      senderId: socket.id,
      candidate,
    });
  });

  //Invite to Session
  socket.on('invite-to-session', ({ targetId, sessionId }) => {

  io.to(targetId).emit('session-invite', {
    from: socket.id,
    sessionId
  });

});

//Reject handling
socket.on('reject-invite', ({ targetId }) => {

  io.to(targetId).emit('invite-rejected', {
    userId: socket.id
  });

});


  // LEAVE SESSION
  socket.on('leave-session', ({ sessionId }) => {
    const session = sessions.get(sessionId);
    if (!session) return;

    session.participants.delete(socket.id);
    socket.leave(sessionId);

    io.to(sessionId).emit('participant-left', {
      userId: socket.id,
    });

    if (session.participants.size === 0) {
      sessions.delete(sessionId);
    } else {
      broadcastParticipants(sessionId);
      assignNegotiations(sessionId);
    }
  });

  // DISCONNECT HANDLER
  socket.on('disconnect', () => {

    console.log('User disconnected:', socket.id);

    users.delete(socket.id);

    // Force peers to close connections immediately
    io.emit('force-peer-close', {
      userId: socket.id,
    });

    // Remove from sessions
    for (const [sessionId, session] of sessions.entries()) {

      if (session.participants.has(socket.id)) {

        session.participants.delete(socket.id);

        io.to(sessionId).emit('participant-left', {
          userId: socket.id,
        });

        if (session.participants.size === 0) {
          sessions.delete(sessionId);
        } else {
          broadcastParticipants(sessionId);
          assignNegotiations(sessionId);
        }
      }
    }

    broadcastUserList();
  });
});

// ================= START SERVER =================

server.listen(PORT, () => {

  console.log('\n🚀 Production Intercom Server Ready');
  console.log(`Local: https://localhost:${PORT}`);

  getLocalIPs().forEach(ip => {
    console.log(`Network: https://${ip}:${PORT}`);
  });

});