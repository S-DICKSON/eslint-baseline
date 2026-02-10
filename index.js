#!/usr/bin/env node

import eslint from './src/eslint.js';
import * as fs from 'fs';
import {createFromEslintResult, getFilteredMessages, getBaselinedMessages} from './src/baseline.js';

const FILE_NAME = '.eslint-baseline.json';
const TEMP_MARKER = '-- __BASELINE_TEMP__';

async function exec() {
    if (!fs.existsSync(FILE_NAME)) {
        console.log('baseline not found attempting to create...');

        const result = await eslint.execute();
        const baseline = createFromEslintResult(result);

        fs.appendFileSync(FILE_NAME, JSON.stringify(baseline, null, 4));

        console.log('baseline created successfully');

        process.exit(1);
        return;
    }

    const baselineContent = fs.readFileSync(FILE_NAME);
    const baseline = JSON.parse(baselineContent);

    const hasFix = process.argv.includes('--fix');

    // run eslint (always without --fix first for accurate baseline comparison)
    const result = await eslint.execute();

    if (result === null) {
        console.error('eslint failed to run, baseline aborting...');
        process.exit(1);
    }

    // compose eslint result with baseline
    let fails = getFilteredMessages(result, baseline);

    // if --fix requested, protect baselined violations then run fix
    if (hasFix && fails.length > 0) {
        const baselinedViolations = getBaselinedMessages(result, baseline);

        // group baselined violations by file
        const byFile = {};
        for (const v of baselinedViolations) {
            if (!byFile[v.fullPath]) byFile[v.fullPath] = [];
            byFile[v.fullPath].push(v);
        }

        try {
            // add temporary eslint-disable-next-line comments for baselined violations
            for (const [fullPath, violations] of Object.entries(byFile)) {
                const content = fs.readFileSync(fullPath, 'utf8');
                const lines = content.split('\n');

                // deduplicate: multiple violations on same line get one combined comment
                const lineMap = new Map();
                for (const v of violations) {
                    if (!lineMap.has(v.line)) lineMap.set(v.line, new Set());
                    lineMap.get(v.line).add(v.ruleId);
                }

                // insert in reverse order so line numbers don't shift
                const sortedLines = [...lineMap.entries()].sort((a, b) => b[0] - a[0]);
                for (const [line, rules] of sortedLines) {
                    const indent = lines[line - 1]?.match(/^\s*/)?.[0] || '';
                    const rulesStr = [...rules].join(', ');
                    lines.splice(line - 1, 0, `${indent}// eslint-disable-next-line ${rulesStr} ${TEMP_MARKER}`);
                }

                fs.writeFileSync(fullPath, lines.join('\n'));
            }

            // run eslint --fix (baselined violations are now protected by disable comments)
            await eslint.fix();
        } finally {
            // always clean up: remove temporary disable comments
            for (const fullPath of Object.keys(byFile)) {
                const content = fs.readFileSync(fullPath, 'utf8');
                const cleaned = content.split('\n')
                    .filter(line => !line.includes(TEMP_MARKER))
                    .join('\n');
                fs.writeFileSync(fullPath, cleaned);
            }
        }

        // re-run eslint to check what's left after fixing
        const postFixResult = await eslint.execute();
        if (postFixResult !== null) {
            fails = getFilteredMessages(postFixResult, baseline);
        }
    }

    console.info('eslint baseline compare results:')
    console.info();

    // check results
    if (fails.length > 0) {
        for (let fail of fails) {
            console.error(` - ${fail.path}, line ${fail.line}:${fail.column}, rule ${fail.ruleId}, ${fail.message}`);
        }
        console.error();
        console.error(` [fail] ${fails.length} issues found !!!`)
        process.exit(1);
    } else {
        console.info(' [OK] no issues found ');
    }
}


exec().catch(x => console.error(x));