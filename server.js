const express = require("express");
const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");

// ============================================================
// 基本設定
// ============================================================

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT) || 3000;
const TUNNEL_PATH = "/tunnel";
const SOCKET_PATH = "/ws/socket.io";

// ============================================================
// カスタムエラーページ＆管理画面 (新機能！)
// ============================================================

// メンテナンス時のメッセージを保持する変数
let maintenanceMessage = "稼働再開の目途は立っていません。";

// 管理者権限でメッセージを更新するためのAPI
app.post("/api/admin/update", express.json(), (req, res) => {
    if (req.body && req.body.passcode === "00141004") {
        maintenanceMessage = req.body.message || "稼働再開の目途は立っていません。";
        return res.json({ success: true });
    }
    return res.status(403).json({ success: false });
});

// 最高にかっこいいAI風HTMLを生成する関数
function generateHtml(type, msg) {
    const isMaint = type === 'maintenance';
    const mainTitle = isMaint ? "SYSTEM MAINTENANCE" : "SYSTEM OFFLINE";
    const mainDesc = isMaint ? "システムメンテナンス中です" : "現在稼働していません";
    const subDesc = isMaint ? `次回稼働予定: ${msg}` : "ホストAIシステムとの通信が切断されています。";

    return `
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI System Status</title>
    <style>
        :root {
            --neon-cyan: #0ff;
            --bg-color: #050505;
        }
        body {
            margin: 0; padding: 0; background: var(--bg-color); color: var(--neon-cyan);
            font-family: 'Courier New', Courier, monospace;
            display: flex; flex-direction: column; justify-content: center; align-items: center;
            height: 100vh; overflow: hidden; text-align: center; user-select: none;
        }
        .container {
            border: 1px solid var(--neon-cyan); padding: 40px;
            box-shadow: 0 0 15px rgba(0, 255, 255, 0.2), inset 0 0 15px rgba(0, 255, 255, 0.1);
            background: rgba(0, 20, 20, 0.5); position: relative;
            cursor: pointer;
        }
        .container::before, .container::after {
            content: ''; position: absolute; width: 20px; height: 20px; border: 2px solid var(--neon-cyan);
        }
        .container::before { top: -2px; left: -2px; border-right: none; border-bottom: none; }
        .container::after { bottom: -2px; right: -2px; border-left: none; border-top: none; }
        @media screen and (max-width: 768px) {
            .container {
                width: 85%;       /* 画面幅に合わせて横幅を自動調整 */
                padding: 20px;    /* 内部の余白を狭くする */
            }
        }

        h1 {
            font-size: 2.5rem; letter-spacing: 5px; margin: 0 0 20px;
            text-shadow: 0 0 10px var(--neon-cyan);
            animation: glitch 2s infinite;
        }
        p { font-size: 1.2rem; margin: 10px 0; }
        .sub-text { font-size: 0.9rem; opacity: 0.8; }

        /* Admin Modal */
        #admin-modal {
            display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.9); z-index: 1000;
            justify-content: center; align-items: center; flex-direction: column;
        }
        .admin-box {
            border: 1px solid #f00; padding: 30px; box-shadow: 0 0 20px rgba(255, 0, 0, 0.3);
            color: #f00; text-align: center;
            background: repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(255,0,0,0.05) 10px, rgba(255,0,0,0.05) 20px);
        }
        .admin-box input {
            background: #000; border: 1px solid #f00; color: #f00;
            padding: 10px; font-family: monospace; font-size: 1rem; width: 80%;
            margin: 10px 0; outline: none; text-align: center;
        }
        .admin-box button {
            background: #f00; color: #000; border: none; padding: 10px 20px;
            font-family: monospace; font-size: 1rem; cursor: pointer; font-weight: bold; margin-top: 10px;
        }
        .admin-box button:hover { background: #fff; color: #f00; box-shadow: 0 0 10px #f00; }

        @keyframes glitch {
            0% { opacity: 1; }
            90% { opacity: 1; }
            92% { opacity: 0.5; transform: translate(2px, -2px); }
            94% { opacity: 1; transform: translate(-2px, 2px); }
            96% { opacity: 0.5; transform: translate(2px, 2px); }
            98% { opacity: 1; transform: translate(0, 0); }
            100% { opacity: 1; }
        }
    </style>
</head>
<body>
    <div class="container" id="main-ui">
        <h1>[ ${mainTitle} ]</h1>
        <p>> ${mainDesc}</p>
        <p class="sub-text">> ${subDesc}</p>
    </div>

    <div id="admin-modal">
        <div class="admin-box">
            <h2>[ ADMIN OVERRIDE ]</h2>
            <div id="auth-section">
                <input type="password" id="passcode" placeholder="ENTER PASSCODE" autocomplete="off">
                <br>
                <button onclick="verify()">AUTHORIZE</button>
            </div>
            <div id="edit-section" style="display: none;">
                <p>MAINTENANCE MESSAGE SETTING</p>
                <input type="text" id="new-msg" placeholder="次回稼働日 / メッセージ" value="${msg}">
                <br>
                <button onclick="update()">UPDATE SYSTEM</button>
            </div>
        </div>
    </div>

    <script>
        // 隠しコマンド1：キーボードで「admin」とタイピングする
        let keyBuffer = '';
        document.addEventListener('keydown', (e) => {
            keyBuffer += e.key.toLowerCase();
            if (keyBuffer.length > 5) keyBuffer = keyBuffer.slice(-5);
            if (keyBuffer === 'admin') openAdmin();
        });

        // 隠しコマンド2：中央の枠の中を素早く5回タップ（クリック）する
        let tapCount = 0;
        let tapTimer = null;
        document.getElementById('main-ui').addEventListener('click', () => {
            tapCount++;
            clearTimeout(tapTimer);
            tapTimer = setTimeout(() => tapCount = 0, 1000);
            if (tapCount >= 5) openAdmin();
        });

        function openAdmin() {
            document.getElementById('admin-modal').style.display = 'flex';
            document.getElementById('passcode').focus();
            keyBuffer = '';
            tapCount = 0;
        }

        function verify() {
            const pass = document.getElementById('passcode').value;
            if (pass === '00141004') {
                document.getElementById('auth-section').style.display = 'none';
                document.getElementById('edit-section').style.display = 'block';
                document.getElementById('new-msg').focus();
            } else {
                alert('ACCESS DENIED');
                document.getElementById('admin-modal').style.display = 'none';
                document.getElementById('passcode').value = '';
            }
        }

        async function update() {
            const pass = document.getElementById('passcode').value;
            const msg = document.getElementById('new-msg').value;
            try {
                const res = await fetch('/api/admin/update', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ passcode: pass, message: msg })
                });
                if (res.ok) {
                    alert('SYSTEM STATUS UPDATED');
                    location.reload();
                } else {
                    alert('UPDATE FAILED');
                }
            } catch(e) {
                alert('NETWORK ERROR');
            }
        }
    </script>
</body>
</html>
    `;
}

// ============================================================
// 状態・データパース
// ============================================================

let localTunnel = null;
const pendingHttp = new Map();
const browserSockets = new Map();

app.use(
    express.raw({
        type: "*/*",
        limit: "50mb"
    })
);

// ============================================================
// WebSocketServer
// ============================================================

const tunnelWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
const browserWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

// ============================================================
// Tunnel helper
// ============================================================

function tunnelIsOpen() {
    return (localTunnel && localTunnel.readyState === WebSocket.OPEN);
}

function sendToLocal(message) {
    if (!tunnelIsOpen()) return false;
    try {
        localTunnel.send(JSON.stringify(message));
        return true;
    } catch (error) {
        return false;
    }
}

// ============================================================
// Tunnel connection
// ============================================================

tunnelWss.on("connection", (ws) => {
    console.log("[TUNNEL] Local PC connected");
    if (localTunnel && localTunnel !== ws) {
        try { localTunnel.close(); } catch {}
    }
    localTunnel = ws;

    ws.on("message", (raw) => {
        let message;
        try {
            message = JSON.parse(raw.toString());
        } catch (error) { return; }

        if (message.type === "http_response_start") {
            const res = pendingHttp.get(message.id);
            if (!res) return;
            const headers = { ...(message.headers || {}) };
            delete headers.connection;
            delete headers["transfer-encoding"];
            try { res.writeHead(message.status, headers); } catch (error) {}
            return;
        }

        if (message.type === "http_response_data") {
            const res = pendingHttp.get(message.id);
            if (!res) return;
            try { res.write(Buffer.from(message.chunk, "base64")); } catch (error) {}
            return;
        }

        if (message.type === "http_response_end") {
            const res = pendingHttp.get(message.id);
            if (!res) return;
            try { res.end(); } catch {}
            pendingHttp.delete(message.id);
            return;
        }

        if (message.type === "ws_open") { return; }

        if (message.type === "ws_message") {
            const browserWs = browserSockets.get(message.id);
            if (!browserWs || browserWs.readyState !== WebSocket.OPEN) return;
            try {
                const buffer = Buffer.from(message.chunk, "base64");
                if (message.binary === true) {
                    browserWs.send(buffer, { binary: true });
                } else {
                    browserWs.send(buffer.toString(), { binary: false });
                }
            } catch (error) {}
            return;
        }

        if (message.type === "ws_error") {
            const browserWs = browserSockets.get(message.id);
            if (browserWs) {
                try { browserWs.close(1011, "Local WebSocket error"); } catch {}
            }
            browserSockets.delete(message.id);
            return;
        }

        if (message.type === "ws_close") {
            const browserWs = browserSockets.get(message.id);
            if (!browserWs) return;
            try { browserWs.close(message.code || 1000, message.reason || ""); } catch {}
            browserSockets.delete(message.id);
            return;
        }
    });

    ws.on("close", () => {
        if (localTunnel === ws) localTunnel = null;
        for (const [id, res] of pendingHttp) {
            try {
                if (!res.headersSent) {
                    // トンネルが切れた場合はメンテナンス画面を表示
                    res.status(503).send(generateHtml('maintenance', maintenanceMessage));
                } else {
                    res.end();
                }
            } catch {}
            pendingHttp.delete(id);
        }
        for (const [id, browserWs] of browserSockets) {
            try { browserWs.close(1011, "Local tunnel disconnected"); } catch {}
            browserSockets.delete(id);
        }
    });

    ws.on("error", () => {});
    ws.on("ping", () => { try { ws.pong(); } catch {} });
});

// ============================================================
// HTTP proxy
// ============================================================

app.use((req, res) => {
    // トンネル（PC）が繋がっていない場合は「メンテナンス中」
    if (!tunnelIsOpen()) {
        return res.status(503).send(generateHtml('maintenance', maintenanceMessage));
    }

    const id = "http_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    pendingHttp.set(id, res);

    const body = req.body && Buffer.isBuffer(req.body) ? req.body.toString("base64") : "";
    const headers = { ...req.headers };

    delete headers.connection; delete headers.upgrade;
    delete headers["proxy-connection"]; delete headers["keep-alive"];
    delete headers["transfer-encoding"];

    const sent = sendToLocal({ type: "http_request", id, method: req.method, url: req.originalUrl, headers, body });

    if (!sent) {
        pendingHttp.delete(id);
        if (!res.headersSent) {
            // トンネルはあるが通信エラーの時は「現在稼働していません」
            res.status(503).send(generateHtml('offline', maintenanceMessage));
        }
    }
});

// ============================================================
// WebSocket Upgrade
// ============================================================

server.on("upgrade", (request, socket, head) => {
    let url;
    try {
        url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    } catch {
        socket.destroy();
        return;
    }

    if (url.pathname === TUNNEL_PATH) {
        tunnelWss.handleUpgrade(request, socket, head, (ws) => {
            tunnelWss.emit("connection", ws, request);
        });
        return;
    }

    const normalizedSocketPath = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
    if (normalizedSocketPath !== SOCKET_PATH) {
        socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
    }

    if (!tunnelIsOpen()) {
        socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\nLocal tunnel is not connected.");
        socket.destroy();
        return;
    }

    browserWss.handleUpgrade(request, socket, head, (browserWs) => {
        browserWss.emit("connection", browserWs, request);
    });
});

// ============================================================
// Browser WebSocket connection
// ============================================================

browserWss.on("connection", (browserWs, request) => {
    const id = "ws_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    browserSockets.set(id, browserWs);

    browserWs.on("message", (data, isBinary) => {
        if (!tunnelIsOpen()) return;
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        sendToLocal({ type: "ws_message", id, binary: Boolean(isBinary), chunk: buffer.toString("base64") });
    });

    browserWs.on("close", (code, reason) => {
        if (tunnelIsOpen()) sendToLocal({ type: "ws_close", id, code, reason: reason.toString() });
        browserSockets.delete(id);
    });

    browserWs.on("error", () => {});
    sendToLocal({ type: "ws_connect", id, url: request.url, headers: request.headers });
});

// ============================================================
// Health check & Render heartbeat
// ============================================================

app.get("/health", (req, res) => {
    res.json({ status: true, tunnel: tunnelIsOpen() });
});

setInterval(() => {
    if (localTunnel && localTunnel.readyState === WebSocket.OPEN) {
        try { localTunnel.ping(); } catch {}
    }
}, 20000);

server.listen(PORT, "0.0.0.0", () => {
    console.log("========================================");
    console.log("School AI Render Tunnel (Advanced AI Mode)");
    console.log(`Port: ${PORT}`);
    console.log("========================================");
});