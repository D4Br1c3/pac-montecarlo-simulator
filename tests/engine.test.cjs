'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by more than ${tolerance}`);
const deterministic = overrides => ({ ...E.DEFAULTS, initial: 1000, recurring: 100, years: 2,
  expectedReturn: 0, volatility: 0, riskFree: 0, ter: 0, fee: 0, jumps: false,
  simulations: 12, ...overrides });

test('PV uses annual effective RF, with zero and negative rates and both payment dates', () => {
  for (const timing of ['start', 'end']) {
    const p = deterministic({ timing, riskFree: 0.025 });
    const flows = E.cashflows(p);
    const rp = (1 + p.riskFree) ** (1 / p.frequency) - 1;
    let expected = p.initial + p.recurring * (1 - (1 + rp) ** (-p.frequency * p.years)) / rp * (timing === 'start' ? 1 + rp : 1);
    close(E.presentValue(flows, p.riskFree), expected, 1e-8);
    close(E.presentValue(flows, 0), 3400);
    assert.ok(E.presentValue(flows, -0.01) > 3400);
    close(E.presentValue(flows, p.riskFree) * (1 + p.riskFree) ** p.years, E.futureValue(flows, p.riskFree, p.years), 1e-8);
  }
  close(E.presentValue(E.cashflows(E.DEFAULTS), E.DEFAULTS.riskFree), 50081.41462883779, 1e-8);
});

test('simulation cash-flow dates match PV and FV for all supported frequencies', () => {
  for (const timing of ['start', 'end']) for (const frequency of [4, 12, 24]) {
    const p = deterministic({ timing, frequency, expectedReturn: 0.08, riskFree: 0.03 });
    const r = E.simulate(p);
    close(r.wealth.pac[0], E.futureValue(E.cashflows(p), p.expectedReturn, p.years), 1e-8);
    close(r.wealth.pic[0], r.pv * (1 + p.expectedReturn) ** p.years, 1e-8);
    close(r.fan.at(-1).pac.gross[50], r.wealth.pac[0]);
    const initialFlows = E.cashflows(p).filter(f => f.time === 0);
    close(r.fan[0].pac.gross[50], initialFlows.reduce((s, f) => s + f.amount, 0));
  }
});

test('IRR recovers positive, zero, very negative and high annual returns for both timings', () => {
  for (const timing of ['start', 'end']) for (const frequency of [4, 12, 24]) for (const expected of [-0.85, -0.4, 0, 0.05, 0.7, 3]) {
    const p = deterministic({ timing, frequency });
    const flows = E.cashflows(p);
    close(E.irr(E.futureValue(flows, expected, p.years), flows, p.years), expected, 1e-10);
  }
});

test('IRR reports nonexistence for a final inflow below the simultaneous final contribution', () => {
  assert.equal(E.irr(90, [{ time: 0, amount: 100 }, { time: 1, amount: 100 }], 1), null);
  assert.equal(E.irr(100, [{ time: 1, amount: 100 }], 1), null);
  assert.equal(E.irr(0, [{ time: 0, amount: 100 }], 1), null);
});

test('zero rates, TER, frequency, jump parameters and seed remain zero; no accidental defaults', () => {
  const p = deterministic({ jumpFrequency: 0, jumpMean: 0, jumpLogStd: 0, inflation: 0, seed: 0 });
  const r = E.simulate(p);
  close(r.wealth.pac[0], 3400); close(r.wealth.pic[0], 3400);
  assert.deepEqual(r.wins.net, { pac: 0, pic: 0, tie: 1 });
  assert.equal(r.moments.sharpe, null);
  assert.equal(r.params.seed, 0);
  assert.deepEqual(Array.from(r.drawdown.asset), Array(12).fill(0));
});

test('commission is charged only on funded orders, and is part of the investor cash outflow', () => {
  const p = deterministic({ initial: 0, recurring: 100, years: 1, fee: 2 });
  const r = E.simulate(p);
  assert.deepEqual(r.fees, { pac: 24, pic: 2 });
  close(r.wealth.pac[0], 1176); close(r.wealth.pic[0], 1198);
  close(r.totalDeposited, 1200);
  const r2 = E.simulate({ ...p, initial: 1000, recurring: 0 });
  assert.deepEqual(r2.fees, { pac: 2, pic: 2 });
  close(r2.wealth.pac[0], 998); close(r2.wealth.pic[0], 998);
  assert.throws(() => E.simulate({ ...p, recurring: 1 }), /commissione/);
});

test('liquidation applies tax to positive nominal gain only, preserves gross minus tax = net', () => {
  assert.deepEqual(E.liquidate(150, 100, 0.26), { gross: 150, tax: 13, net: 137 });
  assert.deepEqual(E.liquidate(50, 100, 0.26), { gross: 50, tax: 0, net: 50 });
  assert.deepEqual(E.liquidate(150, 100, 0), { gross: 150, tax: 0, net: 150 });
});

test('real capital reference discounts each payment at its own date, not all at maturity', () => {
  const p = deterministic({ inflation: 0.05, riskFree: 0.025, expectedReturn: 0.08 });
  const r = E.simulate(p), nominal = E.view(r, 'net', false), real = E.view(r, 'net', true);
  close(real.references.pac, E.presentValue(E.cashflows(p), p.inflation));
  close(real.references.pic, r.pv);
  assert.ok(real.references.pac > r.totalDeposited / 1.05 ** p.years);
  close(nominal.wealth.pac[0] / 1.05 ** p.years, real.wealth.pac[0]);
  const nominalIRR = E.irr(nominal.wealth.pac[0], E.cashflows(p), p.years);
  const deflatedFlows = E.cashflows(p).map(f => ({ time: f.time, amount: f.amount / 1.05 ** f.time }));
  close(E.irr(real.wealth.pac[0], deflatedFlows, p.years), (1 + nominalIRR) / 1.05 - 1, 1e-10);
});

test('risk-free benchmark matches same-flow future value, with strategy-specific terminal taxation', () => {
  const p = deterministic({ expectedReturn: 0.06, riskFree: 0.03 });
  const r = E.simulate(p), v = E.view(r, 'net', false, 'riskFree');
  const future = E.futureValue(E.cashflows(p), p.riskFree, p.years);
  close(v.references.pac, E.liquidate(future, r.totalDeposited, p.taxRate).net);
  close(v.references.pic, E.liquidate(future, r.pv, p.taxRate).net);
});

test('VaR is a loss quantile, ES averages the worst tail; profitable tails stay negative', () => {
  const wealth = Float64Array.from({ length: 100 }, (_, i) => i + 1);
  close(E.quantile(wealth, 0.05), 5.95);
  const tail = E.tailRisk(wealth, 100, 0.95);
  close(tail.var, 94.05); close(tail.es, 97);
  const extreme = E.tailRisk(wealth, 100, 0.99);
  close(extreme.var, 98.01); close(extreme.es, 99);
  assert.ok(extreme.es >= extreme.var && tail.es >= tail.var);
  const profit = E.tailRisk(Float64Array.from([200, 210, 220, 230]), 100, 0.95);
  assert.ok(profit.var < 0 && profit.es < 0);
  close(E.lowerTailMean([1, 3, 5, 7, 9], 0.3), 5 / 3);
});

test('histogram includes 100% of scenarios, including outliers and degenerate distributions', () => {
  for (const series of [{ pac: [0, 1, 2, 1e12], pic: [0, 1, 2, 3] }, { pac: [100, 100], pic: [100, 100] }]) {
    const h = E.histogram(series);
    assert.ok(Number.isFinite(h.width) && h.width > 0);
    for (const key of ['pac', 'pic']) assert.equal(h.counts[key].reduce((a, b) => a + b, 0), series[key].length);
  }
});

test('same seed is reproducible and PAC/PIC have identical market risk when no further contributions', () => {
  const p = { ...E.DEFAULTS, recurring: 0, years: 3, simulations: 100, seed: 0 };
  const a = E.simulate(p), b = E.simulate(p);
  assert.deepEqual(a, b);
  assert.deepEqual(a.wealth.pac, a.wealth.pic);
  for (let i = 0; i < p.simulations; i++) {
    close(a.drawdown.pac[i], a.drawdown.pic[i]);
    close(a.drawdown.pic[i], a.drawdown.asset[i], 1e-12);
  }
  assert.deepEqual(a.wins.gross, { pac: 0, pic: 0, tie: 1 });
});

test('drawdown is observed independently of contribution frequency; deposits do not dilute asset risk', () => {
  const p = { ...E.DEFAULTS, years: 3, simulations: 200, seed: 11 };
  const monthly = E.simulate({ ...p, frequency: 12 }), quarterly = E.simulate({ ...p, frequency: 4 });
  assert.deepEqual(monthly.drawdown.asset, quarterly.drawdown.asset);
  assert.notDeepEqual(monthly.drawdown.asset, monthly.drawdown.pac);
  for (const values of Object.values(monthly.drawdown)) assert.ok(values.every(v => v >= 0 && v <= 1));
});

test('Poisson permits several jumps per step and matches the count distribution', () => {
  const dist = E.randomDistributions(E.randomSource(123));
  const n = 100000, lambda = 0.4;
  let sum = 0, multiple = 0;
  for (let i = 0; i < n; i++) { const k = dist.poisson(lambda); sum += k; if (k >= 2) multiple++; }
  close(sum / n, lambda, 6 * Math.sqrt(lambda / n));
  close(multiple / n, 1 - Math.exp(-lambda) * (1 + lambda), 0.004);
});

test('compensated lognormal jumps match exact annual mean and variance', () => {
  const p = { ...E.DEFAULTS, initial: 100, recurring: 0, years: 1, simulations: 40000,
    fee: 0, ter: 0.002, jumpFrequency: 1, jumpMean: -0.35, jumpLogStd: 0.1, seed: 841 };
  const r = E.simulate(p), m = E.modelMoments(p);
  const returns = Array.from(r.wealth.pic, v => v / 100 - 1);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, x) => sum + (x - mean) ** 2, 0) / returns.length;
  close(mean, m.mean, 6 * m.standardDeviation / Math.sqrt(p.simulations));
  close(variance, m.standardDeviation ** 2, 0.008);
  close(r.jumpCount / p.simulations, p.jumpFrequency, 0.04);
  assert.ok(r.wealth.pic.every(v => v > 0));
  close(m.mean, (1 + p.expectedReturn) * Math.exp(-p.ter) - 1);
});

test('GBM quantiles agree with analytic lognormal quantiles within Monte Carlo error', () => {
  const p = { ...E.DEFAULTS, initial: 100, recurring: 0, years: 1, simulations: 30000, fee: 0, jumps: false, seed: 413 };
  const r = E.simulate(p), z05 = -1.64485362695147;
  const median = 100 * Math.exp(Math.log1p(p.expectedReturn) - p.ter - 0.5 * p.volatility ** 2);
  const q05 = median * Math.exp(p.volatility * z05);
  close(E.quantile(r.wealth.pic, 0.5), median, 0.5);
  close(E.quantile(r.wealth.pic, 0.05), q05, 0.8);
});

test('annual Sharpe uses full annual simple-return variance, including jumps and TER', () => {
  const m = E.modelMoments(E.DEFAULTS);
  close(m.simpleSharpe, 0.25);
  close(m.mean, 0.060377123584041376);
  close(m.standardDeviation, 0.1828976354892679);
  close(m.sharpe, 0.19342581159895442);
  assert.ok(m.standardDeviation > E.DEFAULTS.volatility);
  assert.equal(E.modelMoments(deterministic()).sharpe, null);
});

test('return and volatility remain independent user assumptions, not locked to target Sharpe', () => {
  const p = { ...E.DEFAULTS, expectedReturn: 0.09, volatility: 0.2, riskFree: 0.03, simulations: 10, years: 1 };
  const r = E.simulate(p);
  close(r.params.expectedReturn, 0.09);
  close(r.params.volatility, 0.2);
  close(r.moments.simpleSharpe, 0.3);
  assert.notEqual(r.moments.simpleSharpe, 0.25);
});

test('with/without-jump comparisons retain jump assumptions while the active switch changes', () => {
  const p = { ...E.DEFAULTS, jumps: false, simulations: 10, years: 1 };
  const r = E.simulate(p);
  const without = E.modelMoments({ ...r.params, jumps: false });
  const withJumps = E.modelMoments({ ...r.params, jumps: true });
  close(r.params.jumpFrequency, 0.2);
  close(r.params.jumpMean, -0.18);
  close(r.moments.sharpe, 0.22116857665713258);
  close(r.moments.sharpe, without.sharpe);
  close(withJumps.sharpe, 0.19342581159895442);
  close(withJumps.mean, without.mean);
  assert.ok(withJumps.standardDeviation > without.standardDeviation);
  close(withJumps.simpleSharpe, without.simpleSharpe);
});

test('invalid or missing values are rejected instead of producing plausible-looking results', () => {
  for (const override of [{ years: NaN }, { years: 100 }, { years: 1.5 }, { volatility: Infinity },
    { recurring: -1 }, { initial: 0, recurring: 0 }, { frequency: 0 }, { seed: -1 },
    { expectedReturn: -1 }, { simulations: 1e9 }, { jumpMean: -1 }]) {
    assert.throws(() => E.simulate({ ...E.DEFAULTS, ...override }));
  }
});

test('paired differences and marginal-percentile differences are distinct statistics', () => {
  const p = { ...E.DEFAULTS, simulations: 200, years: 2 };
  const r = E.simulate(p), v = E.view(r);
  const marginal = E.quantile(v.wealth.pic, 0.5) - E.quantile(v.wealth.pac, 0.5);
  const paired = E.quantile(r.delta.net, 0.5);
  assert.ok(Math.abs(marginal - paired) > 0.001);
  for (const mode of ['gross', 'net']) close(Object.values(r.wins[mode]).reduce((a, b) => a + b, 0), 1);
});
