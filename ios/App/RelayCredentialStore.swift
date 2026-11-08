import FollowCore
import Foundation
import Security

/// The Nightscout address and token and the relay's device secret, in the Keychain (plan §3),
/// readable after the first unlock so the app can register in the background. Widgets (stage 5)
/// will need a shared access group.
enum KeychainStore {
    private static let service = "ninja.jepsen.naensom.nightscout"

    static func read(_ account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func write(_ account: String, _ value: String) {
        delete(account)
        var add = match(account)
        add[kSecValueData as String] = Data(value.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }

    static func delete(_ account: String) {
        SecItemDelete(match(account) as CFDictionary)
    }

    private static func match(_ account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}

/// The subscription id and device secret the relay returned (`RelayClient`).
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
