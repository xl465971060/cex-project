# cex-project

一个从零搭建的中心化加密货币交易所（CEX），当前处于**项目骨架阶段**：工程框架、基础设施、CI 已就绪并全部验证通过，业务代码按里程碑逐步填充。

![CI](https://github.com/xl465971060/cex-project/actions/workflows/ci.yml/badge.svg)

## 目标范围（MVP 最小闭环）

**充值转入 → 现货多币种买卖（USDT ⇄ ETH / SOL / BTC …）→ 提现转出**

做与不做、每个流程的每种情况、架构设计，全部见 [docs/](docs/) 文档索引。

## 技术栈

| 层 | 技术 |
|---|---|
| 语言 | TypeScript 全栈（Node 22 + pnpm workspace + Turborepo） |
| 用户端 / 管理后台 | Next.js 15（App Router） |
| API 网关 | NestJS 11 |
| 撮合 / 钱包 / WS 推送 | Node 原生服务（单线程事件循环 = 免锁撮合） |
| 数据库 | MySQL 8.4 + Prisma 6（金额全部 BigInt 最小单位） |
| 缓存 / 队列 | Redis 7（BullMQ）、Kafka 3.9（KRaft 单节点） |
| CI | GitHub Actions：lint → typecheck → test → build |

## 目录结构

```
apps/        api:4000 · matcher:4001 · wallet:4002 · ws-gateway:4003 · web:3000 · admin:3001
packages/    shared（精度/校验）· db（Prisma）· contracts（链上地址校验）
infra/       docker-compose.dev.yml（MySQL/Redis/Kafka）
docs/        设计文档与验证手册
scripts/     proxy.sh（WSL 借用 Windows 代理）
```

## 快速开始

```bash
pnpm install                                          # 1. 依赖
docker compose -f infra/docker-compose.dev.yml up -d  # 2. 基础设施（MySQL/Redis/Kafka）
cp .env.example .env                                  # 3. 环境变量
pnpm --filter @cex/db exec prisma migrate deploy      # 4. 建表
pnpm dev                                              # 5. 启动全部服务
```

验证是否就绪：`curl localhost:4000/health` 返回 `{"service":"api","status":"ok",...}`（api 启动即连库，它活着 = 数据库也通）。

完整逐项验证步骤（含 CI 文件怎么验证、环境怎么关闭）见 **[docs/项目生成说明.md](docs/项目生成说明.md)**。

## 文档索引

| 文档 | 内容 |
|---|---|
| [交易所MVP-做与不做及最小流程.md](docs/交易所MVP-做与不做及最小流程.md) | 22 模块做/延后/不做决策、资损红线、里程碑 |
| [MVP功能程序流程图.md](docs/MVP功能程序流程图.md) | 19 张 Mermaid 流程图，每种分支情况编号 |
| [技术决策方案-架构与选型.md](docs/技术决策方案-架构与选型.md) | 选型依据、入金/交易/出金链路架构、核心表设计 |
| [环境搭建指南.md](docs/环境搭建指南.md) | 全部环境从零安装（含已装跳过说明） |
| [项目生成说明.md](docs/项目生成说明.md) | 每个可验证物的验证手册（命令 + 预期 + 实测） |
| [开发线路图/](docs/开发线路图/) | [总览](docs/开发线路图/00-总览.md) + M1~M4 各时期任务明细（每任务对应流程图情况编号 + 验证标准） |

## 工程红线（写代码前必读）

1. 金额一律 **BigInt 最小单位**，禁止 float（`@cex/shared/bigint.ts`）
2. 资金操作的幂等键先于业务代码存在：充值 `UNIQUE(txid, log_index)`、订单 `UNIQUE(client_order_id)`、流水 `UNIQUE(biz_no)`
3. 热冷钱包分离、提现双人复核、对账三查——见 MVP 文档「资损红线清单」
