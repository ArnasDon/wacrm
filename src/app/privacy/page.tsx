export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-sm leading-relaxed">
      <h1 className="mb-4 text-2xl font-bold">Privacy Policy</h1>
      <p className="mb-4">Last updated: November 19, 2026</p>
      <p className="mb-4">
        This WhatsApp CRM application is operated by Dhiman Codes to manage
        customer communications, messages, and support inquiries via the Meta
        WhatsApp Cloud API.
      </p>
      <h2 className="mb-2 text-lg font-semibold">Information We Process</h2>
      <p className="mb-4">
        We process phone numbers, message content, message delivery statuses,
        and contact metadata needed to send and receive WhatsApp messages and
        provide customer support.
      </p>
      <h2 className="mb-2 text-lg font-semibold">Data Storage and Security</h2>
      <p className="mb-4">
        Application data is stored securely in your configured database and
        hosting environment. Credentials are encrypted before storage, and we do
        not sell personal contact data to third parties.
      </p>
      <h2 className="mb-2 text-lg font-semibold">Contact and Data Deletion</h2>
      <p>
        To request access to, correction of, or deletion of your contact or
        message data, contact us at rdhimancoder@gmail.com.
      </p>
    </main>
  );
}
