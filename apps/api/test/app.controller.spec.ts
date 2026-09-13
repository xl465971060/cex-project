import { describe, it, expect } from "vitest";
import { AppController } from "../src/app.controller";
import { PrismaService } from "../src/prisma.service";

describe("AppController", () => {
  it("GET /health 返回 ok", () => {
    const ctrl = new AppController({} as PrismaService);
    const res = ctrl.health();
    expect(res.status).toBe("ok");
    expect(res.service).toBe("api");
    expect(typeof res.time).toBe("string");
  });
});
