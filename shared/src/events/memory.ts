import type { EventEnvelope } from "../schemas/events";
import type { ClientToken, ClientTokenRequest, EventSink, LiveTokenIssuer } from "./types";

/** Records publishes per group. Tests, the seed and the CLI only (lint boundary). */
export class MemoryEventSink implements EventSink, LiveTokenIssuer {
  readonly published: { group: string; envelope: EventEnvelope }[] = [];
  readonly tokens: ClientTokenRequest[] = [];

  publish(group: string, envelope: EventEnvelope): Promise<void> {
    this.published.push({ group, envelope });
    return Promise.resolve();
  }

  forGroup(group: string): EventEnvelope[] {
    return this.published.filter((p) => p.group === group).map((p) => p.envelope);
  }

  issueClientToken(request: ClientTokenRequest): Promise<ClientToken | null> {
    this.tokens.push(request);
    return Promise.resolve({
      url: `ws://memory.invalid/client/hubs/frejsi?user=${encodeURIComponent(request.userId)}`,
    });
  }
}
