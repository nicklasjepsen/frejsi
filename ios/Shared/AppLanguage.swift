import FollowCore
import Foundation

/// One language for the app and the Live Activity extension, chosen the same way in both processes
/// from the phone's preferred languages, so the lock screen never speaks Danish while the app
/// speaks English. Numbers and iOS's ticking ages are formatted with `locale`.
enum AppLanguage {
    static var current: Language { Language.preferred(Locale.preferredLanguages) }
    static var locale: Locale { Locale(identifier: current.localeIdentifier) }

    /// A string from `<language>.lproj/Localizable.strings` in `current`'s language. The lookup
    /// names the language itself instead of leaving it to the bundle, whose fallback for a phone in
    /// neither Danish nor English would be the development language (Danish) while `current` and
    /// the lock screen say English.
    static func text(_ key: String, table: String? = nil) -> String {
        bundle.localizedString(forKey: key, value: nil, table: table)
    }

    private static var bundle: Bundle {
        Bundle.main.path(forResource: current.rawValue, ofType: "lproj").flatMap { Bundle(path: $0) } ?? .main
    }
}

/// The widgets' and the Live Activity's words, from `Shared/<language>.lproj/Widgets.strings`. The
/// widget extension is its own bundle and does not carry the app's `Localizable.strings`, so these
/// few live in a table of their own that both targets copy (`Shared/` is in both).
/// `scripts/check-strings.py` checks it like the app's table.
func WL(_ key: String) -> String {
    AppLanguage.text(key, table: "Widgets")
}
