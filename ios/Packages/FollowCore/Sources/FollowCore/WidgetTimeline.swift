import Foundation

/// The newest reading and the one before it, kept in the app group for the widgets (plan §1). The app
/// writes it whenever a fetch brings a newer reading; the widget extension reads it, and writes it
/// back when it reads the site itself. `site` is the followed site as the Keychain stores it
/// (`FollowSource.stored.site`, "demo" for the demo), so a snapshot of one site never shows while
/// the phone follows another. No token is in it.
public struct GlucoseSnapshot: Codable, Equatable, Sendable {
    public var site: String
    public var current: Reading
    public var previous: Reading?

    public init(site: String, current: Reading, previous: Reading?) {
        self.site = site
        self.current = current
        self.previous = previous
    }

    public var isDemo: Bool { site == DemoCurve.siteMarker }

    /// What a widget draws: the value, trend, change (only from a recent previous reading) and time,
    /// the same state the Live Activity shows.
    public var state: LiveGlucoseState { LiveGlucoseState(current: current, previous: previous) }

    /// Whether `fresh` should be written over what is stored: always for another site, otherwise
    /// only for a newer reading (or the same reading with a different previous one), so a late
    /// fetch never puts an older value back.
    public static func shouldReplace(_ stored: GlucoseSnapshot?, with fresh: GlucoseSnapshot) -> Bool {
        guard let stored, stored.site == fresh.site else { return true }
        if fresh.current.at != stored.current.at { return fresh.current.at > stored.current.at }
        return fresh != stored
    }

    /// JSON with times in Unix seconds.
    public func encoded() -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970
        encoder.outputFormatting = [.sortedKeys]
        return (try? encoder.encode(self)) ?? Data()
    }

    /// The stored copy, or nil when there is none or it cannot be read.
    public static func decode(_ data: Data?) -> GlucoseSnapshot? {
        guard let data else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        return try? decoder.decode(GlucoseSnapshot.self, from: data)
    }
}

/// One moment of a widget's timeline: what it shows from `date` until the next entry. `state` is
/// nil before the phone has any reading ("No data yet").
public struct WidgetEntry: Equatable, Sendable {
    public var date: Date
    public var state: LiveGlucoseState?
    /// Grey, with the clock badge and "No new readings": the reading is 15 minutes old or more.
    public var isStale: Bool

    public init(date: Date, state: LiveGlucoseState?, isStale: Bool) {
        self.date = date
        self.state = state
        self.isStale = isStale
    }
}

/// The entries a widget shows and when it asks for new ones.
public struct WidgetTimelinePlan: Equatable, Sendable {
    public var entries: [WidgetEntry]
    public var refreshAt: Date

    public init(entries: [WidgetEntry], refreshAt: Date) {
        self.entries = entries
        self.refreshAt = refreshAt
    }
}

/// Where a widget's reading comes from on a timeline request.
public enum WidgetFeed: Equatable, Sendable {
    /// The made-up curve: computed, no network.
    case demo
    /// The next reading is due: read the site (GET, read-only token) and keep the newer of that and
    /// the snapshot.
    case fetch(FollowSource)
    /// The snapshot the app (or an earlier widget request) stored, as it is.
    case stored
}

/// The widgets' timelines (plan §1: "they always show their age and go grey when stale"). iOS limits
/// how often a widget asks for a new timeline, so each timeline carries its own stale moment: the
/// value turns grey 15 minutes after the reading even when no refresh comes. The age is a relative
/// time iOS ticks forward itself, so it is never older than it says.
public enum WidgetTimeline {
    /// Nightscout gets a reading every five minutes.
    public static let expectedInterval: TimeInterval = 300
    /// Time for the uploader to get the reading to the site.
    public static let uploadGrace: TimeInterval = 60
    /// No refresh sooner than this.
    public static let minimumRefresh: TimeInterval = 60
    /// While a reading is overdue, ask again this often…
    public static let overdueRefresh: TimeInterval = 5 * 60
    /// …until the newest reading is this old, then less often: the sensor or uploader is likely off.
    public static let longOverdueAfter: TimeInterval = 20 * 60
    public static let longOverdueRefresh: TimeInterval = 15 * 60
    /// Before there is any reading.
    public static let emptyRefresh: TimeInterval = 15 * 60
    /// How far ahead the demo's timeline goes.
    public static let demoHorizon: TimeInterval = 3600

    /// Which reading to draw from: the demo, the site, or the stored snapshot. Without a readable
    /// credential (before the app has shared it, or before the first unlock after a restart) the
    /// snapshot is all there is.
    public static func feed(source: FollowSource?, snapshot: GlucoseSnapshot?, now: Date) -> WidgetFeed {
        guard let source else { return snapshot?.isDemo == true ? .demo : .stored }
        if source.isDemo { return .demo }
        return shouldFetch(usable(snapshot, for: source), now: now) ? .fetch(source) : .stored
    }

    /// The snapshot, when it belongs to the followed site (any snapshot when that is unknown).
    public static func usable(_ snapshot: GlucoseSnapshot?, for source: FollowSource?) -> GlucoseSnapshot? {
        guard let snapshot else { return nil }
        guard let source else { return snapshot }
        return snapshot.site == source.stored.site ? snapshot : nil
    }

    /// Read the site only when the next reading may be there: none yet, or the newest is five minutes old.
    public static func shouldFetch(_ snapshot: GlucoseSnapshot?, now: Date) -> Bool {
        guard let snapshot else { return true }
        return now >= snapshot.current.at.addingTimeInterval(expectedInterval)
    }

    /// The newer of the stored snapshot and what the site answered (newest first).
    public static func merge(_ stored: GlucoseSnapshot?, fetched: [Reading], site: String) -> GlucoseSnapshot? {
        guard let newest = fetched.first else { return stored }
        let fresh = GlucoseSnapshot(site: site, current: newest, previous: fetched.dropFirst().first)
        return GlucoseSnapshot.shouldReplace(stored, with: fresh) ? fresh : stored
    }

    /// What a site read leads to, decided after it answered, against what is true then: the phone
    /// may have been removed or switched to another site, or the app may have stored a newer
    /// reading, while the widget waited. `source` and `stored` are read again after the answer.
    /// Answers the snapshot to show and whether to store it: an answer for a site the phone no
    /// longer follows is dropped, and the stored snapshot wins when it is as new or newer.
    public static func afterFetch(
        asked: FollowSource, fetched: [Reading], source: FollowSource?, stored: GlucoseSnapshot?
    ) -> (show: GlucoseSnapshot?, store: Bool) {
        let current = usable(stored, for: source)
        guard source == asked else { return (current, false) }
        let merged = merge(current, fetched: fetched, site: asked.stored.site)
        return (merged, merged != current)
    }

    /// When to ask for a new timeline: just after the next reading is due (reading + 5 min + 1 min),
    /// then every 5 minutes while it is overdue, every 15 once the newest is 20 minutes old. iOS
    /// may come later than asked; the stale entry covers that.
    public static func nextRefresh(readingAt: Date, now: Date) -> Date {
        let due = readingAt.addingTimeInterval(expectedInterval + uploadGrace)
        let next: Date
        if due > now {
            next = due
        } else if now.timeIntervalSince(readingAt) < longOverdueAfter {
            next = now.addingTimeInterval(overdueRefresh)
        } else {
            next = now.addingTimeInterval(longOverdueRefresh)
        }
        return max(next, now.addingTimeInterval(minimumRefresh))
    }

    /// The timeline for a snapshot: the reading now, and the same reading grey from its stale moment
    /// (reading + 15 min, the Live Activity's `staleDate`) when that is still ahead.
    public static func make(_ snapshot: GlucoseSnapshot?, now: Date) -> WidgetTimelinePlan {
        guard let snapshot else {
            return WidgetTimelinePlan(
                entries: [WidgetEntry(date: now, state: nil, isStale: false)],
                refreshAt: now.addingTimeInterval(emptyRefresh)
            )
        }
        let state = snapshot.state
        let staleAt = state.staleDate
        var entries = [WidgetEntry(date: now, state: state, isStale: now >= staleAt)]
        if staleAt > now {
            entries.append(WidgetEntry(date: staleAt, state: state, isStale: true))
        }
        return WidgetTimelinePlan(entries: entries, refreshAt: nextRefresh(readingAt: snapshot.current.at, now: now))
    }

    /// The demo for the next hour: one entry per demo reading, each at its five-minute mark (the
    /// first at `now`), computed like the app's `DemoCurve`, then a new timeline.
    public static func demo(now: Date) -> WidgetTimelinePlan {
        var entries: [WidgetEntry] = []
        var mark = DemoCurve.reading(atOrBefore: now).at
        let end = mark.addingTimeInterval(demoHorizon)
        while mark < end {
            let pair = DemoCurve.latest(now: mark, count: 2)
            entries.append(WidgetEntry(
                date: max(mark, now),
                state: LiveGlucoseState(current: pair[0], previous: pair.dropFirst().first),
                isStale: false
            ))
            mark = mark.addingTimeInterval(DemoCurve.interval)
        }
        return WidgetTimelinePlan(entries: entries, refreshAt: mark)
    }
}
