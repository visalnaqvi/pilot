import 'dotenv/config'

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { adminStorageCore } from '../lib/firebase-admin-core'

type CorsRule = {
  origin: string[]
  method: string[]
  responseHeader: string[]
  maxAgeSeconds: number
}

async function main() {
  const configPath = resolve(process.cwd(), 'storage.cors.json')
  const rules = JSON.parse(await readFile(configPath, 'utf8')) as CorsRule[]
  const bucket = adminStorageCore.bucket()

  await bucket.setCorsConfiguration(rules)

  console.log(`Applied browser upload CORS configuration to gs://${bucket.name}.`)
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
