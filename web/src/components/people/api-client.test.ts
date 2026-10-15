import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { peopleApi, PeopleApiError } from "./api-client";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const reply = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const members = {
  members: [
    {
      userId: "u1",
      name: "Example Owner",
      role: "owner",
      simpleMode: false,
      lastSeen: "2026-10-15T08:00:00.000Z",
      devices: [],
    },
  ],
  invites: [],
};

describe("peopleApi", () => {
  it("loads the PeopleView from GET members and validates it", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, members));
    await expect(peopleApi.load("s1")).resolves.toEqual(members);
    expect(fetchMock).toHaveBeenCalledWith("/api/spaces/s1/members", {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
    });
  });

  it("posts an invite as JSON and returns the created link", async () => {
    const created = {
      id: "h1",
      url: "https://frejsi.example/invite/t",
      name: "New Person",
      role: "carer",
      expiresAt: "2026-10-22T08:00:00.000Z",
    };
    fetchMock.mockResolvedValueOnce(reply(200, created));
    await expect(
      peopleApi.createInvite("s1", { name: "New Person", role: "carer" }),
    ).resolves.toEqual(created);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/spaces/s1/invites");
    expect(init).toMatchObject({
      method: "POST",
      body: JSON.stringify({ name: "New Person", role: "carer" }),
    });
    expect((init?.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("sends resend, revoke, role change, member removal and device removal to their routes", async () => {
    fetchMock.mockResolvedValue(reply(204));
    await peopleApi.revokeInvite("s1", "h1");
    await peopleApi.changeRole("s1", "u2", "viewer");
    await peopleApi.removeMember("s1", "u2");
    fetchMock.mockResolvedValueOnce(reply(200, { signedOut: true }));
    await expect(peopleApi.removeDevice("s1", "pk1")).resolves.toEqual({ signedOut: true });
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["/api/spaces/s1/invites/h1", "DELETE"],
      ["/api/spaces/s1/members/u2", "PATCH"],
      ["/api/spaces/s1/members/u2", "DELETE"],
      ["/api/spaces/s1/passkeys/pk1", "DELETE"],
    ]);
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ role: "viewer" }));

    fetchMock.mockResolvedValueOnce(
      reply(200, {
        id: "h2",
        url: "https://frejsi.example/invite/t2",
        name: "Pending",
        role: "carer",
        expiresAt: "2026-10-22T08:00:00.000Z",
      }),
    );
    await expect(peopleApi.resendInvite("s1", "h1")).resolves.toMatchObject({ id: "h2" });
    expect(fetchMock.mock.calls[4]?.[0]).toBe("/api/spaces/s1/invites/h1/resend");
  });

  it("throws a PeopleApiError carrying the ApiError code", async () => {
    fetchMock.mockResolvedValueOnce(
      reply(409, { error: { code: "last-owner", message: "A space always needs an owner" } }),
    );
    const failure = peopleApi.changeRole("s1", "u1", "carer");
    await expect(failure).rejects.toBeInstanceOf(PeopleApiError);
    await expect(failure).rejects.toMatchObject({ code: "last-owner", status: 409 });
  });

  it("treats an unreadable error body or a malformed success as internal", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 502 }));
    await expect(peopleApi.load("s1")).rejects.toMatchObject({ code: "internal", status: 502 });
    fetchMock.mockResolvedValueOnce(reply(200, { members: "nope" }));
    await expect(peopleApi.load("s1")).rejects.toMatchObject({ code: "internal" });
  });
});
