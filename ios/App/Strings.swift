import Foundation

/// The app's words in da or en (`da.lproj` / `en.lproj` `Localizable.strings`), following the
/// phone's language like the Live Activity does. `scripts/check-strings.py` checks that every key
/// used here exists in both files.
func L(_ key: String) -> String {
    AppLanguage.text(key)
}

/// A string with `%@` / `%d` placeholders, filled in the app's locale.
func L(_ key: String, _ arguments: CVarArg...) -> String {
    String(format: AppLanguage.text(key), locale: AppLanguage.locale, arguments: arguments)
}
