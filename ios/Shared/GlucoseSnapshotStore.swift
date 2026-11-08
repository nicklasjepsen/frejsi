import FollowCore
import Foundation

/// The newest reading for the widgets (`GlucoseSnapshot`), in the app group beside the thresholds
/// and settings. The app writes it with every newer reading it fetches and clears it when the phone
/// follows another site or is removed; the widget extension reads it, and writes back a newer
/// reading it read from the site itself.
enum GlucoseSnapshotStore {
    private static let key = "widget.snapshot"

    static func load() -> GlucoseSnapshot? {
        GlucoseSnapshot.decode(ThresholdStore.defaults.data(forKey: key))
    }

    /// Writes `fresh` unless the stored one is as new or newer; answers whether it wrote.
    @discardableResult
    static func save(_ fresh: GlucoseSnapshot) -> Bool {
        guard GlucoseSnapshot.shouldReplace(load(), with: fresh) else { return false }
        ThresholdStore.defaults.set(fresh.encoded(), forKey: key)
        return true
    }

    static func clear() {
        ThresholdStore.defaults.removeObject(forKey: key)
    }
}
