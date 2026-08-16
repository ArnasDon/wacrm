import { Document, Page, Text, View, StyleSheet, Image, renderToBuffer } from '@react-pdf/renderer'
import { formatCurrency } from '@/lib/currency'
import type { Product } from '@/types'

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10, fontFamily: 'Helvetica' },
  header: { marginBottom: 20 },
  accountName: { fontSize: 16, fontWeight: 700, marginBottom: 2 },
  title: { fontSize: 12, color: '#555555' },
  item: {
    flexDirection: 'row',
    borderBottom: '0.5pt solid #eeeeee',
    paddingVertical: 10,
    alignItems: 'center',
  },
  image: { width: 48, height: 48, marginRight: 12, objectFit: 'cover' },
  itemBody: { flex: 1 },
  itemName: { fontSize: 11, fontWeight: 700, marginBottom: 2 },
  itemDescription: { fontSize: 9, color: '#666666', marginBottom: 2 },
  itemPrice: { fontSize: 11, fontWeight: 700 },
})

function CatalogDocument({ products, accountName, currency }: { products: Product[]; accountName: string; currency: string }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.accountName}>{accountName}</Text>
          <Text style={styles.title}>Catálogo de productos</Text>
        </View>

        {products.map((product) => (
          <View key={product.id} style={styles.item} wrap={false}>
            {product.image_url && <Image style={styles.image} src={product.image_url} />}
            <View style={styles.itemBody}>
              <Text style={styles.itemName}>{product.name}</Text>
              {product.description && <Text style={styles.itemDescription}>{product.description}</Text>}
            </View>
            <Text style={styles.itemPrice}>{formatCurrency(product.price, currency)}</Text>
          </View>
        ))}
      </Page>
    </Document>
  )
}

/** Renders the account's active product catalog as a PDF buffer. */
export async function renderCatalogPdf(
  products: Product[],
  accountName: string,
  currency: string,
): Promise<Buffer> {
  return renderToBuffer(<CatalogDocument products={products} accountName={accountName} currency={currency} />)
}
