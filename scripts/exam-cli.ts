import 'dotenv/config'
import { refreshExams } from '../lib/exam-refresh/worker'

function parseArgs(argv: string[]) {
  const examIndex = argv.indexOf('--exam')
  return {
    examId: examIndex >= 0 ? argv[examIndex + 1] : undefined,
    all: argv.includes('--all'),
    write: argv.includes('--write'),
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const options = parseArgs(argv)
  if ((!options.examId && !options.all) || (options.examId && options.all)) {
    throw new Error('Choose exactly one scope: --exam <catalog-id> or --all.')
  }
  console.log(`refresh ${options.examId || 'all exams'} (${options.write ? 'write enabled' : 'dry run'})`)
  const result = await refreshExams(options)
  console.log(JSON.stringify(result, null, 2))
  if (result.errors.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
