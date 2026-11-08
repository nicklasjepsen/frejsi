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
