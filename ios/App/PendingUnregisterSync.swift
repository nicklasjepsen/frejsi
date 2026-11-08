import FollowCore
import Foundation
import os
import UIKit

/// Keeps trying the removals the relay has not confirmed (`PendingUnregisterStore`): at launch,
/// including a launch in the background, on every return to the foreground, and after each
/// registration the relay accepted. One attempt at a time, at most every 30 seconds; an entry
/// goes when the relay answers 204, 401 or 404 (`PendingUnregisters.isDone`).
@MainActor
final class PendingUnregisterSync {
    static let shared = PendingUnregisterSync()

    private let client = RelayClient(transport: URLSessionTransport())
    private let logger = Logger(subsystem: "ninja.jepsen.naensom", category: "relay")
    private var running = false
    private var lastAttemptAt: Date?

    func retryIfDue() {
        let pending = PendingUnregisterStore.load()
        let now = Date()
        guard !running, pending.isDue(now: now, lastAttemptAt: lastAttemptAt) else { return }
        running = true
        lastAttemptAt = now
        // Asks iOS for time to finish when the app is about to be suspended.
        let background = UIApplication.shared.beginBackgroundTask(withName: "relay.unregister")
        Task {
            let gone = await client.retry(pending)
            PendingUnregisterStore.remove(gone)
            let left = pending.entries.count - gone.count
            logger.notice("pending removals: \(gone.count, privacy: .public) gone, \(left, privacy: .public) left")
            running = false
            if background != .invalid { UIApplication.shared.endBackgroundTask(background) }
        }
    }
}
