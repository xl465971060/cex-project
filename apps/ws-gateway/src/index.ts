import "dotenv/config";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { SERVICE_PORTS } from "@cex/shared";

/**
 * WebSocket 网关骨架：健康检查 + 最小订阅通道
 * TODO(M3)：接 Kafka trade/order-return 事件 → 行情/回报推送（100ms 合并窗口）
 */

const port = Number(process.env.WS_GATEWAY_PORT ?? SERVICE_PORTS.WS_GATEWAY);

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ service: "ws-gateway", status: "ok", clients: wss.clients.size, time: new Date().toISOString() }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (socket: WebSocket) => {
  socket.send(JSON.stringify({ type: "welcome", message: "ws-gateway 骨架已连接" }));
  socket.on("message", (data: Buffer) => {
    // 最小协议：{"action":"subscribe","channels":["ticker.BTC/USDT"]}
    try {
      const msg = JSON.parse(data.toString()) as { action?: string; channels?: string[] };
      if (msg.action === "subscribe") {
        socket.send(JSON.stringify({ type: "subscribed", channels: msg.channels ?? [] }));
      }
    } catch {
      socket.send(JSON.stringify({ type: "error", message: "invalid json" }));
    }
  });
});

server.listen(port, () => {
  console.log(`[ws-gateway] listening on ws://localhost:${port}/ws（骨架）`);
});
