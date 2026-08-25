import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import { formatCurrency } from '@/lib/currency'
import type { Quote, QuoteItem } from '@/types'

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10, fontFamily: 'Helvetica' },
  header: { marginBottom: 20 },
  accountName: { fontSize: 16, fontWeight: 700, marginBottom: 2 },
  title: { fontSize: 12, color: '#555555', marginBottom: 12 },
  section: { marginBottom: 16 },
  sectionLabel: { fontSize: 9, color: '#777777', marginBottom: 4, textTransform: 'uppercase' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  table: { marginTop: 8, borderTop: '1pt solid #dddddd' },
  tableHeaderRow: {
    flexDirection: 'row',
    borderBottom: '1pt solid #dddddd',
    paddingVertical: 6,
    fontWeight: 700,
  },
  tableRow: { flexDirection: 'row', borderBottom: '0.5pt solid #eeeeee', paddingVertical: 6 },
  colDescription: { flex: 4 },
  colQty: { flex: 1, textAlign: 'right' },
  colUnitPrice: { flex: 2, textAlign: 'right' },
  colLineTotal: { flex: 2, textAlign: 'right' },
  totals: { marginTop: 12, alignItems: 'flex-end' },
  totalRow: { flexDirection: 'row', width: 200, justifyContent: 'space-between', marginBottom: 2 },
  grandTotalRow: {
    flexDirection: 'row',
    width: 200,
    justifyContent: 'space-between',
    marginTop: 4,
    paddingTop: 4,
    borderTop: '1pt solid #333333',
    fontWeight: 700,
    fontSize: 12,
  },
})

function QuoteDocument({
  quote,
  items,
  accountName,
}: {
  quote: Quote
  items: QuoteItem[]
  accountName: string
}) {
  const issuedDate = new Date(quote.created_at).toLocaleDateString()

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.accountName}>{accountName}</Text>
          <Text style={styles.title}>Cotización — {issuedDate}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Cliente</Text>
          {quote.customer_nit && (
            <View style={styles.row}>
              <Text>NIT: {quote.customer_nit}</Text>
            </View>
          )}
          {quote.customer_email && (
            <View style={styles.row}>
              <Text>Correo: {quote.customer_email}</Text>
            </View>
          )}
          <View style={styles.row}>
            <Text>Celular: {quote.customer_phone}</Text>
          </View>
          <View style={styles.row}>
            <Text>Dirección: {quote.customer_address}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={styles.colDescription}>Descripción</Text>
            <Text style={styles.colQty}>Cant.</Text>
            <Text style={styles.colUnitPrice}>Precio unit.</Text>
            <Text style={styles.colLineTotal}>Subtotal</Text>
          </View>
          {items.map((item) => (
            <View key={item.id} style={styles.tableRow}>
              <Text style={styles.colDescription}>{item.description}</Text>
              <Text style={styles.colQty}>{item.quantity}</Text>
              <Text style={styles.colUnitPrice}>{formatCurrency(item.unit_price, quote.currency)}</Text>
              <Text style={styles.colLineTotal}>{formatCurrency(item.line_total, quote.currency)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text>Subtotal</Text>
            <Text>{formatCurrency(quote.subtotal, quote.currency)}</Text>
          </View>
          <View style={styles.grandTotalRow}>
            <Text>Total</Text>
            <Text>{formatCurrency(quote.total, quote.currency)}</Text>
          </View>
        </View>
      </Page>
    </Document>
  )
}

/** Renders a quote as a PDF buffer, suitable for uploading to Storage
 *  and sending as a WhatsApp/Instagram/Facebook document attachment. */
export async function renderQuotePdf(
  quote: Quote,
  items: QuoteItem[],
  accountName: string,
): Promise<Buffer> {
  return renderToBuffer(<QuoteDocument quote={quote} items={items} accountName={accountName} />)
}
