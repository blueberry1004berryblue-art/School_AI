const express = require('express');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let localWs = null;
const pendingRequests = new Map();

wss.on('connection', (ws) => {
    console.log('Local PC connected via WebSocket!');
    localWs = ws;

    ws.on('message', (message) => {
        try {
            const msg = JSON.parse(message);
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
        } catch (e) {
            console.error('Bridge error:', e);
        }
    });

    ws.on('close', () => {
        console.log('Local PC disconnected');
        localWs = null;
        for (const [id, res] of pendingRequests.entries()) {
            res.status(502).send('Tunnel to local PC lost.');
        }
        pendingRequests.clear();
    });
});

app.use(express.raw({ type: '*/*', limit: '50mb' }));

app.use((req, res) => {
    if (!localWs || localWs.readyState !== WebSocket.OPEN) {
        return res.status(503).send('Tunnel to local PC is not connected.');
    }

    const requestId = Math.random().toString(36).substring(2) + Date.now().toString(36);
    pendingRequests.set(requestId, res);

    req.on('close', () => {
        if (pendingRequests.has(requestId)) {
            pendingRequests.delete(requestId);
        }
    });

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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});