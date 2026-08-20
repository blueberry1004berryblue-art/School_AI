const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let localClient = null;

// 学校のPCからのアクセスを受け取る窓口
app.use((req, res) => {
  if (!localClient || localClient.readyState !== WebSocket.OPEN) {
    return res.status(503).send('Tunnel to local PC is not connected.');
  }

  // ここで自宅のPCへリクエストを転送する仕組みを作る
  res.send('Bridge is active, waiting for proxy implementation...');
});

// 自宅のPCからの常時接続（トンネル）を待ち受ける
wss.on('connection', (ws) => {
  console.log('Local PC connected via tunnel');
  localClient = ws;

  ws.on('close', () => {
    console.log('Local PC disconnected');
    localClient = null;
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});