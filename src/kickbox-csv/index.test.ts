import { describe, expect, it } from 'vitest'
import { BULK_EXPORT_CSV } from '../providers/kickbox/kickbox.fixtures'
import {
  CsvImportError,
  headerKey,
  parseCsv,
  parseKickboxCsv,
} from './index'

describe('CSV reading', () => {
  it('parses quotes, doubled quotes and line breaks in quotes', () => {
    expect(parseCsv('a,"b ""c""",d\r\n"e\nf",g\n\n')).toEqual([
      ['a', 'b "c"', 'd'],
      ['e\nf', 'g'],
    ])
    expect(parseCsv('﻿email\nx@y.nl')).toEqual([['email'], ['x@y.nl']])
  })

  it('matches Kickbox headers whatever their spelling', () => {
    expect(headerKey('Accept All')).toBe('accept_all')
    expect(headerKey('kickbox_result')).toBe('result')
    expect(headerKey('Kickbox Did You Mean')).toBe('did_you_mean')
  })
})

describe('parseKickboxCsv', () => {
  it('reads each row with the API mapping', () => {
    const result = parseKickboxCsv(BULK_EXPORT_CSV)
    expect(result).toMatchObject({
      rows: 7,
      offset: 0,
      nextOffset: null,
      skipped: 1,
      unknownResults: 1,
      unknownValues: ['maybe'],
      byStatus: {
        valid: 1,
        invalid: 1,
        catch_all: 1,
        role: 1,
        disposable: 1,
      },
    })
    expect(result.entries.map((e) => [e.email, e.status])).toEqual([
      ['anna.jansen@gmail.com', 'valid'],
      ['bill.lumbergh@gamil.com', 'invalid'],
      ['piet@acme.nl', 'catch_all'],
      ['info@acme.nl', 'role'],
      ['x1@trashmail.example', 'disposable'],
    ])
    const raw = result.entries[1]?.raw
    expect(raw).toMatchObject({
      result: 'undeliverable',
      reason: 'rejected_email',
      didYouMeanDomain: 'gmail.com',
      sendex: 0.23,
    })
    expect(JSON.stringify(result.entries.map((e) => e.raw)))
      .not.toContain('bill.lumbergh')
  })

  it('pages through a long file', () => {
    const lines = ['email,result']
    for (let i = 0; i < 25; i++) {
      lines.push(`u${i}@acme.nl,deliverable`)
    }
    const csv = lines.join('\n')
    const first = parseKickboxCsv(csv, { limit: 10 })
    expect(first.entries).toHaveLength(10)
    expect(first.nextOffset).toBe(10)
    const last = parseKickboxCsv(csv, { offset: 20, limit: 10 })
    expect(last).toMatchObject({ offset: 20, nextOffset: null })
    expect(last.entries[0]?.email).toBe('u20@acme.nl')
  })

  it('never lists an unknown value that is not a word', () => {
    const result = parseKickboxCsv(
      'email,result\na@acme.nl,odd@acme.nl\nb@acme.nl,MAYBE'
    )
    expect(result.unknownResults).toBe(2)
    expect(result.unknownValues).toEqual(['maybe'])
  })

  it('refuses a file without an email or result column', () => {
    expect(() => parseKickboxCsv('name,result\nanna,deliverable'))
      .toThrow(CsvImportError)
    expect(() => parseKickboxCsv('email\nanna@acme.nl'))
      .toThrow('no result column')
    expect(() => parseKickboxCsv('')).toThrow('empty')
  })
})
