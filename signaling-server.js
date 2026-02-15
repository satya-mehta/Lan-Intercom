const fs = require('fs');
const https = require('https');
const express = require('express');
const { Server } = require('socket.io');
const cors = require('cors');

const users = new Map(); // Maps socket.id to user info


// Load SSL certificate and private key
const options = {
  key: fs.readFileSync('./server.key'), 
  cert: fs.readFileSync('./server.crt'),
};

const app = express();
app.use(cors()); // Enable CORS
app.use(express.static('public')); // Serve static files

const server = https.createServer(options, app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});


const PORT = 3000;

const os = require('os');

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name in interfaces) {
    for (const iface of interfaces[name]) {

      // Only IPv4 + external interfaces
      if (iface.family === 'IPv4' && !iface.internal) {

        // Optional: filter common LAN ranges
        if (
          iface.address.startsWith('192.168.') ||
          iface.address.startsWith('10.') ||
          iface.address.startsWith('172.')
        ) {
          addresses.push(iface.address);
        }
      }
    }
  }

  return addresses;
}


const LOCAL_IP = getLocalIPs();

// const LOCAL_IP = '192.168.228.1';  // Hardcoded ip setting

// WebRTC signaling logic
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Default user registration with socket ID until name is provided
  users.set(socket.id, { id: socket.id, name: `Unknown (${socket.id})` });

  // Emit the updated user list to everyone
  io.emit('user-list', Array.from(users.values()));

  // Handle user registration with a name
  socket.on('register-device', ({ name }) => {
    if (name && typeof name === 'string') {
      users.set(socket.id, { id: socket.id, name });
      console.log(`User registered: ${name} (${socket.id})`);
      io.emit('user-list', Array.from(users.values())); // Broadcast updated list
    }
  });

  // Handle call initiation
socket.on('call-initiate', (data) => {

  if (!data || typeof data.targetId !== 'string') return;

  const caller = users.get(socket.id);
  const receiver = users.get(data.targetId);

  if (caller && receiver) {
    io.to(data.targetId).emit('incoming-call', {
      from: socket.id,
      name: caller.name
    });
  }
});


  // Handle call acceptance
  socket.on('call-accept', ({ from }) => {
    io.to(from).emit('call-accepted', { targetId: socket.id });
  });

  // Handle call rejection
  socket.on('call-reject', ({ from }) => {
    io.to(from).emit('call-rejected', { targetId: socket.id });
  });

  // Relay WebRTC events (offer, answer, ICE candidates)
  socket.on('offer', ({ offer, receiverId }) => {
    io.to(receiverId).emit('offer', { offer, senderId: socket.id });
  });

  socket.on('answer', ({ answer, receiverId }) => {
    io.to(receiverId).emit('answer', { answer, senderId: socket.id });
  });

  socket.on('candidate', ({ candidate, receiverId }) => {
    io.to(receiverId).emit('candidate', { candidate, senderId: socket.id });
  });

  // Handle disconnections
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    users.delete(socket.id); // Remove the user
    io.emit('user-list', Array.from(users.values())); // Notify remaining users
  });
});

server.listen(PORT, () => {

  console.log(`\nServer running:`);

  // Local access
  console.log(`Local:   https://localhost:${PORT}`);

  // Network access
  const ips = getLocalIPs();

  ips.forEach(ip => {
    console.log(`Network: https://${ip}:${PORT}`);
  });

});



