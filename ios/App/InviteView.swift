import CoreImage.CIFilterBuiltins
import FollowCore
import SwiftUI

/// The admin token for invites (owner, 2026-11-09): kept only in the app's own Keychain group (not
/// the widgets'), tied to the site it was added for, never sent to the relay. "Remove this phone"
/// and following another site forget it.
enum InviteAdminStore {
    private static let tokenAccount = "inviteAdminToken"
    private static let siteAccount = "inviteAdminSite"

    static func token(for site: URL) -> String? {
        guard KeychainStore.read(siteAccount) == site.absoluteString,
              let token = KeychainStore.read(tokenAccount), !token.isEmpty
        else { return nil }
        return token
    }

    static func save(_ token: String, for site: URL) {
        KeychainStore.write(siteAccount, site.absoluteString)
        KeychainStore.write(tokenAccount, token)
    }

    static func clear() {
        KeychainStore.delete(tokenAccount)
        KeychainStore.delete(siteAccount)
    }
}

/// "Invite someone" (Settings). With an admin token for the followed site on this phone, each
/// person gets their own read-only Nightscout token, made here, sent as a follow link or shown as
/// a QR code; removing them deletes that token, so their app stops at once. Without one, the screen
/// only asks for it: a phone that follows with a read-only token (everyone invited) cannot invite.
struct InviteView: View {
    let site: URL
    @State private var adminToken: String?
    @State private var typedAdminToken = ""
    @State private var invites: [Invite] = []
    @State private var newName = ""
    @State private var working = false
    @State private var problem: String?
    @State private var shown: Invite?
    @State private var removing: Invite?

    private let api = NightscoutInvites(transport: URLSessionTransport())

    init(site: URL) {
        self.site = site
        _adminToken = State(initialValue: InviteAdminStore.token(for: site))
    }

    var body: some View {
        Form {
            if adminToken == nil {
                adminSetup
            } else {
                newInvite
                invitedList
                Section {
                    Button(L("invite.admin.forget"), role: .destructive) {
                        InviteAdminStore.clear()
                        adminToken = nil
                        invites = []
                    }
                } footer: {
                    Text(L("invite.admin.forget.footer"))
                }
            }
            if let problem {
                Section { Label(problem, systemImage: "exclamationmark.triangle").foregroundStyle(.orange) }
            }
        }
        .disabled(working)
        .navigationTitle(L("invite.title"))
        .navigationBarTitleDisplayMode(.inline)
        .task(id: adminToken) { await reload() }
        .sheet(item: $shown) { invite in
            InviteLinkSheet(invite: invite, link: FollowLink(site: site, token: invite.accessToken).url())
        }
        .confirmationDialog(
            L("invite.remove.confirm", removing?.name ?? ""),
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
            titleVisibility: .visible
        ) {
            Button(L("invite.remove"), role: .destructive) {
                if let invite = removing { Task { await remove(invite) } }
            }
        } message: {
            Text(L("invite.remove.footer"))
        }
    }

    private var adminSetup: some View {
        Section {
            SecureField(L("invite.admin.token"), text: $typedAdminToken)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button(L("invite.admin.save")) { Task { await saveAdmin() } }
                .disabled(typedAdminToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        } header: {
            Text(L("invite.admin.header"))
        } footer: {
            Text(L("invite.admin.footer"))
        }
    }

    private var newInvite: some View {
        Section {
            TextField(L("invite.name"), text: $newName)
                .textInputAutocapitalization(.words)
            Button {
                Task { await create() }
            } label: {
                Label(L("invite.create"), systemImage: "person.badge.plus")
            }
            .disabled(NightscoutInvites.cleanName(newName).isEmpty)
        } header: {
            Text(L("invite.new"))
        } footer: {
            Text(L("invite.new.footer"))
        }
    }

    private var invitedList: some View {
        Section {
            if invites.isEmpty {
                Text(L("invite.none")).foregroundStyle(.secondary)
            }
            ForEach(invites) { invite in
                HStack {
                    Button(invite.name) { shown = invite }
                    Spacer()
                    Button(L("invite.remove"), role: .destructive) { removing = invite }
                        .buttonStyle(.borderless)
                }
            }
        } header: {
            Text(L("invite.list"))
        } footer: {
            Text(L("invite.list.footer"))
        }
    }

    private func saveAdmin() async {
        let token = typedAdminToken.trimmingCharacters(in: .whitespacesAndNewlines)
        await run {
            guard try await api.isAdmin(site: site, adminToken: token) else {
                problem = L("invite.admin.notAdmin")
                return
            }
            InviteAdminStore.save(token, for: site)
            typedAdminToken = ""
            adminToken = token
        }
    }

    private func reload() async {
        guard let adminToken else { return }
        await run { invites = try await api.list(site: site, adminToken: adminToken) }
    }

    private func create() async {
        guard let adminToken else { return }
        await run {
            let invite = try await api.create(site: site, adminToken: adminToken, name: newName)
            newName = ""
            invites = try await api.list(site: site, adminToken: adminToken)
            shown = invite
        }
    }

    private func remove(_ invite: Invite) async {
        guard let adminToken else { return }
        removing = nil
        await run {
            try await api.remove(site: site, adminToken: adminToken, id: invite.id)
            invites = try await api.list(site: site, adminToken: adminToken)
        }
    }

    private func run(_ work: () async throws -> Void) async {
        working = true
        problem = nil
        defer { working = false }
        do {
            try await work()
        } catch let error as NightscoutError {
            problem = error == .tokenRefused ? L("invite.admin.notAdmin") : error.message(in: AppLanguage.current)
        } catch {
            problem = NightscoutError.unreachable.message(in: AppLanguage.current)
        }
    }
}

/// One person's follow link, to send with the share sheet or show as a QR code.
private struct InviteLinkSheet: View {
    let invite: Invite
    let link: URL
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ShareLink(item: link, message: Text(L("invite.message"))) {
                        Label(L("invite.share"), systemImage: "square.and.arrow.up")
                    }
                } footer: {
                    Text(L("invite.share.footer"))
                }
                Section {
                    if let qr = Self.qrCode(link.absoluteString) {
                        Image(uiImage: qr)
                            .interpolation(.none)
                            .resizable()
                            .scaledToFit()
                            .frame(maxWidth: 240)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                            .accessibilityLabel(L("invite.qr"))
                    }
                } header: {
                    Text(L("invite.qr"))
                } footer: {
                    Text(L("invite.qr.footer"))
                }
            }
            .navigationTitle(invite.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("invite.done")) { dismiss() }
                }
            }
        }
    }

    private static func qrCode(_ text: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage,
              let image = CIContext().createCGImage(output, from: output.extent)
        else { return nil }
        return UIImage(cgImage: image)
    }
}
