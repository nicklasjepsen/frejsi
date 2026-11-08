import ActivityKit
import FollowCore
import SwiftUI
import WidgetKit

// The bare stage-2 Live Activity (plan §7, stage 2): lock screen, Dynamic Island, and the small
// supplemental family that CarPlay and the Watch Smart Stack use. Stage 5 finishes the design.
//
// Every place that shows a value shows its age next to it. The age is `Text(_:style:)`, which iOS
// ticks forward itself, so it stays true between pushes with nothing running.

@main
struct NaensomLiveActivityBundle: WidgetBundle {
    var body: some Widget {
        // `.supplementalActivityFamilies` is iOS 18; the app supports 17.2 for push-to-start.
        if #available(iOS 18.0, *) {
            GlucoseLiveActivityWithSmallFamily()
        } else {
            GlucoseLiveActivity()
        }
    }
}

struct GlucoseLiveActivity: Widget {
    var body: some WidgetConfiguration {
        glucoseActivityConfiguration()
    }
}

@available(iOS 18.0, *)
struct GlucoseLiveActivityWithSmallFamily: Widget {
    var body: some WidgetConfiguration {
        glucoseActivityConfiguration()
            .supplementalActivityFamilies([.small])
    }
}

func glucoseActivityConfiguration() -> ActivityConfiguration<GlucoseActivityAttributes> {
    ActivityConfiguration(for: GlucoseActivityAttributes.self) { context in
        LockScreenView(state: context.state, attributes: context.attributes, isStale: context.isStale)
            .activityBackgroundTint(nil)
    } dynamicIsland: { context in
        let state = context.state
        let color = RangeColor.color(for: state, attributes: context.attributes, isStale: context.isStale)
        return DynamicIsland {
            DynamicIslandExpandedRegion(.leading) {
                ValueText(state: state, unit: context.attributes.unit, color: color, size: 34)
            }
            DynamicIslandExpandedRegion(.trailing) {
                VStack(alignment: .trailing, spacing: 2) {
                    DeltaText(state: state, unit: context.attributes.unit)
                    AgeText(readingAt: state.readingAt, isStale: context.isStale)
                }
            }
        } compactLeading: {
            ValueText(state: state, unit: context.attributes.unit, color: color, size: 15)
        } compactTrailing: {
            // The age as a ticking mm:ss, the only form short enough for the compact island.
            Text(timerInterval: state.readingAt...Date.distantFuture, countsDown: false)
                .monospacedDigit()
                .font(.caption2)
                .foregroundStyle(context.isStale ? .gray : .secondary)
                .frame(maxWidth: 44)
        } minimal: {
            // No room for a value and its age together, so no value: the range colour and the arrow.
            Text(Glucose.arrow(state.direction).isEmpty ? "•" : Glucose.arrow(state.direction))
                .foregroundStyle(color)
        }
    }
}

struct LockScreenView: View {
    let state: LiveGlucoseState
    let attributes: GlucoseActivityAttributes
    let isStale: Bool

    var body: some View {
        if #available(iOS 18.0, *) {
            FamilyAwareView(state: state, attributes: attributes, isStale: isStale)
        } else {
            MediumView(state: state, attributes: attributes, isStale: isStale)
        }
    }
}

@available(iOS 18.0, *)
private struct FamilyAwareView: View {
    @Environment(\.activityFamily) private var family
    let state: LiveGlucoseState
    let attributes: GlucoseActivityAttributes
    let isStale: Bool

    var body: some View {
        switch family {
        case .small:
            SmallView(state: state, attributes: attributes, isStale: isStale)
        default:
            MediumView(state: state, attributes: attributes, isStale: isStale)
        }
    }
}

/// The lock screen: big value, arrow, change, age.
private struct MediumView: View {
    let state: LiveGlucoseState
    let attributes: GlucoseActivityAttributes
    let isStale: Bool

    var body: some View {
        let color = RangeColor.color(for: state, attributes: attributes, isStale: isStale)
        HStack(alignment: .firstTextBaseline) {
            ValueText(state: state, unit: attributes.unit, color: color, size: 44)
            Text(attributes.unit.label)
                .font(.footnote)
                .foregroundStyle(.secondary)
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                DeltaText(state: state, unit: attributes.unit)
                AgeText(readingAt: state.readingAt, isStale: isStale)
            }
        }
        .padding()
    }
}

/// CarPlay and the Watch Smart Stack: value, arrow and age, readable at a glance.
private struct SmallView: View {
    let state: LiveGlucoseState
    let attributes: GlucoseActivityAttributes
    let isStale: Bool

    var body: some View {
        let color = RangeColor.color(for: state, attributes: attributes, isStale: isStale)
        VStack(spacing: 2) {
            ValueText(state: state, unit: attributes.unit, color: color, size: 30)
            AgeText(readingAt: state.readingAt, isStale: isStale)
        }
        .padding(6)
    }
}

private struct ValueText: View {
    let state: LiveGlucoseState
    let unit: GlucoseUnit
    let color: Color
    let size: CGFloat

    var body: some View {
        Text("\(Glucose.format(state.mgdl, unit: unit)) \(Glucose.arrow(state.direction))")
            .font(.system(size: size, weight: .semibold, design: .rounded))
            .monospacedDigit()
            .foregroundStyle(color)
            .minimumScaleFactor(0.6)
            .lineLimit(1)
    }
}

private struct DeltaText: View {
    let state: LiveGlucoseState
    let unit: GlucoseUnit

    var body: some View {
        if let delta = state.delta {
            let text = Glucose.formatDelta(mgdl: state.mgdl, deltaMgdl: delta, unit: unit)
            Text(text).font(.callout).monospacedDigit()
        }
    }
}

/// The age, ticking by itself; grey with a clock badge once the activity is stale.
private struct AgeText: View {
    let readingAt: Date
    let isStale: Bool

    var body: some View {
        HStack(spacing: 4) {
            if isStale {
                Image(systemName: "clock.badge.exclamationmark")
            }
            Text(readingAt, style: .relative)
                .monospacedDigit()
        }
        .font(.caption)
        .foregroundStyle(isStale ? .gray : .secondary)
    }
}
