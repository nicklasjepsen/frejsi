import FollowCore
import Foundation
import WidgetKit

/// Keeps the widgets in step with the app (plan §1): every newer reading the app fetches goes to the
/// app group (`GlucoseSnapshotStore`) and the widgets are asked for new timelines, as are changes to
/// the unit or the colour thresholds, which the widgets read from the app group when they draw.
/// iOS decides when they actually redraw; until then they show their age and go grey on their own.
enum WidgetSync {
    static func publish(current: Reading, previous: Reading?, source: FollowSource) {
        let snapshot = GlucoseSnapshot(site: source.stored.site, current: current, previous: previous)
        if GlucoseSnapshotStore.save(snapshot) { reload() }
    }

    /// Another site, or "Remove this phone": the widgets go back to "No data yet".
    static func clear() {
        GlucoseSnapshotStore.clear()
        reload()
    }

    static func reload() {
        WidgetCenter.shared.reloadAllTimelines()
    }
}
