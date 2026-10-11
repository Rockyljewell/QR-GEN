// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

// Execute official Dart web output. Only clock boundaries are supplied here;
// filter, tracker and session behavior must come from the compiled Dart source.
const [compiledPath, expectation] = process.argv.slice(2);
if (!compiledPath || (expectation !== undefined && expectation !== '--expect-baseline')) {
  throw new Error('Usage: node run_clock_probe.mjs <compiled-clock-probe.js> [--expect-baseline]');
}
const baseline = expectation === '--expect-baseline';
const output = [];
const context = vm.createContext({ console: { log: value => output.push(String(value)) } });
vm.runInContext(`
  (() => {
    let elapsed = 0;
    let wall = 1800000000000;
    Object.defineProperty(Date, 'now', { configurable: true, value: () => wall });
    globalThis.performance = { now: () => elapsed };
    globalThis.self = globalThis;
    globalThis.window = globalThis;
    globalThis.qrAuditSetClock = (nextElapsed, nextWall) => {
      elapsed = nextElapsed;
      wall = nextWall;
    };
  })();
`, context, { timeout: 5000 });
const compiled = fs.readFileSync(compiledPath);
vm.runInContext(compiled.toString('utf8'), context, { filename: compiledPath, timeout: 10000 });
const prefix = 'QRGEN_DART_CLOCK_RESULT:';
const messages = output.filter(line => line.startsWith(prefix));
if (messages.length !== 1) throw new Error(`Expected one Dart result, received ${messages.length}.`);
const result = JSON.parse(messages[0].slice(prefix.length));
const group = kind => result.results.filter(item => item.kind === kind);
const calibration = group('calibration');
const behavior = group('default-clock');
const controls = group('control');
const validCalibration = result.phase === 'completed' && calibration.length === 4 && calibration.every(item => item.passed);
const validControls = controls.length === 16 && controls.every(item => item.passed);
const expectedBehavior = behavior.length === 14 && behavior.every(item => !item.error && item.passed === !baseline);
const verified = validCalibration && validControls && expectedBehavior && result.results.length === 34;
console.log(JSON.stringify({
  scope: 'Officially compiled Dart web core in an isolated Node VM context; no native Flutter VM/widget/device claim.',
  expectation: baseline ? 'baseline wall-clock defect' : 'fixed elapsed-clock behavior',
  compiledSha256: crypto.createHash('sha256').update(compiled).digest('hex'),
  nodeVersion: process.version,
  verified,
  summary: {
    calibration: { total: calibration.length, passed: calibration.filter(item => item.passed).length },
    defaultClock: { total: behavior.length, passedElapsedOracle: behavior.filter(item => item.passed).length },
    controls: { total: controls.length, passed: controls.filter(item => item.passed).length },
  },
  result,
}, null, 2));
if (!verified) process.exitCode = 1;
