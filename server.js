const express = require("express");
const http = require("http");
const {
    WebSocketServer,
    WebSocket
} = require("ws");

// ============================================================
// 基本設定
// ============================================================

const app = express();
const server = http.createServer(app);

const PORT =
    Number(process.env.PORT) || 3000;

const TUNNEL_PATH =
    "/tunnel";

const SOCKET_PATH =
    "/ws/socket.io";

// ============================================================
// 状態
// ============================================================

let localTunnel = null;

const pendingHttp =
    new Map();

const browserSockets =
    new Map();

// ============================================================
// HTTP body
// ============================================================

app.use(
    express.raw({
        type: "*/*",
        limit: "50mb"
    })
);

// ============================================================
// WebSocketServer
// ============================================================

const tunnelWss =
    new WebSocketServer({
        noServer: true,
        perMessageDeflate: false
    });

const browserWss =
    new WebSocketServer({
        noServer: true,
        perMessageDeflate: false
    });

// ============================================================
// Tunnel helper
// ============================================================

function tunnelIsOpen() {

    return (
        localTunnel &&
        localTunnel.readyState ===
            WebSocket.OPEN
    );
}

function sendToLocal(message) {

    if (!tunnelIsOpen()) {

        console.error(
            "[TUNNEL] Local tunnel is not connected"
        );

        return false;
    }

    try {

        localTunnel.send(
            JSON.stringify(message)
        );

        return true;

    } catch (error) {

        console.error(
            "[TUNNEL SEND ERROR]",
            error.message
        );

        return false;
    }
}

// ============================================================
// Tunnel connection
// ============================================================

tunnelWss.on(
    "connection",
    (ws) => {

        console.log(
            "[TUNNEL] Local PC connected"
        );

        // 既存接続を切断
        if (
            localTunnel &&
            localTunnel !== ws
        ) {

            try {
                localTunnel.close();
            } catch {}
        }

        localTunnel = ws;

        ws.on(
            "message",
            (raw) => {

                let message;

                try {

                    message =
                        JSON.parse(
                            raw.toString()
                        );

                } catch (error) {

                    console.error(
                        "[TUNNEL JSON ERROR]",
                        error.message
                    );

                    return;
                }

                // ==================================================
                // HTTP response
                // ==================================================

                if (
                    message.type ===
                    "http_response_start"
                ) {

                    const res =
                        pendingHttp.get(
                            message.id
                        );

                    if (!res) {
                        return;
                    }

                    const headers = {
                        ...(message.headers || {})
                    };

                    delete headers.connection;
                    delete headers["transfer-encoding"];

                    try {

                        res.writeHead(
                            message.status,
                            headers
                        );

                    } catch (error) {

                        console.error(
                            "[HTTP HEAD ERROR]",
                            error.message
                        );
                    }

                    return;
                }

                if (
                    message.type ===
                    "http_response_data"
                ) {

                    const res =
                        pendingHttp.get(
                            message.id
                        );

                    if (!res) {
                        return;
                    }

                    try {

                        res.write(
                            Buffer.from(
                                message.chunk,
                                "base64"
                            )
                        );

                    } catch (error) {

                        console.error(
                            "[HTTP DATA ERROR]",
                            error.message
                        );
                    }

                    return;
                }

                if (
                    message.type ===
                    "http_response_end"
                ) {

                    const res =
                        pendingHttp.get(
                            message.id
                        );

                    if (!res) {
                        return;
                    }

                    try {
                        res.end();
                    } catch {}

                    pendingHttp.delete(
                        message.id
                    );

                    return;
                }

                // ==================================================
                // WebSocket OPEN
                // ==================================================

                if (
                    message.type ===
                    "ws_open"
                ) {

                    console.log(
                        `[WS OPEN] ${message.id}`
                    );

                    return;
                }

                // ==================================================
                // WebSocket MESSAGE
                // ==================================================

                if (
                    message.type ===
                    "ws_message"
                ) {

                    const browserWs =
                        browserSockets.get(
                            message.id
                        );

                    if (!browserWs) {
                        return;
                    }

                    if (
                        browserWs.readyState !==
                        WebSocket.OPEN
                    ) {
                        return;
                    }

                    try {

                        const buffer =
                            Buffer.from(
                                message.chunk,
                                "base64"
                            );

                        console.log(
                            `[WS → BROWSER] ${buffer.length} bytes binary=${message.binary === true}`
                        );

                        if (
                            message.binary === true
                        ) {

                            browserWs.send(
                                buffer,
                                {
                                    binary: true
                                }
                            );

                        } else {

                            browserWs.send(
                                buffer.toString(),
                                {
                                    binary: false
                                }
                            );
                        }

                    } catch (error) {

                        console.error(
                            "[WS → BROWSER ERROR]",
                            error.message
                        );
                    }

                    return;
                }

                // ==================================================
                // WebSocket ERROR
                // ==================================================

                if (
                    message.type ===
                    "ws_error"
                ) {

                    const browserWs =
                        browserSockets.get(
                            message.id
                        );

                    console.error(
                        `[WS ERROR] ${message.id}: ${message.error}`
                    );

                    if (browserWs) {

                        try {

                            browserWs.close(
                                1011,
                                "Local WebSocket error"
                            );

                        } catch {}
                    }

                    browserSockets.delete(
                        message.id
                    );

                    return;
                }

                // ==================================================
                // WebSocket CLOSE
                // ==================================================

                if (
                    message.type ===
                    "ws_close"
                ) {

                    const browserWs =
                        browserSockets.get(
                            message.id
                        );

                    if (!browserWs) {
                        return;
                    }

                    console.log(
                        `[WS CLOSE] ${message.id}`
                    );

                    try {

                        browserWs.close(
                            message.code || 1000,
                            message.reason || ""
                        );

                    } catch {}

                    browserSockets.delete(
                        message.id
                    );

                    return;
                }
            }
        );

        // ==================================================
        // Tunnel close
        // ==================================================

        ws.on(
            "close",
            (code, reason) => {

                console.log(
                    `[TUNNEL CLOSED] code=${code} reason=${reason.toString()}`
                );

                if (
                    localTunnel === ws
                ) {

                    localTunnel = null;
                }

                // HTTPを終了
                for (
                    const [id, res]
                    of pendingHttp
                ) {

                    try {

                        if (!res.headersSent) {

                            res.statusCode =
                                502;

                            res.end(
                                "Local tunnel disconnected."
                            );

                        } else {

                            res.end();
                        }

                    } catch {}

                    pendingHttp.delete(
                        id
                    );
                }

                // Browser WSを終了
                for (
                    const [id, browserWs]
                    of browserSockets
                ) {

                    try {

                        browserWs.close(
                            1011,
                            "Local tunnel disconnected"
                        );

                    } catch {}

                    browserSockets.delete(
                        id
                    );
                }
            }
        );

        ws.on(
            "error",
            (error) => {

                console.error(
                    "[TUNNEL ERROR]",
                    error.message
                );
            }
        );

        ws.on(
            "ping",
            () => {
                try {
                    ws.pong();
                } catch {}
            }
        );
    }
);

// ============================================================
// HTTP proxy
// ============================================================

app.use(
    (req, res) => {

        console.log(
            `[HTTP] ${req.method} ${req.originalUrl}`
        );

        if (!tunnelIsOpen()) {

            return res
                .status(503)
                .send(
                    "Tunnel to local PC is not connected."
                );
        }

        const id =
            "http_" +
            Math.random()
                .toString(36)
                .slice(2) +
            Date.now().toString(36);

        pendingHttp.set(
            id,
            res
        );

        const body =
            req.body &&
            Buffer.isBuffer(req.body)
                ? req.body.toString("base64")
                : "";

        const headers = {
            ...req.headers
        };

        /*
         * Render→Localで不要なhop-by-hop headers
         */
        delete headers.connection;
        delete headers.upgrade;
        delete headers["proxy-connection"];
        delete headers["keep-alive"];
        delete headers["transfer-encoding"];

        const sent =
            sendToLocal({
                type: "http_request",
                id,
                method: req.method,
                url: req.originalUrl,
                headers,
                body
            });

        if (!sent) {

            pendingHttp.delete(id);

            if (!res.headersSent) {
                res.status(503).send(
                    "Local tunnel unavailable."
                );
            }
        }
    }
);

// ============================================================
// WebSocket Upgrade
// ============================================================

server.on(
    "upgrade",
    (request, socket, head) => {

        let url;

        try {

            url =
                new URL(
                    request.url,
                    `http://${request.headers.host || "localhost"}`
                );

        } catch {

            socket.destroy();

            return;
        }

        console.log(
            `[UPGRADE] ${url.pathname}${url.search}`
        );

        // ==================================================
        // Tunnel
        // ==================================================

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
                        "connection",
                        ws,
                        request
                    );
                }
            );

            return;
        }

        // ==================================================
        // Open WebUI Socket.IO
        // ==================================================

        const normalizedSocketPath =
            url.pathname.endsWith("/")
                ? url.pathname.slice(0, -1)
                : url.pathname;

        if (
            normalizedSocketPath !==
            SOCKET_PATH
        ) {

            socket.write(
                "HTTP/1.1 404 Not Found\r\n" +
                "Connection: close\r\n" +
                "\r\n"
            );

            socket.destroy();

            return;
        }

        // ==================================================
        // Local tunnel check
        // ==================================================

        if (!tunnelIsOpen()) {

            socket.write(
                "HTTP/1.1 503 Service Unavailable\r\n" +
                "Connection: close\r\n" +
                "\r\n" +
                "Local tunnel is not connected."
            );

            socket.destroy();

            return;
        }

        // ==================================================
        // Browser WebSocket
        // ==================================================

        browserWss.handleUpgrade(
            request,
            socket,
            head,
            (browserWs) => {

                browserWss.emit(
                    "connection",
                    browserWs,
                    request
                );
            }
        );
    }
);

// ============================================================
// Browser WebSocket connection
// ============================================================

browserWss.on(
    "connection",
    (browserWs, request) => {

        const id =
            "ws_" +
            Math.random()
                .toString(36)
                .slice(2) +
            Date.now().toString(36);

        console.log(
            `[BROWSER WS CONNECT] ${request.url}`
        );

        browserSockets.set(
            id,
            browserWs
        );

        // ==================================================
        // Browser → Local
        // ==================================================

        browserWs.on(
            "message",
            (data, isBinary) => {

                if (!tunnelIsOpen()) {
                    return;
                }

                const buffer =
                    Buffer.isBuffer(data)
                        ? data
                        : Buffer.from(data);

                console.log(
                    `[BROWSER → LOCAL] ${buffer.length} bytes binary=${Boolean(isBinary)}`
                );

                sendToLocal({
                    type: "ws_message",
                    id,
                    binary: Boolean(isBinary),
                    chunk:
                        buffer.toString("base64")
                });
            }
        );

        // ==================================================
        // Browser close
        // ==================================================

        browserWs.on(
            "close",
            (code, reason) => {

                console.log(
                    `[BROWSER WS CLOSE] id=${id} code=${code} reason=${reason.toString()}`
                );

                if (tunnelIsOpen()) {

                    sendToLocal({
                        type: "ws_close",
                        id,
                        code,
                        reason:
                            reason.toString()
                    });
                }

                browserSockets.delete(
                    id
                );
            }
        );

        // ==================================================
        // Browser error
        // ==================================================

        browserWs.on(
            "error",
            (error) => {

                console.error(
                    `[BROWSER WS ERROR] ${id}`,
                    error.message
                );
            }
        );

        // ==================================================
        // Localへ接続要求
        // ==================================================

        sendToLocal({
            type: "ws_connect",
            id,
            url: request.url,
            headers: request.headers
        });
    }
);

// ============================================================
// Health check
// ============================================================

app.get(
    "/health",
    (req, res) => {

        res.json({
            status: true,
            tunnel:
                tunnelIsOpen(),
            httpPending:
                pendingHttp.size,
            websocketPending:
                browserSockets.size
        });
    }
);

// ============================================================
// Render側 heartbeat
// ============================================================

setInterval(
    () => {

        if (
            localTunnel &&
            localTunnel.readyState ===
                WebSocket.OPEN
        ) {

            try {
                localTunnel.ping();
            } catch {}
        }

    },
    20000
);

// ============================================================
// Start
// ============================================================

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            "========================================"
        );

        console.log(
            "School AI Render Tunnel"
        );

        console.log(
            `Port: ${PORT}`
        );

        console.log(
            `Tunnel: ${TUNNEL_PATH}`
        );

        console.log(
            `Socket.IO: ${SOCKET_PATH}`
        );

        console.log(
            "========================================"
        );
    }
);