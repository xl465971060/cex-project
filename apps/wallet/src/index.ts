import "dotenv/config";
import { createServer } from "node:http";
import { SERVICE_PORTS } from "@cex/shared";

/**
 * 钱包服务骨架：当前仅健康检查 + 环境自检
 * TODO(M2)：HD 地址派生 / 扫块（TronGrid、EVM RPC）/ 打款队列 / 确认监控
 * 依据：《docs/技术决策方案-架构与选型.md》§4、§6
 */

/** 环境自检：钱包服务运行依赖的关键配置是否就绪 */
function envReport(): { key: string; ready: boolean }[] {
  const keys = ["DATABASE_URL", "WALLET_ENC_KEY", "TRONGRID_API_KEY", "EVM_RPC_URL"];
  return keys.map((key) => ({ key, ready: Boolean(process.env[key]) }));
}

const port = Number(process.env.WALLET_PORT ?? SERVICE_PORTS.WALLET);

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        service: "wallet",
        status: "ok",
        env: envReport(),
        time: new Date().toISOString()
      })
    );
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(port, () => {
  console.log(`[wallet] listening on http://localhost:${port}（骨架：健康检查 + 环境自检）`);
});
