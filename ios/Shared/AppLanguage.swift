import FollowCore
import Foundation

/// One language for the app and the Live Activity extension, chosen the same way in both processes
/// from the phone's preferred languages, so the lock screen never speaks Danish while the app
/// speaks English. Numbers and iOS's ticking ages are formatted with `locale`.
enum AppLanguage {
    static var current: Language { Language.preferred(Locale.preferredLanguages) }
    static var locale: Locale { Locale(identifier: current.localeIdentifier) }
}
