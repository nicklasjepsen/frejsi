// A fetch fake that serves the Zod contracts by method and path and records every call, so the
// log screen builds in the same wave as the API lanes (plan §8, decision 35). Test support only.
import { vi } from "vitest";

export interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
}

type Handler = (call: RecordedCall, url: URL) => unknown;

export interface FetchFake {
  calls: RecordedCall[];
  /** Answer `METHOD /path` (query ignored) with a JSON body, a status, or a function of the call. */
  on(route: string, answer: unknown, status?: number): FetchFake;
  install(): void;
}

export function fetchFake(): FetchFake {
  const routes = new Map<string, { answer: unknown; status: number }>();
  const calls: RecordedCall[] = [];
  const fake: FetchFake = {
    calls,
    on(route, answer, status = 200) {
      routes.set(route, { answer, status });
      return fake;
    },
    install() {
      vi.stubGlobal(
        "fetch",
        vi.fn((input: string, init?: RequestInit) => {
          const url = new URL(input, "https://frejsi.example");
          const method = init?.method ?? "GET";
          const call: RecordedCall = {
            method,
            path: `${url.pathname}${url.search}`,
            body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
          };
          calls.push(call);
          const route = routes.get(`${method} ${url.pathname}`);
          if (!route) return Promise.resolve(new Response("not found", { status: 404 }));
          const answer =
            typeof route.answer === "function"
              ? (route.answer as Handler)(call, url)
              : route.answer;
          if (answer instanceof Promise) {
            return answer.then(
              (value) => new Response(JSON.stringify(value), { status: route.status }),
            );
          }
          return Promise.resolve(
            route.status === 204
              ? new Response(null, { status: 204 })
              : new Response(JSON.stringify(answer), {
                  status: route.status,
                  headers: { "content-type": "application/json" },
                }),
          );
        }),
      );
    },
  };
  return fake;
}
