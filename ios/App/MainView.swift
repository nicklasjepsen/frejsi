import Charts
import FollowCore
import SwiftUI

/// The main screen (plan §1, §3): the value in its colour with arrow, change and age; the curve;
/// the Live Activity's state. Every value is shown with its age, and colour is never the only
/// signal: a stale reading also says so in words.
struct MainView: View {
    @EnvironmentObject private var app: AppModel
    @EnvironmentObject private var follow: FollowModel
    @EnvironmentObject private var live: LiveActivityController
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // The name as the brand writes it, lower case and larger than a navigation
                    // title, in the value's rounded face.
                    Text(verbatim: "nænsom")
                        .font(.system(size: 44, weight: .bold, design: .rounded))
                        .accessibilityAddTraits(.isHeader)
                    ReadingHeader()
                    LiveActivityBanner()
                    CurveSection()
                    if follow.source?.isDemo == true {
                        Label(L("main.demo"), systemImage: "theatermasks")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    Text(L("disclaimer"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .padding()
            }
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showSettings = true
                    } label: {
                        Label(L("settings.title"), systemImage: "gearshape")
                    }
                }
            }
            .refreshable { await follow.refresh() }
            .sheet(isPresented: $showSettings) { SettingsView() }
        }
        .task(id: follow.sourceKey) { await follow.refreshWhileVisible() }
    }
}

/// The value, arrow, unit, change and age. Re-rendered every 15 seconds so the age and the
/// stale state stay true between readings.
private struct ReadingHeader: View {
    @EnvironmentObject private var follow: FollowModel

    var body: some View {
        if let latest = follow.latest {
            TimelineView(.periodic(from: .now, by: 15)) { context in
                content(latest, now: context.date)
            }
        } else if let error = follow.error {
            Label(error.message(in: AppLanguage.current), systemImage: "exclamationmark.triangle")
                .foregroundStyle(.orange)
        } else {
            HStack(spacing: 10) {
                ProgressView()
                Text(L("main.loading")).foregroundStyle(.secondary)
            }
        }
    }

    private func content(_ latest: Reading, now: Date) -> some View {
        let unit = follow.settings.unit
        let stale = Glucose.isStale(latest, now: now)
        let colour = Glucose.color(latest, thresholds: follow.thresholds, now: now).color
        let value = Glucose.format(latest.mgdl, unit: unit, locale: AppLanguage.locale)
        let arrow = Glucose.arrow(latest.direction)
        let age = Glucose.ageText(latest, now: now, language: AppLanguage.current)
        let delta = Glucose.formatDelta(latest, previous: follow.previous, unit: unit, locale: AppLanguage.locale)
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(arrow.isEmpty ? value : "\(value) \(arrow)")
                    .font(.system(size: 64, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(colour)
                Text(unit.label)
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 6) {
                Text(age)
                if let delta {
                    Text("·")
                    Text(delta).monospacedDigit()
                }
            }
            .font(.title3)
            .foregroundStyle(.secondary)
            if stale {
                Label(L("main.stale"), systemImage: "clock.badge.exclamationmark")
                    .font(.callout.weight(.medium))
                    .foregroundStyle(.secondary)
            }
            if let error = follow.error {
                Label(error.message(in: AppLanguage.current), systemImage: "wifi.exclamationmark")
                    .font(.footnote)
                    .foregroundStyle(.orange)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// "Live Activity stopped, tap to restart" (plan §4 fallback) when it should be running and is not:
/// it ended after 8 hours without a push-to-start, or it was swiped away.
private struct LiveActivityBanner: View {
    @EnvironmentObject private var app: AppModel
    @EnvironmentObject private var follow: FollowModel
    @EnvironmentObject private var live: LiveActivityController

    var body: some View {
        let status = LiveActivitySync.status(wanted: follow.settings.liveActivityOn, running: live.isRunning)
        VStack(alignment: .leading, spacing: 6) {
            if status == .stopped, !app.startingActivity, follow.latest != nil {
                Button {
                    Task { await app.startActivity() }
                } label: {
                    Label(L("main.liveStopped"), systemImage: "arrow.clockwise")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                        .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
            }
            if let error = live.error {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.orange)
            }
        }
    }
}

/// The 3/6/12-hour curve with the window picker.
private struct CurveSection: View {
    @EnvironmentObject private var app: AppModel
    @EnvironmentObject private var follow: FollowModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Picker(L("main.window"), selection: Binding(get: { follow.settings.curveWindow }, set: { app.setCurveWindow($0) })) {
                ForEach(CurveWindow.allCases, id: \.self) { window in
                    Text(L("main.window.hours", window.hours)).tag(window)
                }
            }
            .pickerStyle(.segmented)
            TimelineView(.periodic(from: .now, by: 60)) { context in
                CurveChart(
                    points: ReadingHistory.points(follow.readings, window: follow.settings.curveWindow, now: context.date),
                    window: follow.settings.curveWindow,
                    thresholds: follow.thresholds,
                    unit: follow.settings.unit,
                    now: context.date
                )
            }
        }
    }
}

/// One dot per reading, coloured by its band; the target range as a faint green band and the
/// urgent values as faint dashed lines. The x axis is the time of day. Tapping near a dot shows
/// that reading's exact value and its time; tapping it again, or far from any dot, hides it.
private struct CurveChart: View {
    let points: [Reading]
    let window: CurveWindow
    let thresholds: GlucoseThresholds
    let unit: GlucoseUnit
    let now: Date
    @State private var selectedAt: Date?

    /// The selected reading, while it is still on the curve.
    private var selected: Reading? {
        guard let selectedAt else { return nil }
        return points.first { $0.at == selectedAt }
    }

    var body: some View {
        let start = now.addingTimeInterval(-window.duration)
        let domain = ReadingHistory.yDomainMgdl(points, thresholds: thresholds)
        let low = Double(domain.lowerBound)
        let high = Double(domain.upperBound)
        Chart {
            RectangleMark(
                xStart: .value("Start", start),
                xEnd: .value("End", now),
                yStart: .value("Low", shown(Double(thresholds.lowMgdl))),
                yEnd: .value("High", shown(Double(thresholds.highMgdl)))
            )
            .foregroundStyle(Color.green.opacity(0.1))
            ForEach([thresholds.urgentLowMgdl, thresholds.urgentHighMgdl].filter { Double($0) > low && Double($0) < high }, id: \.self) { urgent in
                RuleMark(y: .value("Urgent", shown(Double(urgent))))
                    .foregroundStyle(Color.red.opacity(0.35))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
            }
            ForEach(points, id: \.at) { reading in
                PointMark(
                    x: .value("Time", reading.at),
                    y: .value("Glucose", shown(Double(reading.mgdl)))
                )
                .symbolSize(22)
                .foregroundStyle(Glucose.color(reading.mgdl, thresholds: thresholds, isStale: false).color)
            }
            if let selected {
                RuleMark(x: .value("Selected", selected.at))
                    .foregroundStyle(Color.secondary.opacity(0.4))
                    .lineStyle(StrokeStyle(lineWidth: 1))
                    .annotation(
                        position: .top,
                        spacing: 4,
                        overflowResolution: .init(x: .fit(to: .chart), y: .fit(to: .chart))
                    ) {
                        SelectedReadingLabel(reading: selected, unit: unit, thresholds: thresholds)
                    }
                PointMark(
                    x: .value("Time", selected.at),
                    y: .value("Glucose", shown(Double(selected.mgdl)))
                )
                .symbolSize(90)
                .foregroundStyle(Glucose.color(selected.mgdl, thresholds: thresholds, isStale: false).color)
            }
        }
        .chartOverlay { proxy in
            GeometryReader { geometry in
                Rectangle()
                    .fill(.clear)
                    .contentShape(Rectangle())
                    .gesture(
                        SpatialTapGesture().onEnded { tap in
                            select(at: tap.location, proxy: proxy, geometry: geometry)
                        }
                    )
            }
        }
        .chartXScale(domain: start...now)
        .chartYScale(domain: shown(low)...shown(high))
        .chartXAxis {
            AxisMarks(values: .stride(by: .hour, count: window == .twelveHours ? 3 : 1)) { _ in
                AxisGridLine()
                AxisValueLabel(format: .dateTime.hour())
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading)
        }
        .frame(height: 240)
        .accessibilityLabel(L("main.curve", window.hours))
        .overlay {
            if points.isEmpty {
                Text(L("main.curve.empty"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    /// Selects the reading nearest the tap in time, within a quarter of an hour; a second tap on
    /// the same reading, or a tap with no reading near, clears the selection.
    private func select(at location: CGPoint, proxy: ChartProxy, geometry: GeometryProxy) {
        guard let plotFrame = proxy.plotFrame else { return }
        let x = location.x - geometry[plotFrame].origin.x
        guard let tapped: Date = proxy.value(atX: x) else { return }
        let nearest = points.min { abs($0.at.timeIntervalSince(tapped)) < abs($1.at.timeIntervalSince(tapped)) }
        guard let nearest, abs(nearest.at.timeIntervalSince(tapped)) <= 15 * 60 else {
            selectedAt = nil
            return
        }
        selectedAt = selectedAt == nearest.at ? nil : nearest.at
    }

    /// mg/dL in the shown unit, unrounded so the band edges sit exactly.
    private func shown(_ mgdl: Double) -> Double {
        unit == .mmolL ? mgdl / Glucose.mgdlPerMmolL : mgdl
    }
}

/// The exact value of a tapped reading, with the time it was read, since a value is never shown
/// without when it is from.
private struct SelectedReadingLabel: View {
    let reading: Reading
    let unit: GlucoseUnit
    let thresholds: GlucoseThresholds

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(Glucose.format(reading.mgdl, unit: unit, locale: AppLanguage.locale))
                    .font(.system(.title3, design: .rounded).weight(.bold))
                    .monospacedDigit()
                    .foregroundStyle(Glucose.color(reading.mgdl, thresholds: thresholds, isStale: false).color)
                Text(unit.label)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Text(reading.at, format: .dateTime.hour().minute())
                .font(.caption)
                .monospacedDigit()
                .foregroundStyle(.secondary)
        }
        .environment(\.locale, AppLanguage.locale)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        // Opaque and in the plain text colour: inside a chart annotation the mark's colour would
        // otherwise tint the background and the secondary text, leaving green on green.
        .foregroundStyle(Color.primary)
        .background {
            RoundedRectangle(cornerRadius: 8)
                .fill(Color(uiColor: .systemBackground))
                .shadow(color: .black.opacity(0.15), radius: 4, y: 1)
        }
        .accessibilityElement(children: .combine)
    }
}
