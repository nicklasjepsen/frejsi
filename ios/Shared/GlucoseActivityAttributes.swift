import ActivityKit
import FollowCore
import SwiftUI

/// The Live Activity's type, compiled into the app and the extension. The relay names it in a
/// push-to-start payload (`"attributes-type": "GlucoseActivityAttributes"`, `"attributes":
/// {"unit": "mmolL"}`), so the name and shape are part of the contract with `poller/src/live/`.
///
/// Only the unit is fixed for an activity's life. Everything that changes with a reading is in
/// `LiveGlucoseState` (FollowCore), which every push replaces; the colour thresholds are read from
/// the app group (`ThresholdStore`), so a change in the app shows on the next render.
struct GlucoseActivityAttributes: ActivityAttributes {
    typealias ContentState = LiveGlucoseState

    var unit: GlucoseUnit

    static let `default` = GlucoseActivityAttributes(unit: .mmolL)
}

extension GlucoseColor {
    /// Green in range, yellow between a target edge and its urgent value, red at or beyond an urgent
    /// value, grey when stale. The value, arrow and age are always shown too: colour is never the
    /// only signal.
    var color: Color {
        switch self {
        case .green: return .green
        case .yellow: return .yellow
        case .red: return .red
        case .stale: return .gray
        }
    }
}
