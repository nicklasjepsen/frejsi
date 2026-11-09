import CoreImage.CIFilterBuiltins
import FollowCore
import SwiftUI

/// "Invite someone" (Settings): makes the follow link for the site this phone follows, to send in
/// a message or show as a QR code. Tapping the link on an iPhone with Nænsom opens the app and sets
/// it up; without the app, the page says to install it and tap the link again.
///
/// The token starts as this phone's own, so one tap is enough, but the footer says to give each
/// person their own read-only token from Nightscout's admin tools, so one person can be removed
/// later without changing everyone's. The link carries only what the field holds; nothing is sent
/// anywhere until the user shares it.
struct InviteView: View {
    let site: URL
    @State private var token: String

    init(site: URL, token: String) {
        self.site = site
        _token = State(initialValue: token)
    }

    private var link: URL? {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return FollowLink(site: site, token: trimmed).url()
    }

    var body: some View {
        Form {
            Section {
                Text(site.host ?? site.absoluteString)
            } header: {
                Text(L("invite.site"))
            }

            Section {
                TextField(L("invite.token"), text: $token)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.body.monospaced())
            } header: {
                Text(L("invite.token"))
            } footer: {
                Text(L("invite.token.footer"))
            }

            if let link {
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
        }
        .navigationTitle(L("invite.title"))
        .navigationBarTitleDisplayMode(.inline)
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
