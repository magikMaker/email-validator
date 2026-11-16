/**
 * Recorded Kickbox answers for the verifier tests, in the shape of the
 * single verification API (https://docs.kickbox.com/docs/single-
 * verification-api). The addresses are made up. Not a test file itself.
 */

import type { KickboxResponse } from './index'

/** A deliverable mailbox. */
export const DELIVERABLE: KickboxResponse = {
  result: 'deliverable',
  reason: 'accepted_email',
  role: false,
  free: true,
  disposable: false,
  accept_all: false,
  did_you_mean: null,
  sendex: 0.9,
  email: 'anna.jansen@gmail.com',
  user: 'anna.jansen',
  domain: 'gmail.com',
  success: true,
  message: null,
}

/** Kickbox's own example: a rejected mailbox on a typo domain. */
export const UNDELIVERABLE: KickboxResponse = {
  result: 'undeliverable',
  reason: 'rejected_email',
  role: false,
  free: false,
  disposable: false,
  accept_all: false,
  did_you_mean: 'bill.lumbergh@gmail.com',
  sendex: 0.23,
  email: 'bill.lumbergh@gamil.com',
  user: 'bill.lumbergh',
  domain: 'gamil.com',
  success: true,
  message: null,
}

/** A domain that accepts every address. */
export const ACCEPT_ALL: KickboxResponse = {
  result: 'risky',
  reason: 'low_deliverability',
  role: false,
  free: false,
  disposable: false,
  accept_all: true,
  did_you_mean: null,
  sendex: 0.55,
  email: 'piet@acme.nl',
  user: 'piet',
  domain: 'acme.nl',
  success: true,
  message: null,
}

/** A disposable domain. */
export const DISPOSABLE: KickboxResponse = {
  result: 'risky',
  reason: 'low_quality',
  role: false,
  free: true,
  disposable: true,
  accept_all: false,
  did_you_mean: null,
  sendex: 0.1,
  email: 'x1@trashmail.example',
  user: 'x1',
  domain: 'trashmail.example',
  success: true,
  message: null,
}

/** A role address that accepts mail. */
export const ROLE: KickboxResponse = {
  result: 'deliverable',
  reason: 'accepted_email',
  role: true,
  free: false,
  disposable: false,
  accept_all: false,
  did_you_mean: null,
  sendex: 0.6,
  email: 'info@acme.nl',
  user: 'info',
  domain: 'acme.nl',
  success: true,
  message: null,
}

/** The SMTP server could not be reached. */
export const UNKNOWN: KickboxResponse = {
  result: 'unknown',
  reason: 'no_connect',
  role: false,
  free: false,
  disposable: false,
  accept_all: false,
  did_you_mean: null,
  sendex: 0.4,
  email: 'jan@slow.example',
  user: 'jan',
  domain: 'slow.example',
  success: true,
  message: null,
}

/** A refused request (bad key). */
export const BAD_KEY: KickboxResponse = {
  success: false,
  message: 'Invalid API Key',
}

/**
 * A Kickbox bulk export as an admin downloads it: the uploaded column
 * plus Kickbox's result columns.
 */
export const BULK_EXPORT_CSV = [
  'Email,Result,Reason,Role,Free,Disposable,Accept All,Did You Mean,Sendex',
  'anna.jansen@gmail.com,deliverable,accepted_email,false,true,false,' +
    'false,,0.9',
  '"bill.lumbergh@gamil.com",undeliverable,rejected_email,false,false,' +
    'false,false,bill.lumbergh@gmail.com,0.23',
  'piet@acme.nl,risky,low_deliverability,false,false,false,true,,0.55',
  'info@acme.nl,deliverable,accepted_email,true,false,false,false,,0.6',
  'x1@trashmail.example,risky,low_quality,false,true,true,false,,0.1',
  'odd@acme.nl,maybe,,false,false,false,false,,',
  ',deliverable,,,,,,,',
].join('\r\n')
