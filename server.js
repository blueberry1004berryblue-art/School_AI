const express = require('express');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const server = http.createServer(app);

// 自宅からのトンネル接続を待つWebSocketサーバー (パス: /tunnel)
const wss = new WebSocketServer({ server, path: '/tunnel' });

let localWs = null;
const pendingRequests = new Map();

function heartbeat() {
    this.isAlive = true;
}

wss.on('connection', (ws) => {
    console.log('Local PC connected via Tunnel!');
    ws.isAlive = true;
    ws.on('pong', heartbeat);
    localWs = ws;

    ws.on('message', (message) => {
        try {
            const msg = JSON.parse(message);
            
            // 通常のHTTPレスポンスの処理
            if (msg.type === 'response_start' || msg.type === 'response_data' || msg.type === 'response_end') {
                const res = pendingRequests.get(msg.id);
                if (!res) return;
                
                if (msg.type === 'response_start') {
                    delete msg.headers['transfer-encoding'];
                    res.writeHead(msg.status, msg.headers);
                } else if (msg.type === 'response_data') {
                    res.write(Buffer.from(msg.chunk, 'base64'));
                } else if (msg.type === 'response_end') {
                    res.end();
                    pendingRequests.delete(msg.id);
                }
            }
            
            // Socket.io (WebSocket) の中継処理
            if (msg.type === 'ws_response' || msg.type === 'ws_close') {
                const clientWs = pendingRequests.get(msg.id);
                if (!clientWs) return;
                
                if (msg.type === 'ws_response') {
                    clientWs.send(Buffer.from(msg.chunk, 'base64'));
                } else if (msg.type === 'ws_close') {
                    clientWs.close();
                    pendingRequests.delete(msg.id);
                }
            }
        } catch (e) {
            console.error('Bridge error:', e);
        }
    });

    ws.on('close', () => {
        console.log('Local PC disconnected');
        localWs = null;
        pendingRequests.clear();
    });
});

const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 20000);

wss.on('close', () => clearInterval(interval));

app.use(express.raw({ type: '*/*', limit: '50mb' }));

// 通常のHTTPリクエストの中継
app.use((req, res) => {
    if (!localWs || localWs.readyState !== WebSocket.OPEN) {
        return res.status(503).send('Tunnel to local PC is not connected.');
    }

    const requestId = Math.random().toString(36).substring(2) + Date.now().toString(36);
    pendingRequests.set(requestId, res);

    const bodyBase64 = req.body && Buffer.isBuffer(req.body) ? req.body.toString('base64') : '';

    localWs.send(JSON.stringify({
        type: 'request',
        id: requestId,
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: bodyBase64
    }));
});

// ▼ ここが追加のキモ！ブラウザからのWebSocket(Socket.io)要求を横取りして中継
const browserWss = new WebSocketServer({ noServer: true });
server.on('upgrade', (request, socket, head) => {
    // /tunnel へのアクセスはトンネル用として処理する
    if (request.url === '/tunnel') return;

    if (!localWs || localWs.readyState !== WebSocket.OPEN) {
        socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
        socket.destroy();
        return;
    }

    browserWss.handleUpgrade(request, socket, head, (ws) => {
        const requestId = 'ws_' + Math.random().toString(36).substring(2);
        pendingRequests.set(requestId, ws);

        // 自宅PCに「WebSocket接続が来たよ」と知らせる
        localWs.send(JSON.stringify({
            type: 'ws_connect',
            id: requestId,
            url: request.url,
            headers: request.headers
        }));

        // ブラウザから送られてきたSocket.ioのデータを自宅PCへ転送
        ws.on('message', (message) => {
            if (localWs && localWs.readyState === WebSocket.OPEN) {
                localWs.send(JSON.stringify({
                    type: 'ws_request',
                    id: requestId,
                    chunk: Buffer.isBuffer(message) ? message.toString('base64') : Buffer.from(message).toString('base64')
                }));
            }
        });

        ws.on('close', () => {
            if (localWs && localWs.readyState === WebSocket.OPEN) {
                localWs.send(JSON.stringify({ type: 'ws_close', id: requestId }));
            }
            pendingRequests.delete(requestId);
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});