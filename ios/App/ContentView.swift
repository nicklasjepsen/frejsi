import FollowCore
import SwiftUI
import UIKit

/// The bare stage-2 screen: the value with its age, a button that starts the Live Activity, and the
/// two push tokens for the push test. Stage 3 replaces it with the real app (onboarding, curve,
/// settings, da/en).
struct ContentView: View {
    @EnvironmentObject private var model: FollowModel
    @EnvironmentObject private var activities: LiveActivityController
    @State private var siteField = ""
    @State private var tokenField = ""

    var body: some View {
        NavigationStack {
            Form {
                if model.isConfigured {
                    Section { reading }
                    Section(Self.say("Live Activity", "Live Activity")) { liveActivity }
                    Section {
                        thresholdSteppers
                    } header: {
                        Text(Self.say("Colours", "Farver"))
                    } footer: {
                        Text(Self.say(
                            "Green from low to high, yellow outside it, red at or beyond the urgent values, grey when the reading is more than 15 minutes old. Colours only: no alarms.",
                            "Grøn fra lav til høj, gul uden for, rød ved eller forbi de akutte værdier, grå når målingen er mere end 15 minutter gammel. Kun farver, ingen alarmer."
                        ))
                    }
                    Section(Self.say("Push tokens (for the push test)", "Push-tokens (til pushtesten)")) { tokens }
                }
                Section("Nightscout") { connection }
                Section {
                    Text(Self.say("Keep the CGM app and its alarms. This shows the glucose; it does not monitor it.", "Behold CGM-appen og dens alarmer. Nænsom viser blodsukkeret; den overvåger det ikke."))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Nænsom")
            .refreshable { await model.refresh() }
        }
        .task(id: model.site + model.token) { await model.refreshWhileVisible() }
    }

    @ViewBuilder private var reading: some View {
        if let latest = model.latest {
            // TimelineView re-renders the age every 30 s; the value never appears without it.
            TimelineView(.periodic(from: .now, by: 30)) { context in
                let stale = Glucose.isStale(latest, now: context.date)
                let colour = Glucose.color(latest, thresholds: model.thresholds, now: context.date).color
                let language = AppLanguage.current
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline) {
                        Text("\(Glucose.format(latest.mgdl, unit: .mmolL, locale: AppLanguage.locale)) \(Glucose.arrow(latest.direction))")
                            .font(.system(size: 56, weight: .semibold, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(colour)
                        Text(GlucoseUnit.mmolL.label).foregroundStyle(.secondary)
                    }
                    HStack {
                        Text(Glucose.ageText(latest, now: context.date, language: language))
                        if let delta = Glucose.formatDelta(latest, previous: model.previous, unit: .mmolL, locale: AppLanguage.locale) {
                            Text("· \(delta)")
                        }
                        if stale { Text(Self.say("· no new readings", "· ingen nye målinger")).foregroundStyle(.orange) }
                    }
                    .foregroundStyle(.secondary)
                }
            }
        } else if let error = model.error {
            Text(error).foregroundStyle(.orange)
        } else {
            ProgressView()
        }
    }

    @ViewBuilder private var liveActivity: some View {
        if activities.isRunning {
            Label(Self.say("Running", "Kører"), systemImage: "checkmark.circle")
            Button(Self.say("End Live Activity", "Stop Live Activity"), role: .destructive) { activities.endAll() }
        } else if let latest = model.latest {
            Button(Self.say("Start Live Activity", "Start Live Activity")) { activities.start(current: latest, previous: model.previous) }
        } else {
            Text(Self.say("Waiting for a reading", "Venter på en måling")).foregroundStyle(.secondary)
        }
        if let error = activities.error {
            Text(error).foregroundStyle(.orange)
        }
    }

    @ViewBuilder private var thresholdSteppers: some View {
        ForEach(GlucoseThresholds.Kind.allCases, id: \.self) { kind in
            Stepper {
                HStack {
                    Text(Self.label(kind))
                    Spacer()
                    Text("\(model.thresholds.formatted(kind, unit: .mmolL, locale: AppLanguage.locale)) \(GlucoseUnit.mmolL.label)")
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
            } onIncrement: {
                model.step(kind, by: 1, unit: .mmolL)
                activities.redraw()
            } onDecrement: {
                model.step(kind, by: -1, unit: .mmolL)
                activities.redraw()
            }
        }
        Button(Self.say("Use the Nightscout site's values", "Brug Nightscout-sidens værdier")) {
            model.resetThresholds()
            activities.redraw()
        }
    }

    private static func label(_ kind: GlucoseThresholds.Kind) -> String {
        switch kind {
        case .urgentLow: return say("Urgent low", "Akut lav")
        case .low: return say("Low", "Lav")
        case .high: return say("High", "Høj")
        case .urgentHigh: return say("Urgent high", "Akut høj")
        }
    }

    private static func say(_ english: String, _ danish: String) -> String {
        AppLanguage.say(english, danish)
    }

    @ViewBuilder private var tokens: some View {
        TokenRow(title: Self.say("Activity", "Aktivitet"), token: activities.activityToken)
        TokenRow(title: "Push-to-start", token: activities.pushToStartToken)
    }

    @ViewBuilder private var connection: some View {
        TextField(Self.say("Site address", "Sidens adresse"), text: $siteField, prompt: Text("https://…"))
            .textContentType(.URL)
            .keyboardType(.URL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
        SecureField(Self.say("Read-only token", "Token kun til læsning"), text: $tokenField)
        Button(Self.say("Save", "Gem")) { model.save(site: siteField, token: tokenField) }
            .disabled(siteField.isEmpty || tokenField.isEmpty)
            .onAppear {
                if siteField.isEmpty { siteField = model.site }
            }
    }
}

private struct TokenRow: View {
    let title: String
    let token: String?

    var body: some View {
        HStack {
            VStack(alignment: .leading) {
                Text(title)
                Text(token.map { "\($0.prefix(8))…\($0.suffix(6))" } ?? AppLanguage.say("not yet", "endnu ikke"))
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if let token {
                Button(AppLanguage.say("Copy", "Kopiér")) { UIPasteboard.general.string = token }
            }
        }
    }
}
