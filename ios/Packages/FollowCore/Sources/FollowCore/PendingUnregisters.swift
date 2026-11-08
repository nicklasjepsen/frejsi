import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Removals the relay has not confirmed yet (plan §4, Cleanup). When "Remove this phone" cannot
/// reach the relay, the phone is cleared anyway and the subscription id and device secret wait
/// here, apart from the active registration, so a new setup neither loses nor reuses them. The app
/// tries each again at launch, on return to the foreground, on a background wake and whenever it
/// registers, until the relay answers that the subscription is gone.
public struct PendingUnregisters: Codable, Equatable, Sendable {
    /// At most this many are kept; the oldest goes first. The relay deletes an unremoved
    /// subscription by itself after 30 days without delivery, so a dropped one still goes.
    public static let limit = 10
    /// Attempts closer together than this are skipped (the foreground can come and go quickly).
    public static let retryAfter: TimeInterval = 30

    public private(set) var entries: [RelayCredentials]

    public init(entries: [RelayCredentials] = []) {
        self.entries = Array(entries.suffix(Self.limit))
    }

    public var isEmpty: Bool { entries.isEmpty }

    /// Adds a removal to retry. The same subscription again replaces the earlier entry.
    public mutating func add(_ credentials: RelayCredentials) {
        guard !credentials.subscriptionId.isEmpty, !credentials.deviceSecret.isEmpty else { return }
        entries.removeAll { $0.subscriptionId == credentials.subscriptionId }
        entries.append(credentials)
        if entries.count > Self.limit { entries.removeFirst(entries.count - Self.limit) }
    }

    /// Drops the removals the relay confirmed.
    public mutating func remove(_ subscriptionIds: Set<String>) {
        entries.removeAll { subscriptionIds.contains($0.subscriptionId) }
    }

    /// Whether to try now: something is waiting and the last attempt was not moments ago.
    public func isDue(now: Date, lastAttemptAt: Date?) -> Bool {
        guard !isEmpty else { return false }
        guard let lastAttemptAt else { return true }
        return now.timeIntervalSince(lastAttemptAt) >= Self.retryAfter || now < lastAttemptAt
    }

    /// The relay's answers to `DELETE /api/live/register/{id}` that mean the subscription is gone:
    /// deleted now (2xx, 204 in the contract), unknown (404), or a secret it no longer matches
    /// (401, which the relay also answers for an unknown id). Anything else, and no answer at all,
    /// is tried again.
    public static func isDone(status: Int) -> Bool {
        (200..<300).contains(status) || status == 401 || status == 404
    }

    // MARK: - Keychain form

    /// One JSON string, for one Keychain item.
    public func encoded() -> String {
        guard let data = try? JSONEncoder().encode(entries) else { return "[]" }
        return String(decoding: data, as: UTF8.self)
    }

    /// Reads what `encoded()` wrote; nothing, or something unreadable, is an empty list.
    public static func decode(_ string: String?) -> PendingUnregisters {
        guard let string, let entries = try? JSONDecoder().decode([RelayCredentials].self, from: Data(string.utf8))
        else { return PendingUnregisters() }
        return PendingUnregisters(entries: entries)
    }
}

extension RelayClient {
    /// One attempt to delete a subscription the phone no longer uses. Answers true when the relay
    /// says it is gone (`PendingUnregisters.isDone`), false when it should be tried again.
    public func unregister(_ credentials: RelayCredentials) async -> Bool {
        guard let (_, status) = try? await transport.send(deleteRequest(credentials)) else { return false }
        return PendingUnregisters.isDone(status: status)
    }

    /// Tries every pending removal once, one after another. Answers the subscription ids that are
    /// gone, for the caller to remove from the list it has now (which may have grown meanwhile).
    public func retry(_ pending: PendingUnregisters) async -> Set<String> {
        var gone = Set<String>()
        for credentials in pending.entries where await unregister(credentials) {
            gone.insert(credentials.subscriptionId)
        }
        return gone
    }
}
