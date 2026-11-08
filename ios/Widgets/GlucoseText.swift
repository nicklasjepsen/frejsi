import FollowCore
import SwiftUI

// The pieces every glance is built from, shared by the Live Activity and the widgets (both in the
// widget extension): the value with its arrow, the change, the age and the stale label. Colour is
// never the only signal: the arrow, the age and, when stale, the clock badge and "No new readings"
// say the same thing in shape and words, which matters on the lock screen, where iOS draws
// accessory widgets in one tint.

/// The value and its trend arrow in the threshold colour (grey when stale), rounded and bold so it
/// reads at arm's length; it shrinks before it truncates.
struct ValueText: View {
    let state: LiveGlucoseState
    let unit: GlucoseUnit
    let color: Color
    let size: CGFloat

    var body: some View {
        Text(GlucoseGlance.valueAndArrow(state, unit: unit))
            .font(.system(size: size, weight: .bold, design: .rounded))
            .monospacedDigit()
            .foregroundStyle(color)
            .minimumScaleFactor(0.5)
            .lineLimit(1)
    }
}

/// The change since the previous reading ("+0,3"), when there is a recent one.
struct DeltaText: View {
    let state: LiveGlucoseState
    let unit: GlucoseUnit
    var font: Font = .callout

    var body: some View {
        if let delta = state.delta {
            Text(Glucose.formatDelta(mgdl: state.mgdl, deltaMgdl: delta, unit: unit, locale: AppLanguage.locale))
                .font(font)
                .monospacedDigit()
        }
    }
}

/// The age, ticking by itself ("3 min, 12 sec ago" / "3 min. 12 sek. siden"), with a clock badge
/// once the reading is stale.
struct AgeText: View {
    let readingAt: Date
    let isStale: Bool
    var font: Font = .caption

    var body: some View {
        HStack(spacing: 4) {
            if isStale {
                Image(systemName: GlucoseGlance.staleSymbol)
            }
            // iOS ticks the relative time forward itself, in the environment's locale: the app's
            // language, the same one the app uses for "3 min ago".
            Text(readingAt, style: .relative).monospacedDigit() + Text(verbatim: " \(AppLanguage.current.agoSuffix)")
        }
        .environment(\.locale, AppLanguage.locale)
        .font(font)
        .foregroundStyle(isStale ? .gray : .secondary)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
    }
}

/// The age as a ticking m:ss (h:mm:ss after an hour), for places too small for words: the compact
/// Dynamic Island, the round and the inline lock-screen widgets.
struct ShortAgeText: View {
    let readingAt: Date

    var body: some View {
        Text(readingAt, style: .timer)
            .monospacedDigit()
            .multilineTextAlignment(.center)
            .environment(\.locale, AppLanguage.locale)
    }
}

/// "No new readings", with the clock badge.
struct StaleLabel: View {
    var font: Font = .caption

    var body: some View {
        Label(WL("widget.stale"), systemImage: GlucoseGlance.staleSymbol)
            .font(font)
            .foregroundStyle(.gray)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
    }
}

enum GlucoseGlance {
    static let staleSymbol = "clock.badge.exclamationmark"

    /// "8,4 ↗": the value in the unit and the app's language, and the arrow when the site sent a trend.
    static func valueAndArrow(_ state: LiveGlucoseState, unit: GlucoseUnit) -> String {
        let value = Glucose.format(state.mgdl, unit: unit, locale: AppLanguage.locale)
        let arrow = Glucose.arrow(state.direction)
        return arrow.isEmpty ? value : "\(value) \(arrow)"
    }

    static func color(_ state: LiveGlucoseState, isStale: Bool) -> Color {
        Glucose.color(state.mgdl, thresholds: ThresholdStore.current, isStale: isStale).color
    }
}
