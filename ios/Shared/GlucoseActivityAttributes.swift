import ActivityKit
import FollowCore
import SwiftUI

/// The Live Activity's type, compiled into the app and the extension. The relay names it in a
/// push-to-start payload (`"attributes-type": "GlucoseActivityAttributes"`), so the name is part of
/// the contract with `poller/src/live/` and must not change.
///
/// The attributes are fixed for an activity's life: the unit and the colour thresholds. Everything
/// that changes with a reading is in `LiveGlucoseState` (FollowCore), which every push replaces.
struct GlucoseActivityAttributes: ActivityAttributes {
    typealias ContentState = LiveGlucoseState

    var unit: GlucoseUnit
    var lowMmolL: Double
    var highMmolL: Double

    static let `default` = GlucoseActivityAttributes(unit: .mmolL, lowMmolL: 3.9, highMmolL: 10.0)
}

/// Range colours as on the desktop glance: green in range, amber high, red low; grey when stale.
/// High is never red.
enum RangeColor {
    static func color(for state: LiveGlucoseState, attributes: GlucoseActivityAttributes, isStale: Bool) -> Color {
        if isStale { return .gray }
        switch Glucose.classify(state.mgdl, lowMmolL: attributes.lowMmolL, highMmolL: attributes.highMmolL) {
        case .low: return .red
        case .inRange: return .green
        case .high: return .orange
        }
    }
}
