import 'server-only'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import type { AccountDoc, OrderDoc } from '@/lib/db/types'
import { formatMoneyPlain } from '@/lib/money'

// ============================================================
// Branded invoice / receipt PDFs (pdf-lib — pure JS, no headless
// browser). Logos are PNG or JPEG only (SVG is refused at upload:
// it can carry script and pdf-lib can't embed it anyway).
// ============================================================

export type OrderDocumentKind = 'invoice' | 'receipt'

const A4: [number, number] = [595.28, 841.89]
const MARGIN = 48
const INK = rgb(0.11, 0.13, 0.16)
const MUTED = rgb(0.42, 0.45, 0.5)
const LINE = rgb(0.88, 0.89, 0.91)
const ACCENT = rgb(0.06, 0.55, 0.37)

/** Standard PDF fonts are WinAnsi — drop anything they can't draw. */
function safe(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/₦/g, 'NGN ')
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '')
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = []
  for (const para of safe(text).split('\n')) {
    let line = ''
    for (const word of para.split(' ')) {
      const candidate = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        out.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    out.push(line)
  }
  return out
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export async function renderOrderPdf(input: {
  kind: OrderDocumentKind
  account: AccountDoc
  order: OrderDoc
  logo: { bytes: Uint8Array; mime: string } | null
}): Promise<Uint8Array> {
  const { kind, account, order } = input
  const biz = account.business
  const money = (minor: number) => formatMoneyPlain(minor, order.currency)

  const pdf = await PDFDocument.create()
  pdf.setTitle(`${kind === 'invoice' ? 'Invoice' : 'Receipt'} ${order.number}`)
  pdf.setAuthor(safe(biz.displayName))
  pdf.setProducer('WhatsApp Sales CRM')
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  let logo: PDFImage | null = null
  if (input.logo) {
    try {
      logo = input.logo.mime === 'image/png' ? await pdf.embedPng(input.logo.bytes) : await pdf.embedJpg(input.logo.bytes)
    } catch {
      logo = null // corrupt image — render without it rather than fail the receipt
    }
  }

  let page: PDFPage = pdf.addPage(A4)
  const [W, H] = A4
  let y = H - MARGIN

  const text = (s: string, x: number, yy: number, size = 10, f: PDFFont = font, color = INK) =>
    page.drawText(safe(s), { x, y: yy, size, font: f, color })
  const right = (s: string, xRight: number, yy: number, size = 10, f: PDFFont = font, color = INK) =>
    text(s, xRight - f.widthOfTextAtSize(safe(s), size), yy, size, f, color)

  // ---- header: logo + business block ----
  let headerBottom = y
  if (logo) {
    const scale = Math.min(140 / logo.width, 64 / logo.height, 1)
    const w = logo.width * scale
    const h = logo.height * scale
    page.drawImage(logo, { x: MARGIN, y: y - h, width: w, height: h })
    headerBottom = Math.min(headerBottom, y - h)
  } else {
    text(biz.displayName, MARGIN, y - 18, 18, bold)
    headerBottom = y - 24
  }
  let by = y - 10
  right(biz.displayName, W - MARGIN, by, 12, bold)
  for (const line of [biz.legalName && biz.legalName !== biz.displayName ? biz.legalName : null, biz.address, biz.phone, biz.email, biz.website, biz.taxId ? `Tax ID: ${biz.taxId}` : null]) {
    if (!line) continue
    for (const l of wrap(line, font, 9, 220)) {
      by -= 12
      right(l, W - MARGIN, by, 9, font, MUTED)
    }
  }
  y = Math.min(headerBottom, by) - 28

  // ---- title row ----
  text(kind === 'invoice' ? 'INVOICE' : 'RECEIPT', MARGIN, y, 24, bold, kind === 'receipt' ? ACCENT : INK)
  const docNumber = kind === 'invoice' ? (order.invoiceNumber ?? order.number) : (order.receiptNumber ?? order.number)
  right(`No. ${docNumber}`, W - MARGIN, y + 8, 10, bold)
  right(`Order ${order.number}`, W - MARGIN, y - 6, 9, font, MUTED)
  right(
    kind === 'receipt' ? `Paid ${fmtDate(order.payment.paidAt)}` : `Issued ${fmtDate(order.createdAt)}`,
    W - MARGIN,
    y - 19,
    9,
    font,
    MUTED,
  )
  y -= 44

  // ---- bill to ----
  text(kind === 'invoice' ? 'BILL TO' : 'RECEIVED FROM', MARGIN, y, 8, bold, MUTED)
  y -= 14
  const customerLines = [order.customer.name || 'Customer', order.customer.phone ? `+${order.customer.phone}` : null, order.customer.email].filter(Boolean) as string[]
  for (const l of customerLines) {
    text(l, MARGIN, y, 10, l === customerLines[0] ? bold : font)
    y -= 13
  }
  y -= 14

  // ---- items table ----
  const colQty = W - MARGIN - 220
  const colUnit = W - MARGIN - 110
  const colAmt = W - MARGIN
  const drawTableHeader = () => {
    page.drawRectangle({ x: MARGIN, y: y - 6, width: W - 2 * MARGIN, height: 22, color: rgb(0.96, 0.97, 0.97) })
    text('ITEM', MARGIN + 8, y + 1, 8, bold, MUTED)
    right('QTY', colQty, y + 1, 8, bold, MUTED)
    right('UNIT PRICE', colUnit, y + 1, 8, bold, MUTED)
    right('AMOUNT', colAmt - 8, y + 1, 8, bold, MUTED)
    y -= 26
  }
  drawTableHeader()
  for (const item of order.items) {
    const nameLines = wrap(item.name + (item.sku ? `  (${item.sku})` : ''), font, 10, colQty - MARGIN - 60)
    const rowH = Math.max(nameLines.length * 13, 13) + 8
    if (y - rowH < 180) {
      page = pdf.addPage(A4)
      y = H - MARGIN
      drawTableHeader()
    }
    nameLines.forEach((l, i) => text(l, MARGIN + 8, y - i * 13, 10))
    right(String(item.quantity), colQty, y, 10)
    right(money(item.unitPrice), colUnit, y, 10)
    right(money(item.lineTotal), colAmt - 8, y, 10)
    y -= rowH
    page.drawLine({ start: { x: MARGIN, y: y + 6 }, end: { x: W - MARGIN, y: y + 6 }, thickness: 0.5, color: LINE })
  }
  y -= 8

  // ---- totals ----
  const totals: Array<[string, number, boolean]> = [['Subtotal', order.subtotal, false]]
  if (order.deliveryFee) totals.push(['Delivery', order.deliveryFee, false])
  if (order.discount) totals.push(['Discount', -order.discount, false])
  if (order.tax) totals.push([`VAT (${(biz.taxRateBps / 100).toFixed(1)}%)`, order.tax, false])
  totals.push([kind === 'receipt' ? 'Total paid' : 'Total due', kind === 'receipt' ? (order.payment.amountPaid ?? order.total) : order.total, true])
  for (const [label, amount, strong] of totals) {
    if (strong) {
      page.drawLine({ start: { x: colUnit - 80, y: y + 12 }, end: { x: W - MARGIN, y: y + 12 }, thickness: 1, color: INK })
      y -= 4
    }
    right(label, colUnit, y, strong ? 11 : 10, strong ? bold : font, strong ? INK : MUTED)
    right(money(amount), colAmt - 8, y, strong ? 12 : 10, strong ? bold : font)
    y -= strong ? 20 : 15
  }
  y -= 10

  // ---- payment block ----
  text(kind === 'invoice' ? 'HOW TO PAY' : 'PAYMENT DETAILS', MARGIN, y, 8, bold, MUTED)
  y -= 14
  const payLines: string[] = []
  if (kind === 'invoice') {
    if (order.payment.link) payLines.push(`Pay online (card, transfer, USSD): ${order.payment.link}`)
    if (biz.bank.accountNumber) {
      payLines.push(`Bank transfer: ${biz.bank.bankName ?? ''} ${biz.bank.accountNumber} (${biz.bank.accountName ?? biz.displayName})`)
      payLines.push(`Use ${order.number} as the transfer narration.`)
    }
    if (payLines.length === 0) payLines.push('Reply on WhatsApp to arrange payment.')
  } else {
    const via = order.payment.provider === 'paystack' ? 'Paystack' : order.payment.provider === 'flutterwave' ? 'Flutterwave' : order.payment.provider === 'bank_transfer' ? 'Bank transfer' : 'Manual confirmation'
    payLines.push(`Method: ${via}${order.payment.channel ? ` (${order.payment.channel})` : ''}`)
    if (order.payment.reference) payLines.push(`Reference: ${order.payment.reference}`)
    payLines.push(`Date: ${fmtDate(order.payment.paidAt)}`)
  }
  for (const l of payLines) {
    for (const w of wrap(l, font, 9, W - 2 * MARGIN)) {
      text(w, MARGIN, y, 9)
      y -= 12
    }
  }

  // ---- PAID stamp ----
  if (kind === 'receipt') {
    page.drawRectangle({ x: W - MARGIN - 110, y: y + 4, width: 110, height: 34, borderColor: ACCENT, borderWidth: 2, opacity: 0, borderOpacity: 0.9 })
    right('PAID', W - MARGIN - 28, y + 15, 18, bold, ACCENT)
  }

  // ---- footer ----
  const footer = kind === 'invoice' ? biz.invoiceNotes : biz.receiptFooter
  let fy = MARGIN + 20
  if (footer) {
    for (const l of wrap(footer, font, 9, W - 2 * MARGIN).slice(0, 4).reverse()) {
      page.drawText(l, { x: MARGIN, y: fy, size: 9, font, color: MUTED })
      fy += 12
    }
  }
  page.drawLine({ start: { x: MARGIN, y: MARGIN + 8 }, end: { x: W - MARGIN, y: MARGIN + 8 }, thickness: 0.5, color: LINE })

  return pdf.save()
}
