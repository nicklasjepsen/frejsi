import ActivityKit
import FollowCore
import SwiftUI
import WidgetKit

// The Live Activity (plan §1): lock screen, Dynamic Island, and the small supplemental family that
// CarPlay and the Watch Smart Stack use. The extension's `@main` bundle, with the widgets, is
// `Widgets/NaensomWidgetBundle.swift`.
//
// Every place that shows a value shows its age next to it. The age is `Text(_:style:)`, which iOS
// ticks forward itself, so it stays true between pushes with nothing running. Built for a glance at
// arm's length (a car mount, a watch): the value and arrow are the biggest thing in every layout,
// bold and rounded, and once the reading is 15 minutes old the colour goes grey and a clock badge
// says so too.

struct GlucoseLiveActivity: Widget {
    var body: some WidgetConfiguration {
        // `.supplementalActivityFamilies` is iOS 18; the app supports 17.2 for push-to-start.
        // WidgetBundleBuilder allows no `if #available`, so the check lives here instead.
        if #available(iOS 18.0, *) {
            return glucoseActivityConfiguration().supplementalActivityFamilies([.small])
        } else {
            return glucoseActivityConfiguration()
        }
    }
}

func glucoseActivityConfiguration() -> ActivityConfiguration<GlucoseActivityAttributes> {
    ActivityConfiguration(for: GlucoseActivityAttributes.self) { context in
        LockScreenView(state: context.state, attributes: context.attributes, isStale: context.isStale)
            .activityBackgroundTint(nil)
    } dynamicIsland: { context in
        let state = context.state
        let unit = context.attributes.unit
        let color = GlucoseGlance.color(state, isStale: context.isStale)
        return DynamicIsland {
            DynamicIslandExpandedRegion(.leading) {
                VStack(alignment: .leading, spacing: 0) {
                    ValueText(state: state, unit: unit, color: color, size: 40)
                    Text(unit.label).font(.caption2).foregroundStyle(.secondary)
                }
                .padding(.leading, 4)
            }
            DynamicIslandExpandedRegion(.trailing) {
                VStack(alignment: .trailing, spacing: 2) {
                    DeltaText(state: state, unit: unit, font: .title3)
                    AgeText(readingAt: state.readingAt, isStale: context.isStale, font: .footnote)
                }
                .padding(.trailing, 4)
            }
            DynamicIslandExpandedRegion(.bottom) {
                if context.isStale { StaleLabel(font: .footnote) }
            }
        } compactLeading: {
            ValueText(state: state, unit: unit, color: color, size: 17)
        } compactTrailing: {
            // The age as a ticking m:ss, the only form short enough for the compact island.
            ShortAgeText(readingAt: state.readingAt)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(context.isStale ? .gray : .secondary)
                .frame(maxWidth: 44)
        } minimal: {
            // No room for a value and its age together, so no value: the arrow in the range colour,
            // or the clock badge once the reading is stale, so an old trend never looks current.
            if context.isStale {
                Image(systemName: GlucoseGlance.staleSymbol).foregroundStyle(.gray)
            } else {
                Text(Glucose.arrow(state.direction).isEmpty ? "•" : Glucose.arrow(state.direction))
                    .font(.body.weight(.bold))
                    .foregroundStyle(color)
            }
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

/// The lock screen: big value and arrow, the unit under it; the change, the age and (when stale)
/// "No new readings" on the right.
private struct MediumView: View {
    let state: LiveGlucoseState
    let attributes: GlucoseActivityAttributes
    let isStale: Bool

    var body: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 0) {
                ValueText(state: state, unit: attributes.unit, color: GlucoseGlance.color(state, isStale: isStale), size: 50)
                Text(attributes.unit.label)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                DeltaText(state: state, unit: attributes.unit, font: .title3)
                AgeText(readingAt: state.readingAt, isStale: isStale, font: .subheadline)
                if isStale { StaleLabel(font: .footnote) }
            }
        }
        .padding()
    }
}

/// CarPlay and the Watch Smart Stack: a small tile seen from a distance. Only the value with its
/// arrow, as large as the tile allows, and the age under it; no unit, no change. Stale adds the
/// clock badge to the age, so it reads without colour.
private struct SmallView: View {
    let state: LiveGlucoseState
    let attributes: GlucoseActivityAttributes
    let isStale: Bool

    var body: some View {
        VStack(spacing: 2) {
            ValueText(state: state, unit: attributes.unit, color: GlucoseGlance.color(state, isStale: isStale), size: 44)
            AgeText(readingAt: state.readingAt, isStale: isStale, font: .footnote.weight(.semibold))
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
