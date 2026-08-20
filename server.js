const express = require("express");
const http = require("http");
const {
    WebSocketServer,
    WebSocket
} = require("ws");

// ========================================
// Express
// ========================================

const app = express();
const server = http.createServer(app);

// ========================================
// 設定
// ========================================

const PORT =
    process.env.PORT || 3000;

// ========================================
// 自宅PC ⇔ Render Tunnel
// ========================================

const tunnelWss =
    new WebSocketServer({
        server,
        path: "/tunnel"
    });

let localWs = null;

// HTTP request:
//     id -> Express response
//
// WebSocket:
//     id -> Browser WebSocket
//
const pendingRequests =
    new Map();

// ========================================
// Heartbeat
// ========================================

function heartbeat() {
    this.isAlive = true;
}

// ========================================
// Tunnel connection
// ========================================

tunnelWss.on(
    "connection",
    (ws, request) => {

        console.log("");
        console.log(
            "========================================"
        );
        console.log(
            " LOCAL PC CONNECTED"
        );
        console.log(
            "========================================"
        );
        console.log("");

        ws.isAlive = true;

        ws.on(
            "pong",
            heartbeat
        );

        // 以前の接続があれば閉じる
        if (
            localWs &&
            localWs !== ws
        ) {
            try {
                localWs.close();
            } catch {}
        }

        localWs = ws;

        // ------------------------------------
        // Messages from local PC
        // ------------------------------------

        ws.on(
            "message",
            (message) => {

                try {

                    const msg =
                        JSON.parse(
                            message.toString()
                        );

                    // ========================
                    // HTTP response
                    // ========================

                    if (
                        msg.type ===
                        "response_start" ||
                        msg.type ===
                        "response_data" ||
                        msg.type ===
                        "response_end"
                    ) {

                        const res =
                            pendingRequests.get(
                                msg.id
                            );

                        if (!res) {
                            return;
                        }

                        if (
                            msg.type ===
                            "response_start"
                        ) {

                            const headers =
                                {
                                    ...(
                                        msg.headers ||
                                        {}
                                    )
                                };

                            delete headers[
                                "transfer-encoding"
                            ];

                            try {

                                res.writeHead(
                                    msg.status,
                                    headers
                                );

                            } catch (err) {

                                console.error(
                                    "[HTTP HEAD ERROR]",
                                    err.message
                                );
                            }

                        } else if (
                            msg.type ===
                            "response_data"
                        ) {

                            try {

                                res.write(
                                    Buffer.from(
                                        msg.chunk,
                                        "base64"
                                    )
                                );

                            } catch (err) {

                                console.error(
                                    "[HTTP DATA ERROR]",
                                    err.message
                                );
                            }

                        } else if (
                            msg.type ===
                            "response_end"
                        ) {

                            try {
                                res.end();
                            } catch {}

                            pendingRequests.delete(
                                msg.id
                            );
                        }

                        return;
                    }

                    // ========================
                    // WebSocket Open
                    // ========================

                    if (
                        msg.type ===
                        "ws_open"
                    ) {

                        const clientWs =
                            pendingRequests.get(
                                msg.id
                            );

                        if (!clientWs) {
                            return;
                        }

                        console.log(
                            `[WS OPEN] ${msg.id}`
                        );

                        return;
                    }

                    // ========================
                    // WebSocket Response
                    // ========================

                    if (
                        msg.type ===
                        "ws_response"
                    ) {

                        const clientWs =
                            pendingRequests.get(
                                msg.id
                            );

                        if (!clientWs) {
                            return;
                        }

                        if (
                            clientWs.readyState ===
                            WebSocket.OPEN
                        ) {

                            clientWs.send(
                                Buffer.from(
                                    msg.chunk,
                                    "base64"
                                )
                            );
                        }

                        return;
                    }

                    // ========================
                    // WebSocket Error
                    // ========================

                    if (
                        msg.type ===
                        "ws_error"
                    ) {

                        console.error(
                            `[LOCAL WS ERROR] id=${msg.id} ${msg.error}`
                        );

                        const clientWs =
                            pendingRequests.get(
                                msg.id
                            );

                        if (clientWs) {
                            try {
                                clientWs.close(
                                    1011,
                                    msg.error
                                );
                            } catch {}
                        }

                        pendingRequests.delete(
                            msg.id
                        );

                        return;
                    }

                    // ========================
                    // WebSocket Close
                    // ========================

                    if (
                        msg.type ===
                        "ws_close"
                    ) {

                        const clientWs =
                            pendingRequests.get(
                                msg.id
                            );

                        if (!clientWs) {
                            return;
                        }

                        console.log(
                            `[WS CLOSE] ${msg.id}`
                        );

                        try {
                            clientWs.close(
                                msg.code || 1000,
                                msg.reason || ""
                            );
                        } catch {}

                        pendingRequests.delete(
                            msg.id
                        );

                        return;
                    }

                } catch (err) {

                    console.error(
                        "[TUNNEL MESSAGE ERROR]",
                        err.message
                    );
                }
            }
        );

        // ------------------------------------
        // Tunnel close
        // ------------------------------------

        ws.on(
            "close",
            (code, reason) => {

                console.log(
                    `[TUNNEL CLOSE] code=${code} reason=${reason.toString()}`
                );

                if (localWs === ws) {
                    localWs = null;
                }

                // ブラウザ側の接続も閉じる
                pendingRequests.forEach(
                    (client, id) => {

                        if (
                            client &&
                            client.readyState !==
                            WebSocket.CLOSED
                        ) {

                            try {
                                client.close(
                                    1011,
                                    "Local tunnel disconnected"
                                );
                            } catch {}
                        }
                    }
                );

                pendingRequests.clear();
            }
        );

        ws.on(
            "error",
            (err) => {

                console.error(
                    "[TUNNEL ERROR]",
                    err.message
                );
            }
        );
    }
);

// ========================================
// Tunnel heartbeat
// ========================================

const heartbeatInterval =
    setInterval(() => {

        tunnelWss.clients.forEach(
            (ws) => {

                if (
                    ws.isAlive === false
                ) {

                    console.log(
                        "[HEARTBEAT] Terminating dead tunnel"
                    );

                    return ws.terminate();
                }

                ws.isAlive = false;

                try {
                    ws.ping();
                } catch {}
            }
        );

    }, 20000);

tunnelWss.on(
    "close",
    () => {
        clearInterval(
            heartbeatInterval
        );
    }
);

// ========================================
// HTTP body
// ========================================

app.use(
    express.raw({
        type: "*/*",
        limit: "50mb"
    })
);

// ========================================
// HTTP proxy
// ========================================

app.use(
    (req, res) => {

        console.log(
            `[HTTP] ${req.method} ${req.url}`
        );

        if (
            !localWs ||
            localWs.readyState !==
            WebSocket.OPEN
        ) {

            console.log(
                "[HTTP] Local tunnel unavailable"
            );

            return res
                .status(503)
                .send(
                    "Tunnel to local PC is not connected."
                );
        }

        const requestId =
            "http_" +
            Math.random()
                .toString(36)
                .substring(2) +
            Date.now().toString(36);

        pendingRequests.set(
            requestId,
            res
        );

        const bodyBase64 =
            req.body &&
            Buffer.isBuffer(req.body)
                ? req.body.toString(
                    "base64"
                )
                : "";

        try {

            localWs.send(
                JSON.stringify({
                    type: "request",
                    id: requestId,
                    method: req.method,
                    url: req.url,
                    headers: req.headers,
                    body: bodyBase64
                })
            );

        } catch (err) {

            console.error(
                "[HTTP SEND ERROR]",
                err.message
            );

            pendingRequests.delete(
                requestId
            );

            if (!res.headersSent) {
                res.status(502).send(
                    "Tunnel error."
                );
            }
        }
    }
);

// ========================================
// Browser WebSocket
// ========================================

const browserWss =
    new WebSocketServer({
        noServer: true
    });

// ========================================
// HTTP Upgrade
// ========================================

server.on(
    "upgrade",
    (request, socket, head) => {

        console.log(
            `[UPGRADE] ${request.url}`
        );

        // ----------------------------------
        // /tunnel はトンネル専用
        // ----------------------------------

        if (
            request.url === "/tunnel" ||
            request.url.startsWith(
                "/tunnel?"
            )
        ) {

            console.log(
                "[UPGRADE] Tunnel request"
            );

            // WebSocketServer({ server, path })
            // 側に処理させる
            return;
        }

        // ----------------------------------
        // Local tunnel check
        // ----------------------------------

        if (
            !localWs ||
            localWs.readyState !==
            WebSocket.OPEN
        ) {

            console.log(
                "[UPGRADE] Local tunnel unavailable"
            );

            socket.write(
                "HTTP/1.1 503 Service Unavailable\r\n" +
                "Connection: close\r\n" +
                "Content-Type: text/plain\r\n" +
                "\r\n" +
                "Local tunnel is not connected."
            );

            socket.destroy();

            return;
        }

        // ----------------------------------
        // Browser WebSocket
        // ----------------------------------

        browserWss.handleUpgrade(
            request,
            socket,
            head,
            (browserWs) => {

                console.log(
                    `[BROWSER WS CONNECT] ${request.url}`
                );

                const requestId =
                    "ws_" +
                    Math.random()
                        .toString(36)
                        .substring(2) +
                    Date.now()
                        .toString(36);

                pendingRequests.set(
                    requestId,
                    browserWs
                );

                // 自宅PCへ通知
                try {

                    localWs.send(
                        JSON.stringify({
                            type:
                                "ws_connect",
                            id:
                                requestId,
                            url:
                                request.url,
                            headers:
                                request.headers
                        })
                    );

                } catch (err) {

                    console.error(
                        "[WS CONNECT SEND ERROR]",
                        err.message
                    );

                    pendingRequests.delete(
                        requestId
                    );

                    browserWs.close(
                        1011,
                        "Tunnel error"
                    );

                    return;
                }

                // ------------------------------
                // Browser → Local
                // ------------------------------

                browserWs.on(
                    "message",
                    (message) => {

                        if (
                            !localWs ||
                            localWs.readyState !==
                            WebSocket.OPEN
                        ) {
                            return;
                        }

                        const buffer =
                            Buffer.isBuffer(
                                message
                            )
                                ? message
                                : Buffer.from(
                                    message
                                );

                        localWs.send(
                            JSON.stringify({
                                type:
                                    "ws_request",
                                id:
                                    requestId,
                                chunk:
                                    buffer.toString(
                                        "base64"
                                    )
                            })
                        );
                    }
                );

                // ------------------------------
                // Browser close
                // ------------------------------

                browserWs.on(
                    "close",
                    (code, reason) => {

                        console.log(
                            `[BROWSER WS CLOSE] id=${requestId} code=${code}`
                        );

                        if (
                            localWs &&
                            localWs.readyState ===
                            WebSocket.OPEN
                        ) {

                            localWs.send(
                                JSON.stringify({
                                    type:
                                        "ws_close",
                                    id:
                                        requestId
                                })
                            );
                        }

                        pendingRequests.delete(
                            requestId
                        );
                    }
                );

                // ------------------------------
                // Browser error
                // ------------------------------

                browserWs.on(
                    "error",
                    (err) => {

                        console.error(
                            `[BROWSER WS ERROR] id=${requestId}`,
                            err.message
                        );
                    }
                );
            }
        );
    }
);

// ========================================
// Health check
// ========================================

app.get(
    "/health",
    (req, res) => {

        res.json({
            status: "ok",
            tunnel:
                !!localWs &&
                localWs.readyState ===
                WebSocket.OPEN,
            pending:
                pendingRequests.size
        });
    }
);

// ========================================
// Start
// ========================================

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log("");
        console.log(
            "========================================"
        );
        console.log(
            " SCHOOL AI TUNNEL SERVER"
        );
        console.log(
            "========================================"
        );
        console.log(
            `Port: ${PORT}`
        );
        console.log(
            "Tunnel: /tunnel"
        );
        console.log(
            "Browser WebSocket: /ws/socket.io/"
        );
        console.log(
            "========================================"
        );
        console.log("");
    }
);