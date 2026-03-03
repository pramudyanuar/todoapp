const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

// Track connected clients
const connectedClients = new Map();

// Load messages from file
const messagesFile = path.join(__dirname, 'messages.json');
let messageHistory = [];

function loadMessages() {
  try {
    if (fs.existsSync(messagesFile)) {
      const data = fs.readFileSync(messagesFile, 'utf8');
      messageHistory = JSON.parse(data);
    }
  } catch (error) {
    console.log('No previous messages found');
    messageHistory = [];
  }
}

function saveMessages() {
  try {
    fs.writeFileSync(messagesFile, JSON.stringify(messageHistory, null, 2));
  } catch (error) {
    console.error('Error saving messages:', error);
  }
}

// Load existing messages
loadMessages();

// Secret codes untuk authentication
const SECRET_CODES = {
  '0907': { username: 'bot 1', userId: 1 },
  '0701': { username: 'bot 2', userId: 2 }
};

wss.on('connection', (ws) => {
  let authenticatedUser = null;
  let messageBuffer = [];

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'welcome',
    message: 'Masukkan secret code untuk login'
  }));

  ws.on('message', (rawMessage) => {
    try {
      const data = JSON.parse(rawMessage);

      // Handle authentication
      if (data.type === 'auth') {
        const code = data.code.toString();
        const userInfo = SECRET_CODES[code];

        if (!userInfo) {
          ws.send(JSON.stringify({
            type: 'auth-error',
            message: 'Secret code salah!'
          }));
          return;
        }

        // Check if user already connected
        let userAlreadyConnected = false;
        connectedClients.forEach((client) => {
          if (client.userId === userInfo.userId && client.ws.readyState === WebSocket.OPEN) {
            userAlreadyConnected = true;
          }
        });

        if (userAlreadyConnected) {
          ws.send(JSON.stringify({
            type: 'auth-error',
            message: `${userInfo.username} sudah terhubung di device lain!`
          }));
          ws.close();
          return;
        }

        authenticatedUser = userInfo;
        connectedClients.set(ws, userInfo);

        console.log(`${userInfo.username} logged in`);

        // Send auth success dan message history
        ws.send(JSON.stringify({
          type: 'auth-success',
          username: userInfo.username,
          userId: userInfo.userId,
          totalUsers: connectedClients.size,
          messageHistory: messageHistory
        }));

        // Notify other users
        broadcast({
          type: 'user-joined',
          username: userInfo.username,
          timestamp: new Date().toISOString(),
          totalUsers: connectedClients.size
        });

        return;
      }

      // Handle chat messages (only after authenticated)
      if (!authenticatedUser) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Harus login terlebih dahulu'
        }));
        return;
      }

      if (data.type === 'message') {
        const messageData = {
          type: 'message',
          username: authenticatedUser.username,
          userId: authenticatedUser.userId,
          text: data.text,
          timestamp: new Date().toISOString()
        };

        // Save to history
        messageHistory.push(messageData);
        saveMessages();

        // Broadcast ke semua
        broadcast(messageData);
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  });

  ws.on('close', () => {
    if (authenticatedUser) {
      console.log(`${authenticatedUser.username} disconnected`);
      connectedClients.delete(ws);
      broadcast({
        type: 'user-left',
        username: authenticatedUser.username,
        timestamp: new Date().toISOString(),
        totalUsers: connectedClients.size
      });
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Helper function to broadcast to all connected clients
function broadcast(data) {
  connectedClients.forEach((client, ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
  console.log(`Messages loaded: ${messageHistory.length}`);
});
