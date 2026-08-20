const express = require('express');
const http = require('http');
const {
    WebSocketServer,
    WebSocket
} = require('ws');

const app = express();
const server = http.createServer(app);

// =========================================================
// 設定
// =========================================================

const PORT =
    process.env.PORT || 3000;

const TUNNEL_PATH =
    '/tunnel';

const SOCKET_PATH =
    '/ws/socket.io/';

// =========================================================
// HTTP body
// =========================================================

app.use(
    express.raw({
        type: '*/*',
        limit: '50mb'
    })
);

// =========================================================
// Local PC Tunnel
// =========================================================

const tunnelWss =
    new WebSocketServer({
        noServer: true
    });

// =========================================================
// Browser WebSocket
// =========================================================

const browserWss =
    new WebSocketServer({
        noServer: true
    });

let localWs = null;

const pendingHttpRequests =
    new Map();

const pendingBrowserSockets =
    new Map();


// =========================================================
// Tunnel connection
// =========================================================

tunnelWss.on(
    'connection',
    (ws) => {

        console.log(
            '[TUNNEL] Local PC connected'
        );

        localWs = ws;

        ws.isAlive = true;

        ws.on('pong', () => {
            ws.isAlive = true;
        });

        ws.on('message', (rawMessage) => {

            let msg;

            try {
                msg =
                    JSON.parse(
                        rawMessage.toString()
                    );
            } catch (err) {

                console.error(
                    '[TUNNEL] Invalid JSON:',
                    err.message
                );

                return;
            }

            // =================================================
            // HTTP response
            // =================================================

            if (
                msg.type === 'response_start' ||
                msg.type === 'response_data' ||
                msg.type === 'response_end'
            ) {

                const res =
                    pendingHttpRequests.get(
                        msg.id
                    );

                if (!res) {
                    return;
                }

                if (
                    msg.type ===
                    'response_start'
                ) {

                    const headers = {
                        ...(msg.headers || {})
                    };

                    delete headers[
                        'transfer-encoding'
                    ];

                    delete headers.connection;

                    try {
                        res.writeHead(
                            msg.status,
                            headers
                        );
                    } catch (err) {
                        console.error(
                            '[HTTP] writeHead error:',
                            err.message
                        );
                    }

                } else if (
                    msg.type ===
                    'response_data'
                ) {

                    try {
                        res.write(
                            Buffer.from(
                                msg.chunk,
                                'base64'
                            )
                        );
                    } catch (err) {
                        console.error(
                            '[HTTP] write error:',
                            err.message
                        );
                    }

                } else {

                    try {
                        res.end();
                    } catch {}

                    pendingHttpRequests.delete(
                        msg.id
                    );
                }

                return;
            }

            // =================================================
            // Browser WebSocket
            // =================================================

            if (
                msg.type === 'ws_open' ||
                msg.type === 'ws_response' ||
                msg.type === 'ws_close' ||
                msg.type === 'ws_error'
            ) {

                const clientWs =
                    pendingBrowserSockets.get(
                        msg.id
                    );

                if (!clientWs) {
                    return;
                }

                if (
                    msg.type === 'ws_open'
                ) {

                    console.log(
                        `[WS] Local connection opened: ${msg.id}`
                    );

                    return;
                }

                if (
                    msg.type === 'ws_response'
                ) {

                    if (
                        clientWs.readyState ===
                        WebSocket.OPEN
                    ) {

                        clientWs.send(
                            Buffer.from(
                                msg.chunk,
                                'base64'
                            )
                        );
                    }

                    return;
                }

                if (
                    msg.type === 'ws_error'
                ) {

                    console.error(
                        `[WS ERROR] ${msg.id}:`,
                        msg.error
                    );

                    try {
                        clientWs.close();
                    } catch {}

                    pendingBrowserSockets.delete(
                        msg.id
                    );

                    return;
                }

                if (
                    msg.type === 'ws_close'
                ) {

                    try {
                        clientWs.close();
                    } catch {}

                    pendingBrowserSockets.delete(
                        msg.id
                    );
                }
            }
        });

        ws.on('close', () => {

            console.log(
                '[TUNNEL] Local PC disconnected'
            );

            if (localWs === ws) {
                localWs = null;
            }

            for (
                const [id, clientWs]
                of pendingBrowserSockets
            ) {

                try {
                    clientWs.close();
                } catch {}

                pendingBrowserSockets.delete(
                    id
                );
            }
        });

        ws.on('error', (err) => {

            console.error(
                '[TUNNEL] Error:',
                err.message
            );
        });
    }
);


// =========================================================
// HTTP → Local PC
// =========================================================

app.use(
    (req, res) => {

        if (
            !localWs ||
            localWs.readyState !==
            WebSocket.OPEN
        ) {

            return res
                .status(503)
                .send(
                    'Tunnel to local PC is not connected.'
                );
        }

        const requestId =
            Math.random()
                .toString(36)
                .substring(2) +
            Date.now()
                .toString(36);

        pendingHttpRequests.set(
            requestId,
            res
        );

        const bodyBase64 =
            req.body &&
            Buffer.isBuffer(req.body)
                ? req.body.toString('base64')
                : '';

        const message = {
            type: 'request',
            id: requestId,
            method: req.method,
            url: req.originalUrl,
            headers: req.headers,
            body: bodyBase64
        };

        try {

            localWs.send(
                JSON.stringify(message)
            );

        } catch (err) {

            pendingHttpRequests.delete(
                requestId
            );

            return res
                .status(502)
                .send(
                    'Failed to send request to local PC.'
                );
        }
    }
);


// =========================================================
// WebSocket Upgrade
// =========================================================

server.on(
    'upgrade',
    (request, socket, head) => {

        const url =
            new URL(
                request.url,
                `http://${request.headers.host}`
            );

        console.log(
            `[UPGRADE] ${url.pathname}${url.search}`
        );

        // =====================================================
        // Local PC Tunnel
        // =====================================================

        if (
            url.pathname ===
            TUNNEL_PATH
        ) {

            tunnelWss.handleUpgrade(
                request,
                socket,
                head,
                (ws) => {

                    tunnelWss.emit(
                        'connection',
                        ws,
                        request
                    );
                }
            );

            return;
        }

        // =====================================================
        // Browser WebSocket
        // =====================================================

        if (
            url.pathname !==
            SOCKET_PATH
        ) {

            socket.write(
                'HTTP/1.1 404 Not Found\r\n' +
                'Connection: close\r\n' +
                '\r\n'
            );

            socket.destroy();

            return;
        }

        // =====================================================
        // Tunnel check
        // =====================================================

        if (
            !localWs ||
            localWs.readyState !==
            WebSocket.OPEN
        ) {

            socket.write(
                'HTTP/1.1 503 Service Unavailable\r\n' +
                'Connection: close\r\n' +
                '\r\n'
            );

            socket.destroy();

            return;
        }

        browserWss.handleUpgrade(
            request,
            socket,
            head,
            (clientWs) => {

                browserWss.emit(
                    'connection',
                    clientWs,
                    request
                );
            }
        );
    }
);


// =========================================================
// Browser WebSocket connection
// =========================================================

browserWss.on(
    'connection',
    (clientWs, request) => {

        const requestId =
            'ws_' +
            Math.random()
                .toString(36)
                .substring(2) +
            Date.now()
                .toString(36);

        console.log(
            `[BROWSER WS] Connected: ${request.url}`
        );

        pendingBrowserSockets.set(
            requestId,
            clientWs
        );

        // =====================================================
        // Browser → Local PC
        // =====================================================

        clientWs.on(
            'message',
            (data, isBinary) => {

                if (
                    !localWs ||
                    localWs.readyState !==
                    WebSocket.OPEN
                ) {
                    return;
                }

                const buffer =
                    Buffer.isBuffer(data)
                        ? data
                        : Buffer.from(data);

                localWs.send(
                    JSON.stringify({
                        type: 'ws_request',
                        id: requestId,
                        chunk:
                            buffer.toString(
                                'base64'
                            ),
                        binary: !!isBinary
                    })
                );
            }
        );

        // =====================================================
        // Browser close
        // =====================================================

        clientWs.on(
            'close',
            () => {

                console.log(
                    `[BROWSER WS] Closed: ${requestId}`
                );

                if (
                    localWs &&
                    localWs.readyState ===
                    WebSocket.OPEN
                ) {

                    localWs.send(
                        JSON.stringify({
                            type: 'ws_close',
                            id: requestId
                        })
                    );
                }

                pendingBrowserSockets.delete(
                    requestId
                );
            }
        );

        clientWs.on(
            'error',
            (err) => {

                console.error(
                    `[BROWSER WS ERROR] ${requestId}:`,
                    err.message
                );
            }
        );

        // =====================================================
        // Local PCへ接続要求
        // =====================================================

        localWs.send(
            JSON.stringify({
                type: 'ws_connect',
                id: requestId,
                url: request.url,
                headers: request.headers
            })
        );
    }
);


// =========================================================
// Health
// =========================================================

app.get(
    '/health',
    (req, res) => {

        res.json({
            status: true,
            tunnel:
                !!localWs &&
                localWs.readyState ===
                WebSocket.OPEN,
            httpPending:
                pendingHttpRequests.size,
            websocketPending:
                pendingBrowserSockets.size
        });
    }
);


// =========================================================
// Heartbeat
// =========================================================

setInterval(
    () => {

        if (
            localWs &&
            localWs.readyState ===
            WebSocket.OPEN
        ) {

            if (localWs.isAlive === false) {

                console.log(
                    '[TUNNEL] Heartbeat timeout'
                );

                localWs.terminate();

                return;
            }

            localWs.isAlive = false;

            localWs.ping();
        }

    },
    20000
);


// =========================================================
// Start
// =========================================================

server.listen(
    PORT,
    '0.0.0.0',
    () => {

        console.log(
            '================================='
        );

        console.log(
            `Render Tunnel Server listening on ${PORT}`
        );

        console.log(
            `Tunnel path: ${TUNNEL_PATH}`
        );

        console.log(
            `Socket path: ${SOCKET_PATH}`
        );

        console.log(
            '================================='
        );
    }
);