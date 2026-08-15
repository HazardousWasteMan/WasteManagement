import { beforeEach, expect, it } from "vitest";
import { proxy } from "@/proxy";
import type { NextRequest } from "next/server";

function req(auth?: string) {
  return new Request("http://localhost/api/classify", {
    headers: auth ? { authorization: auth } : {},
  }) as unknown as NextRequest;
}

const basic = (creds: string) =>
  `Basic ${Buffer.from(creds).toString("base64")}`;

beforeEach(() => {
  process.env.BASIC_AUTH_USER = "hwm";
  process.env.BASIC_AUTH_PASSWORD = "secret";
});

it("rejects missing credentials with 401 + browser prompt", () => {
  const res = proxy(req());
  expect(res?.status).toBe(401);
  expect(res?.headers.get("WWW-Authenticate")).toContain("Basic");
});

it("rejects wrong credentials", () => {
  expect(proxy(req(basic("hwm:wrong")))?.status).toBe(401);
});

it("allows correct credentials", () => {
  expect(proxy(req(basic("hwm:secret")))).toBeUndefined();
});

it("handles passwords containing colons", () => {
  process.env.BASIC_AUTH_PASSWORD = "se:cret";
  expect(proxy(req(basic("hwm:se:cret")))).toBeUndefined();
});

it("fails closed when env vars are unset", () => {
  delete process.env.BASIC_AUTH_USER;
  delete process.env.BASIC_AUTH_PASSWORD;
  expect(proxy(req(basic("hwm:secret")))?.status).toBe(401);
});
