import { inflateRawSync } from 'node:zlib'

/**
 * Minimal ZIP reader for Office Open XML files (.docx/.xlsx/.pptx are
 * all a ZIP of XML parts). No new dependency — this project hand-rolls
 * its parsers (see the CSV reader in `google-sheet.ts`), and a ZIP
 * central directory is a few fixed-width fields; Node's `zlib` already
 * does the one hard part (inflating the DEFLATE-compressed entries).
 *
 * Supports compression method 0 (stored) and 8 (deflate) — the only
 * two Office ever writes. Throws a readable error on anything else
 * (corrupt file, unsupported method, not a ZIP at all); callers catch
 * and turn that into the tool's error-string result.
 */
export function readZipEntries(buf: Buffer): Map<string, Buffer> {
  const eocdOffset = findEndOfCentralDirectory(buf)
  if (eocdOffset === -1) throw new Error('no es un archivo ZIP válido (falta el End Of Central Directory)')

  const entryCount = buf.readUInt16LE(eocdOffset + 10)
  let cdOffset = buf.readUInt32LE(eocdOffset + 16)

  const entries = new Map<string, Buffer>()
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(cdOffset) !== 0x02014b50) {
      throw new Error('encabezado de directorio central inválido')
    }
    const method = buf.readUInt16LE(cdOffset + 10)
    const compressedSize = buf.readUInt32LE(cdOffset + 20)
    const nameLength = buf.readUInt16LE(cdOffset + 28)
    const extraLength = buf.readUInt16LE(cdOffset + 30)
    const commentLength = buf.readUInt16LE(cdOffset + 32)
    const localHeaderOffset = buf.readUInt32LE(cdOffset + 42)
    const name = buf.toString('utf8', cdOffset + 46, cdOffset + 46 + nameLength)

    if (!name.endsWith('/')) {
      entries.set(name, readEntry(buf, localHeaderOffset, method, compressedSize))
    }

    cdOffset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function readEntry(buf: Buffer, localHeaderOffset: number, method: number, compressedSize: number): Buffer {
  if (buf.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
    throw new Error('encabezado local inválido')
  }
  const nameLength = buf.readUInt16LE(localHeaderOffset + 26)
  const extraLength = buf.readUInt16LE(localHeaderOffset + 28)
  const dataStart = localHeaderOffset + 30 + nameLength + extraLength
  const data = buf.subarray(dataStart, dataStart + compressedSize)

  if (method === 0) return Buffer.from(data)
  if (method === 8) return inflateRawSync(data)
  throw new Error(`método de compresión ZIP no soportado (${method})`)
}

/** Scan backwards for the EOCD signature — the comment field (0-65535
 *  bytes) after it means it isn't necessarily the last 22 bytes. */
function findEndOfCentralDirectory(buf: Buffer): number {
  const minOffset = Math.max(0, buf.length - 22 - 0xffff)
  for (let i = buf.length - 22; i >= minOffset; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i
  }
  return -1
}

/** Decode the handful of XML entities that show up in Office XML text. */
export function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
}

/** All `<tag ...>inner</tag>` matches (dotall), inner text XML-decoded. */
export function extractTagText(xml: string, tagName: string): string[] {
  const re = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)</${tagName}>`, 'g')
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    out.push(decodeXmlEntities(m[1]))
  }
  return out
}
