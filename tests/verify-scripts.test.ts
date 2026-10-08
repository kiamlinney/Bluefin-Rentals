// The standing scripts in scripts/verify-*.ts (refund maths, booking statuses,
// extension pricing, tax, pickup pricing, and the policy documents matching the
// code), run as part of `npm test` so nothing has to be remembered separately.
// Each is a plain script that exits non-zero on failure.

import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const scripts = readdirSync(`${root}scripts`).filter(f => /^verify-.*\.ts$/.test(f)).sort()

describe('verify scripts', () => {
    it('finds them', () => expect(scripts.length).toBeGreaterThanOrEqual(5))

    for (const script of scripts) {
        it(script, () => {
            try {
                execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', `scripts/${script}`], {
                    cwd: root,
                    stdio: 'pipe',
                    encoding: 'utf8',
                })
            } catch (err: any) {
                const out = `${err.stdout ?? ''}${err.stderr ?? ''}`
                const failures = out.split('\n').filter((l: string) => /FAIL|Error/.test(l)).join('\n')
                throw new Error(`${script} failed:\n${failures || out.slice(-2000)}`)
            }
        })
    }
})
