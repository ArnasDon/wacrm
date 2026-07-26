// Minimal Razorpay Payment Links client.
// Docs: https://razorpay.com/docs/api/payments/payment-links/create-standard/

interface CreatePaymentLinkArgs {
  amountInRupees: number
  currency: string
  description: string
  referenceId: string
  customerName?: string
  customerContact?: string
}

interface RazorpayPaymentLink {
  id: string
  short_url: string
  status: string
}

export async function createPaymentLink(
  args: CreatePaymentLinkArgs,
): Promise<RazorpayPaymentLink> {
  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) {
    throw new Error('Razorpay keys not configured')
  }

  // Razorpay expects the amount in the smallest currency unit
  // (paise for INR), not rupees.
  const amountInSubunits = Math.round(args.amountInRupees * 100)

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64')

  const res = await fetch('https://api.razorpay.com/v1/payment_links', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      amount: amountInSubunits,
      currency: args.currency,
      description: args.description,
      reference_id: args.referenceId,
      customer: {
        name: args.customerName,
        contact: args.customerContact,
      },
      notify: {
        sms: false,
        email: false,
      },
      reminder_enable: false,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Razorpay error ${res.status}: ${body}`)
  }

  const data = await res.json()
  return {
    id: data.id,
    short_url: data.short_url,
    status: data.status,
  }
}