import type { FastifyReply, FastifyRequest } from "fastify";

export async function proxy(request: FastifyRequest, reply: FastifyReply, baseUrl: string): Promise<void> {
  const headers = new Headers();
  if (request.headers.cookie) headers.set("cookie", request.headers.cookie);
  if (request.headers["content-type"]) headers.set("content-type", String(request.headers["content-type"]));
  if (request.headers["x-api-key"]) headers.set("x-api-key", String(request.headers["x-api-key"]));

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const response = await fetch(new URL(request.url, baseUrl), {
    method: request.method,
    headers,
    body: hasBody ? JSON.stringify(request.body ?? {}) : undefined,
  });

  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length > 0) reply.header("set-cookie", cookies);
  const text = await response.text();
  reply.code(response.status).type(response.headers.get("content-type") ?? "application/json").send(text);
}
