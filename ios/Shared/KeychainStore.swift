import FollowCore
import Foundation
import Security

/// The Nightscout address and token and the relay's device secret, in the Keychain (plan §3),
/// readable after the first unlock so the app can register in the background and the widgets can
/// read the site with the phone locked.
///
/// The address and token are kept in the app group's Keychain access group
/// (`group.ninja.jepsen.naensom`; on iOS an app group is also a Keychain access group, no extra
/// entitlement), so the widget extension can read the site itself when iOS asks for a timeline.
/// Everything else stays in the app's own access group.
enum KeychainStore {
    private static let service = "ninja.jepsen.naensom.nightscout"
    /// Accounts the widget extension may read.
    static let sharedAccounts: Set<String> = ["site", "token"]

    /// Searches every access group the process has: the app finds items written before they were
    /// shared, the extension only the shared ones.
    static func read(_ account: String) -> String? {
        read(account, accessGroup: nil)
    }

    static func write(_ account: String, _ value: String) {
        delete(account)
        var add = match(account)
        add[kSecValueData as String] = Data(value.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        if sharedAccounts.contains(account) {
            add[kSecAttrAccessGroup as String] = ThresholdStore.appGroup
        }
        SecItemAdd(add as CFDictionary, nil)
    }

    /// Deletes the account from every access group.
    static func delete(_ account: String) {
        SecItemDelete(match(account) as CFDictionary)
    }

    /// Moves an address and token saved before the widgets existed (stage 3, the app's own group)
    /// into the shared group. The app calls it at launch; it writes nothing once they are there.
    static func shareWithExtension() {
        for account in sharedAccounts.sorted() {
            guard read(account, accessGroup: ThresholdStore.appGroup) == nil, let value = read(account) else { continue }
            write(account, value)
        }
    }

    private static func read(_ account: String, accessGroup: String?) -> String? {
        var query = match(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        if let accessGroup { query[kSecAttrAccessGroup as String] = accessGroup }
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func match(_ account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}

/// What the phone follows, as the app saved it: the address and token, or the demo marker.
enum FollowSourceStore {
    static func load() -> FollowSource? {
        FollowSource.restore(site: KeychainStore.read("site"), token: KeychainStore.read("token"))
    }
}
