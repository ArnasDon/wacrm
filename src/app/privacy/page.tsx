export default function PrivacyPolicyPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-16 prose prose-sm">
      <h1 className="text-2xl font-bold mb-2">Privacy Policy</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Last updated: {new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })}
      </p>

      <p>
        This application (&quot;the App&quot;) is a customer relationship
        and messaging tool that connects to WhatsApp Business Platform to
        help businesses communicate with their customers.
      </p>

      <h2 className="text-lg font-semibold mt-8 mb-2">Information We Collect</h2>
      <p>
        When you interact with a business using this App via WhatsApp, we
        may collect and store:
      </p>
      <ul className="list-disc pl-6">
        <li>Your name and phone number, as provided to WhatsApp</li>
        <li>The content of messages exchanged with the business</li>
        <li>Message delivery and read status</li>
        <li>Any additional information you voluntarily provide during the conversation (such as order details)</li>
      </ul>

      <h2 className="text-lg font-semibold mt-8 mb-2">How We Use Information</h2>
      <p>
        Information collected is used solely to facilitate communication
        between the business and its customers, including responding to
        inquiries, processing orders, and delivering purchased products or
        services. We do not sell or share customer data with third parties
        for advertising purposes.
      </p>

      <h2 className="text-lg font-semibold mt-8 mb-2">Data Storage</h2>
      <p>
        Data is stored securely using industry-standard encryption and
        access controls. Access is restricted to authorized users of the
        business account.
      </p>

      <h2 className="text-lg font-semibold mt-8 mb-2">Third-Party Services</h2>
      <p>
        This App integrates with WhatsApp Business Platform (operated by
        Meta) to send and receive messages, and with Razorpay to process
        payments. Each of these providers has its own privacy policy
        governing how they handle data.
      </p>

      <h2 className="text-lg font-semibold mt-8 mb-2">Your Rights</h2>
      <p>
        You may request access to, correction of, or deletion of your
        personal information at any time by contacting the business you are
        communicating with through this App.
      </p>

      <h2 className="text-lg font-semibold mt-8 mb-2">Contact</h2>
      <p>
        For questions about this privacy policy, please contact the
        business you are messaging directly.
      </p>
    </div>
  );
}