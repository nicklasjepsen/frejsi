import FollowCore
import Foundation

/// The subscription id and device secret the relay returned (`RelayClient`), in the app's own
/// Keychain access group: unlike the Nightscout credential, the widget extension has no use for them.
enum RelayCredentialStore {
    private static let idAccount = "relay.subscriptionId"
    private static let secretAccount = "relay.deviceSecret"

    static func read() -> RelayCredentials? {
        guard let id = KeychainStore.read(idAccount), let secret = KeychainStore.read(secretAccount),
              !id.isEmpty, !secret.isEmpty
        else { return nil }
        return RelayCredentials(subscriptionId: id, deviceSecret: secret)
    }

    static func write(_ credentials: RelayCredentials) {
        KeychainStore.write(idAccount, credentials.subscriptionId)
        KeychainStore.write(secretAccount, credentials.deviceSecret)
    }

    static func clear() {
        KeychainStore.delete(idAccount)
        KeychainStore.delete(secretAccount)
    }
}

/// Removals the relay has not confirmed (`PendingUnregisters`), as one Keychain item in the app's
/// own access group, apart from the active registration above: a new setup neither overwrites
/// nor reuses them.
@MainActor
enum PendingUnregisterStore {
    private static let account = "relay.pendingUnregisters"

    static func load() -> PendingUnregisters {
        PendingUnregisters.decode(KeychainStore.read(account))
    }

    static func add(_ credentials: RelayCredentials) {
        var pending = load()
        pending.add(credentials)
        save(pending)
    }

    /// Re-reads the list before writing, so a removal added during an attempt is kept.
    static func remove(_ subscriptionIds: Set<String>) {
        guard !subscriptionIds.isEmpty else { return }
        var pending = load()
        pending.remove(subscriptionIds)
        save(pending)
    }

    private static func save(_ pending: PendingUnregisters) {
        if pending.isEmpty {
            KeychainStore.delete(account)
        } else {
            KeychainStore.write(account, pending.encoded())
        }
    }
}
