import "dotenv/config";
import { createServer } from "node:http";
import { OrderBook } from "./orderbook";
import { SERVICE_PORTS } from "@cex/shared";

const book = new OrderBook("BTC/USDT");
const port = Number(process.env.MATCHER_PORT ?? SERVICE_PORTS.MATCHER);

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ service: "matcher", status: "ok", pair: book.pair, time: new Date().toISOString() }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(port, () => {
  console.log(`[matcher] listening on http://localhost:${port}（骨架：仅健康检查）`);
});
