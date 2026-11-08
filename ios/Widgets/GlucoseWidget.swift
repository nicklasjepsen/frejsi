import FollowCore
import SwiftUI
import WidgetKit

// The widgets (plan §1): the newest reading on the home screen (small, medium; the small one is also
// what StandBy and, from iOS 26, CarPlay show) and on the lock screen (inline, round, rectangular).
// They are the backup to the Live Activity: iOS decides how often a widget gets a new timeline, so
// every one shows the reading's age, ticking by itself, and turns grey with a clock badge and "No
// new readings" 15 minutes after the reading, from an entry iOS shows at that moment without asking
// us again. The timeline logic (entries, stale moment, next refresh) is `WidgetTimeline` in
// FollowCore, with tests.

struct GlucoseWidget: Widget {
    static let kind = "ninja.jepsen.naensom.glucose"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: GlucoseProvider()) { entry in
            GlucoseWidgetView(entry: entry)
        }
        .configurationDisplayName(WL("widget.name"))
        .description(WL("widget.description"))
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryInline, .accessoryCircular, .accessoryRectangular])
    }
}

struct GlucoseEntry: TimelineEntry {
    let date: Date
    /// nil: no reading yet.
    let state: LiveGlucoseState?
    let isStale: Bool
    let isDemo: Bool
    let unit: GlucoseUnit

    var color: Color {
        guard let state else { return .gray }
        return GlucoseGlance.color(state, isStale: isStale)
    }
}

struct GlucoseProvider: TimelineProvider {
    func placeholder(in context: Context) -> GlucoseEntry {
        GlucoseTimelineLoader.demoEntry(now: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (GlucoseEntry) -> Void) {
        // The widget gallery shows the demo, labelled "Demo"; on the screen, what is stored.
        completion(context.isPreview ? GlucoseTimelineLoader.demoEntry(now: Date()) : GlucoseTimelineLoader.storedEntry(now: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<GlucoseEntry>) -> Void) {
        Task {
            completion(await GlucoseTimelineLoader.timeline(now: Date()))
        }
    }
}

/// Builds the timelines from the app group's snapshot, the demo curve, or a read of the site.
enum GlucoseTimelineLoader {
    static func timeline(now: Date) async -> Timeline<GlucoseEntry> {
        let source = FollowSourceStore.load()
        let stored = GlucoseSnapshotStore.load()
        switch WidgetTimeline.feed(source: source, snapshot: stored, now: now) {
        case .demo:
            return timeline(WidgetTimeline.demo(now: now), isDemo: true)
        case .fetch(let followed):
            // The next reading is due and the phone may not have opened the app for hours: read the
            // site like the app does (GET, read-only token in the header, FollowCore's client).
            var snapshot = WidgetTimeline.usable(stored, for: followed)
            let feed = ReadingFeed(client: NightscoutClient(transport: URLSessionTransport()))
            if let fetched = try? await feed.latest(followed, count: 2, now: now) {
                let merged = WidgetTimeline.merge(snapshot, fetched: fetched, site: followed.stored.site)
                if let merged, merged != snapshot { GlucoseSnapshotStore.save(merged) }
                snapshot = merged
            }
            return timeline(WidgetTimeline.make(snapshot, now: now), isDemo: false)
        case .stored:
            let snapshot = WidgetTimeline.usable(stored, for: source)
            return timeline(WidgetTimeline.make(snapshot, now: now), isDemo: snapshot?.isDemo ?? false)
        }
    }

    /// What is on hand now, without the network: for the snapshot iOS asks for in a hurry.
    static func storedEntry(now: Date) -> GlucoseEntry {
        let source = FollowSourceStore.load()
        let stored = GlucoseSnapshotStore.load()
        if WidgetTimeline.feed(source: source, snapshot: stored, now: now) == .demo { return demoEntry(now: now) }
        let snapshot = WidgetTimeline.usable(stored, for: source)
        let plan = WidgetTimeline.make(snapshot, now: now)
        return entries(plan, isDemo: snapshot?.isDemo ?? false)[0]
    }

    static func demoEntry(now: Date) -> GlucoseEntry {
        entries(WidgetTimeline.demo(now: now), isDemo: true)[0]
    }

    private static func timeline(_ plan: WidgetTimelinePlan, isDemo: Bool) -> Timeline<GlucoseEntry> {
        Timeline(entries: entries(plan, isDemo: isDemo), policy: .after(plan.refreshAt))
    }

    private static func entries(_ plan: WidgetTimelinePlan, isDemo: Bool) -> [GlucoseEntry] {
        let unit = SettingsStore.load().unit
        return plan.entries.map {
            GlucoseEntry(date: $0.date, state: $0.state, isStale: $0.isStale, isDemo: isDemo, unit: unit)
        }
    }
}

struct GlucoseWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: GlucoseEntry

    var body: some View {
        content
            .environment(\.locale, AppLanguage.locale)
            .containerBackground(.fill.tertiary, for: .widget)
    }

    @ViewBuilder
    private var content: some View {
        if let state = entry.state {
            switch family {
            case .accessoryInline: InlineView(entry: entry, state: state)
            case .accessoryCircular: CircularView(entry: entry, state: state)
            case .accessoryRectangular: RectangularView(entry: entry, state: state)
            case .systemMedium: MediumWidgetView(entry: entry, state: state)
            default: SmallWidgetView(entry: entry, state: state)
            }
        } else {
            NoDataView(family: family)
        }
    }
}

/// Home screen, StandBy and CarPlay: the value and arrow as large as fits, the unit and change
/// under it, the age at the bottom.
private struct SmallWidgetView: View {
    let entry: GlucoseEntry
    let state: LiveGlucoseState

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ValueText(state: state, unit: entry.unit, color: entry.color, size: 46)
            HStack(spacing: 6) {
                Text(entry.isDemo ? "\(entry.unit.label) · \(WL("widget.demo"))" : entry.unit.label)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
                DeltaText(state: state, unit: entry.unit, font: .caption)
            }
            .font(.caption)
            Spacer(minLength: 0)
            if entry.isStale { StaleLabel(font: .caption2) }
            AgeText(readingAt: state.readingAt, isStale: entry.isStale, font: .footnote.weight(.semibold))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// Home screen, medium: the value large on the left, the change and age on the right.
private struct MediumWidgetView: View {
    let entry: GlucoseEntry
    let state: LiveGlucoseState

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 0) {
                ValueText(state: state, unit: entry.unit, color: entry.color, size: 60)
                Text(entry.unit.label).font(.footnote).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 4) {
                DeltaText(state: state, unit: entry.unit, font: .title3)
                AgeText(readingAt: state.readingAt, isStale: entry.isStale, font: .subheadline.weight(.semibold))
                if entry.isStale { StaleLabel(font: .caption) }
                if entry.isDemo {
                    Text(WL("widget.demo")).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Lock screen, rectangular: value, arrow and unit on the first line; the age; the change, or "No new
/// readings" once stale.
private struct RectangularView: View {
    let entry: GlucoseEntry
    let state: LiveGlucoseState

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                ValueText(state: state, unit: entry.unit, color: entry.color, size: 26)
                Text(entry.unit.label).font(.caption2).foregroundStyle(.secondary)
            }
            AgeText(readingAt: state.readingAt, isStale: entry.isStale, font: .caption)
            if entry.isStale {
                StaleLabel(font: .caption2)
            } else {
                DeltaText(state: state, unit: entry.unit, font: .caption)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Lock screen, round: the value, the arrow (the clock badge once stale) and the age as m:ss.
private struct CircularView: View {
    let entry: GlucoseEntry
    let state: LiveGlucoseState

    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 0) {
                Text(Glucose.format(state.mgdl, unit: entry.unit, locale: AppLanguage.locale))
                    .font(.system(size: 20, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                    .foregroundStyle(entry.color)
                if entry.isStale {
                    Image(systemName: GlucoseGlance.staleSymbol).font(.system(size: 11))
                } else {
                    Text(Glucose.arrow(state.direction).isEmpty ? "–" : Glucose.arrow(state.direction))
                        .font(.system(size: 13, weight: .bold))
                }
                ShortAgeText(readingAt: state.readingAt)
                    .font(.system(size: 10, weight: .semibold))
                    .frame(maxWidth: 44)
            }
            .padding(4)
        }
    }
}

/// Lock screen, the line above the clock: "8,4 ↗ · 3:12 siden", with the clock badge once stale.
private struct InlineView: View {
    let entry: GlucoseEntry
    let state: LiveGlucoseState

    var body: some View {
        let line = Text(verbatim: "\(GlucoseGlance.valueAndArrow(state, unit: entry.unit)) · ")
            + Text(state.readingAt, style: .timer)
            + Text(verbatim: " \(AppLanguage.current.agoSuffix)")
        if entry.isStale {
            Label { line } icon: { Image(systemName: GlucoseGlance.staleSymbol) }
        } else {
            line
        }
    }
}

/// Before the phone has a reading: the app has not been set up, or has not read anything yet.
private struct NoDataView: View {
    let family: WidgetFamily

    var body: some View {
        switch family {
        case .accessoryInline:
            Text(WL("widget.noData"))
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                Text("–").font(.system(size: 20, weight: .bold, design: .rounded))
            }
        default:
            VStack(alignment: .leading, spacing: 2) {
                Text(WL("widget.noData")).font(.headline)
                Text(WL("widget.noData.hint")).font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
    }
}
