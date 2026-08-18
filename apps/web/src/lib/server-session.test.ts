import { expect, test } from "bun:test";
import { fetchServerSession } from "./server-session";

const requestHeaders = new Headers({
  host: "127.0.0.1:3001",
  cookie: "better-auth.session_token=test",
});

test("retries transient session failures and returns the recovered session", async () => {
  let calls = 0;
  const session = await fetchServerSession(requestHeaders, async () => {
    calls += 1;
    if (calls === 1) return new Response(null, { status: 503 });

    return Response.json({
      user: { id: "user-1", name: "Test User" },
      session: { id: "session-1" },
    });
  });

  expect(calls).toBe(2);
  expect(session?.user.id).toBe("user-1");
});

test("does not retry an explicit anonymous session response", async () => {
  let calls = 0;
  const session = await fetchServerSession(requestHeaders, async () => {
    calls += 1;
    return new Response(null, { status: 401 });
  });

  expect(calls).toBe(1);
  expect(session).toBeNull();
});

test("returns an anonymous session after transient failures are exhausted", async () => {
  let calls = 0;
  const session = await fetchServerSession(requestHeaders, async () => {
    calls += 1;
    return new Response(null, { status: 500 });
  });

  expect(calls).toBe(3);
  expect(session).toBeNull();
});
