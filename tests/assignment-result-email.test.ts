import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAssignmentResultEmail } from '../lib/assignment-result-email-content'
import { resolveBrandConfig } from '../lib/branding'

test('assignment result emails contain private attempt summaries and escape user content', () => {
  const brand = resolveBrandConfig({
    name: 'Example Academy',
    shortName: 'EA',
    logoAlt: 'Example Academy logo',
    primaryColor: '#055527',
    email: { logoUrl: '/academy/email-logo.png' },
  })
  const email = buildAssignmentResultEmail({
    brand,
    appUrl: 'https://academy.example',
    recipientName: '<Student>',
    organisationName: 'Example & Academy',
    assignmentName: '<July Mock>',
    testTitle: 'Science & Maths',
    attempts: [
      { attemptNumber: 2, score: 18, totalMarks: 20, gradingStatus: 'graded', submittedAt: new Date('2026-08-06T10:00:00Z') },
      { attemptNumber: 1, score: 10, totalMarks: 20, gradingStatus: 'pending', submittedAt: new Date('2026-08-05T10:00:00Z') },
    ],
    actionUrl: 'https://academy.example/submissions',
    timeZone: 'Asia/Kolkata',
  })

  assert.equal(email.subject, 'Your result: <July Mock>')
  assert.match(email.text, /Attempt 1: 10\/20 marks \(50%\) - grading in progress/)
  assert.match(email.text, /Attempt 2: 18\/20 marks \(90%\)/)
  assert.match(email.text, /Current average: 70%/)
  assert.match(email.html, /https:\/\/academy\.example\/academy\/email-logo\.png/)
  assert.match(email.html, /#055527/)
  assert.doesNotMatch(email.html, /<Student>/)
  assert.doesNotMatch(email.html, /<July Mock>/)
  assert.match(email.html, /&lt;July Mock&gt;/)
  assert.match(email.html, /Grading in progress/)
})
