import FollowCore
import Foundation

/// The colour thresholds, in the app group so the Live Activity extension reads what the app saved.
/// The user's own values win; otherwise the Nightscout site's (`status.json`); otherwise
/// Nightscout's defaults (55 / 80 / 180 / 260 mg/dL).
enum ThresholdStore {
    static let appGroup = "group.ninja.jepsen.naensom"
    private static let userKey = "thresholds.user"
    private static let siteKey = "thresholds.nightscout"

    static var defaults: UserDefaults { UserDefaults(suiteName: appGroup) ?? .standard }

    static var current: GlucoseThresholds { user ?? site ?? .nightscoutDefaults }

    /// The values the user set in the app; nil until they change one.
    static var user: GlucoseThresholds? {
        get { read(userKey) }
        set { write(newValue, userKey) }
    }

    /// The values the Nightscout site reports.
    static var site: GlucoseThresholds? {
        get { read(siteKey) }
        set { write(newValue, siteKey) }
    }

    /// "Remove this phone": back to Nightscout's defaults.
    static func clear() {
        defaults.removeObject(forKey: userKey)
        defaults.removeObject(forKey: siteKey)
    }

    private static func read(_ key: String) -> GlucoseThresholds? {
        guard let data = defaults.data(forKey: key),
              let value = try? JSONDecoder().decode(GlucoseThresholds.self, from: data),
              value.isValid
        else { return nil }
        return value
    }

    private static func write(_ value: GlucoseThresholds?, _ key: String) {
        guard let value, value.isValid, let data = try? JSONEncoder().encode(value) else {
            defaults.removeObject(forKey: key)
            return
        }
        defaults.set(data, forKey: key)
    }
}

/// The user's settings (`FollowSettings`), in the app group beside the thresholds.
enum SettingsStore {
    private static let key = "settings"

    static func load() -> FollowSettings {
        FollowSettings.load(ThresholdStore.defaults.data(forKey: key))
    }

    static func save(_ settings: FollowSettings) {
        ThresholdStore.defaults.set(settings.encoded(), forKey: key)
    }

    static func clear() {
        ThresholdStore.defaults.removeObject(forKey: key)
    }
}
