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
    static func text(_ key: String) -> String {
        bundle.localizedString(forKey: key, value: nil, table: nil)
    }

    private static var bundle: Bundle {
        Bundle.main.path(forResource: current.rawValue, ofType: "lproj").flatMap { Bundle(path: $0) } ?? .main
    }
}
