/**
 * `@magikmaker/email-validator/kickbox-csv`: read a Kickbox bulk
 * verification export (the CSV you download after verifying a list in
 * Kickbox's web app) into verifier results, so they can go into your
 * cache without paying for the API again.
 *
 * Kickbox's export keeps the uploaded columns and adds its own result
 * columns. Kickbox does not document their exact header spelling, so the
 * reader matches headers loosely: case, spaces, punctuation and a
 * `kickbox` prefix are ignored, so `Result`, `kickbox_result` and
 * `Kickbox Result` all name the result. It needs an address column
 * (`email`, `email_address`, `address`) and a result column; the flags
 * (`role`, `free`, `disposable`, `accept_all`), `reason`, `sendex` and
 * `did_you_mean` are read when present. The status follows the same
 * mapping as the API provider. Pure: no I/O, no logging.
 */

import {
  kickboxRawRecord,
  kickboxStatusOf,
} from '../providers/kickbox/index.js'
import type {
  KickboxRawRecord,
  KickboxResponse,
} from '../providers/kickbox/index.js'
import type { VerifierStatus } from '../core/verifier.js'

/** Kickbox's result values. */
export const KICKBOX_RESULTS: ReadonlySet<string> = new Set([
  'deliverable',
  'undeliverable',
  'risky',
  'unknown',
])

/** A CSV that cannot be read. */
export class CsvImportError extends Error {
  /**
   * @param message - What is wrong, for a person
   */
  constructor(message: string) {
    super(message)
    this.name = 'CsvImportError'
  }
}

/** One row read. */
export interface KickboxCsvEntry {
  /** The address, trimmed and lowercased. Hash it before you store it. */
  email: string
  /** The verifier status. */
  status: VerifierStatus
  /** Kickbox's answer without address fields. */
  raw: KickboxRawRecord
}

/** Options of {@link parseKickboxCsv}. */
export interface ParseKickboxCsvOptions {
  /** The first data row to read (0 based); 0 when unset. */
  offset?: number
  /** Data rows to read at most; all when unset. */
  limit?: number
}

/** What {@link parseKickboxCsv} read. */
export interface KickboxCsvResult {
  /** Data rows in the whole file. */
  rows: number
  /** The first row read (0 based, data rows). */
  offset: number
  /** Where the next call starts, or null when the file is done. */
  nextOffset: number | null
  /** The rows read, with their status. */
  entries: KickboxCsvEntry[]
  /** Rows without an address. */
  skipped: number
  /** Rows whose result value is not one of Kickbox's. */
  unknownResults: number
  /**
   * The unknown result values that look like an enum word, for a log.
   * A value that does not is left out, so no address ever lands here.
   */
  unknownValues: string[]
  /** Rows read per status. */
  byStatus: Partial<Record<VerifierStatus, number>>
}

/**
 * Split CSV text into rows of fields (RFC 4180: quoted fields, doubled
 * quotes, line breaks inside quotes, CRLF or LF, a byte order mark).
 * @param text - The file
 * @returns The rows; empty lines are dropped
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const input = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') {
        i++
      }
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

/**
 * A header reduced to its words: lowercased, `kickbox` prefix and
 * punctuation removed, words joined by `_`.
 * @param header - The header cell
 * @returns The key, e.g. `accept_all`
 */
export function headerKey(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^kickbox_?/, '')
}

/** The columns the reader looks for, by key. */
const COLUMN_KEYS = {
  email: ['email', 'email_address', 'e_mail', 'address', 'emailaddress'],
  result: ['result', 'verification_result'],
  reason: ['reason'],
  role: ['role'],
  free: ['free'],
  disposable: ['disposable'],
  acceptAll: ['accept_all', 'acceptall', 'catch_all'],
  didYouMean: ['did_you_mean', 'didyoumean'],
  sendex: ['sendex', 'sendex_score'],
} as const

/** Column positions, -1 when absent. */
type ColumnMap = Record<keyof typeof COLUMN_KEYS, number>

/**
 * Find the columns of a header row.
 * @param header - The header cells
 * @returns The positions
 */
function mapColumns(header: readonly string[]): ColumnMap {
  const keys = header.map(headerKey)
  const find = (names: readonly string[]): number => {
    for (const name of names) {
      const at = keys.indexOf(name)
      if (at >= 0) {
        return at
      }
    }
    return -1
  }
  return {
    email: find(COLUMN_KEYS.email),
    result: find(COLUMN_KEYS.result),
    reason: find(COLUMN_KEYS.reason),
    role: find(COLUMN_KEYS.role),
    free: find(COLUMN_KEYS.free),
    disposable: find(COLUMN_KEYS.disposable),
    acceptAll: find(COLUMN_KEYS.acceptAll),
    didYouMean: find(COLUMN_KEYS.didYouMean),
    sendex: find(COLUMN_KEYS.sendex),
  }
}

/**
 * A cell read as a flag: `true`, `1`, `yes`, `y`, `t` are true.
 * @param value - The cell
 * @returns The flag
 */
function flagOf(value: string | undefined): boolean {
  return ['true', '1', 'yes', 'y', 't'].includes(
    (value ?? '').trim().toLowerCase()
  )
}

/**
 * One data row read into the shape of Kickbox's API answer.
 * @param cells - The row
 * @param columns - The column positions
 * @returns The answer, or null when the row has no address
 */
function answerOfRow(
  cells: readonly string[],
  columns: ColumnMap
): { email: string; answer: KickboxResponse } | null {
  const cell = (at: number): string | undefined =>
    at >= 0 ? cells[at]?.trim() : undefined
  const email = (cell(columns.email) ?? '').toLowerCase()
  if (!email.includes('@')) {
    return null
  }
  const sendex = Number.parseFloat(cell(columns.sendex) ?? '')
  const reason = cell(columns.reason)
  const answer: KickboxResponse = {
    result: (cell(columns.result) ?? '').toLowerCase(),
    role: flagOf(cell(columns.role)),
    free: flagOf(cell(columns.free)),
    disposable: flagOf(cell(columns.disposable)),
    accept_all: flagOf(cell(columns.acceptAll)),
    did_you_mean: cell(columns.didYouMean) || null,
    email,
  }
  if (reason) {
    answer.reason = reason
  }
  if (Number.isFinite(sendex)) {
    answer.sendex = sendex
  }
  return { email, answer }
}

/**
 * Read a Kickbox export, or a page of it (`offset`, `limit`), into
 * verifier results. Store each with `emailHash(entry.email)` as the key
 * and `source: 'csv'`.
 * @param csv - The whole file
 * @param options - See {@link ParseKickboxCsvOptions}
 * @returns The entries and the counts
 * @throws {CsvImportError} When the file is empty or has no address or
 *   result column
 */
export function parseKickboxCsv(
  csv: string,
  options: ParseKickboxCsvOptions = {}
): KickboxCsvResult {
  const rows = parseCsv(csv)
  const header = rows[0]
  if (!header) {
    throw new CsvImportError('The file is empty')
  }
  const columns = mapColumns(header)
  if (columns.email < 0) {
    throw new CsvImportError('The file has no email column')
  }
  if (columns.result < 0) {
    throw new CsvImportError(
      'The file has no result column; download the full results from ' +
        'Kickbox, not only the addresses'
    )
  }
  const data = rows.slice(1)
  const start = Math.max(0, Math.min(options.offset ?? 0, data.length))
  const limit = Math.max(0, options.limit ?? data.length)
  const end = Math.min(data.length, start + limit)
  const result: KickboxCsvResult = {
    rows: data.length,
    offset: start,
    nextOffset: end < data.length ? end : null,
    entries: [],
    skipped: 0,
    unknownResults: 0,
    unknownValues: [],
    byStatus: {},
  }
  for (const cells of data.slice(start, end)) {
    const read = answerOfRow(cells, columns)
    if (!read) {
      result.skipped += 1
      continue
    }
    const value = read.answer.result ?? ''
    if (!KICKBOX_RESULTS.has(value)) {
      result.unknownResults += 1
      if (/^[a-z_]{1,30}$/.test(value) && !result.unknownValues.includes(
        value
      )) {
        result.unknownValues.push(value)
      }
      continue
    }
    const status = kickboxStatusOf(read.answer)
    result.entries.push({
      email: read.email,
      status,
      raw: kickboxRawRecord(read.answer),
    })
    result.byStatus[status] = (result.byStatus[status] ?? 0) + 1
  }
  return result
}
