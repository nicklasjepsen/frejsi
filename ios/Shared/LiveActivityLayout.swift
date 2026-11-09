import Foundation

/// What the Live Activity shows besides the value and its age, which it always shows (a value is
/// never shown without its age). Set in the app (Settings → Live Activity → Show), kept in the app
/// group so the extension reads it each time it draws; the app redraws running activities when it
/// changes.
enum LiveActivityLayout {
    static let arrowKey = "liveActivity.showArrow"
    static let changeKey = "liveActivity.showChange"
    static let unitKey = "liveActivity.showUnit"
    static let ageStyleKey = "liveActivity.ageStyle"

    /// How the age reads: "5 min, 3 sec ago", or a ticking "5:03".
    enum AgeStyle: String, CaseIterable {
        case words
        case timer
    }

    static var defaults: UserDefaults { ThresholdStore.defaults }

    static var showArrow: Bool { flag(arrowKey) }
    static var showChange: Bool { flag(changeKey) }
    static var showUnit: Bool { flag(unitKey) }
    static var ageStyle: AgeStyle { AgeStyle(rawValue: defaults.string(forKey: ageStyleKey) ?? "") ?? .words }

    /// "Remove this phone": back to showing everything.
    static func clear() {
        for key in [arrowKey, changeKey, unitKey, ageStyleKey] { defaults.removeObject(forKey: key) }
    }

    /// On until the user turns it off.
    private static func flag(_ key: String) -> Bool {
        defaults.object(forKey: key) as? Bool ?? true
    }
}
