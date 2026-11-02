/* Financial model shared by the browser, worker and Node tests. No DOM or network. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PacPic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STEPS_PER_YEAR = 24;
  const QUANTILES = [1, 5, 10, 25, 50, 75, 90, 95, 99];
  const DEFAULTS = Object.freeze({
    initial: 5000, recurring: 300, frequency: 12, years: 15, timing: 'end',
    expectedReturn: 0.05, volatility: 0.15, riskFree: 0.025,
    jumps: true, jumpFrequency: 0.2, jumpMean: -0.18, jumpLogStd: 0.05,
    inflation: 0.02, ter: 0.002, fee: 1, taxRate: 0.26,
    simulations: 10000, seed: 42
  });

  function validate(p) {
    const limits = {
      initial: [0, 10000000], recurring: [0, 100000], years: [1, 40],
      expectedReturn: [-0.5, 0.5], volatility: [0, 1], riskFree: [-0.1, 0.3],
      jumpFrequency: [0, 2], jumpMean: [-0.95, 0.5], jumpLogStd: [0, 0.5],
      inflation: [-0.05, 0.2], ter: [0, 0.1], fee: [0, 500], taxRate: [0, 0.6],
      simulations: [1, 100000], seed: [0, 4294967295]
    };
    for (const [key, [min, max]] of Object.entries(limits)) {
      if (!Number.isFinite(p[key]) || p[key] < min || p[key] > max) {
        throw new RangeError(`Parametro non valido: ${key}. Valore ammesso: ${min} - ${max}.`);
      }
    }
    if (![4, 12, 24].includes(p.frequency)) throw new RangeError('Frequenza non valida.');
    if (!['start', 'end'].includes(p.timing)) throw new RangeError('Momento dei versamenti non valido.');
    for (const key of ['years', 'simulations', 'seed']) {
      if (!Number.isInteger(p[key])) throw new RangeError(`${key} deve essere un intero.`);
    }
    if (typeof p.jumps !== 'boolean') throw new TypeError('Il parametro jumps deve essere booleano.');
    if (p.initial + p.recurring === 0) throw new RangeError('Inserisci almeno un versamento positivo.');
    if ((p.initial > 0 && p.initial <= p.fee) || (p.recurring > 0 && p.recurring <= p.fee)) {
      throw new RangeError('Ogni versamento positivo deve superare la commissione per ordine.');
    }
    if (presentValue(cashflows(p), p.riskFree) <= p.fee) {
      throw new RangeError('Il capitale equivalente del PIC deve superare la commissione.');
    }
    return p;
  }

  function cashflows(p) {
    const flows = [];
    if (p.initial > 0) flows.push({ time: 0, amount: p.initial });
    if (p.recurring > 0) {
      const n = p.frequency * p.years;
      const offset = p.timing === 'start' ? 0 : 1;
      for (let k = 0; k < n; k++) flows.push({ time: (k + offset) / p.frequency, amount: p.recurring });
    }
    return flows;
  }

  function presentValue(flows, annualRate) {
    const logRate = Math.log1p(annualRate);
    return flows.reduce((sum, f) => sum + f.amount * Math.exp(-logRate * f.time), 0);
  }

  function futureValue(flows, annualRate, years) {
    const logRate = Math.log1p(annualRate);
    return flows.reduce((sum, f) => sum + f.amount * Math.exp(logRate * (years - f.time)), 0);
  }

  function liquidate(gross, basis, rate) {
    const tax = Math.max(0, gross - basis) * rate;
    return { gross, tax, net: gross - tax };
  }

  // Annual effective money-weighted return. Positive investor outflows, one terminal inflow.
  // Solve in log(1+r), allowing the full r > -100% domain without an arbitrary upper cap.
  function irr(terminal, flows, years) {
    if (!Number.isFinite(terminal) || terminal <= 0 || flows.length === 0) return null;
    const lastDateAmount = flows.reduce((sum, f) => sum + (f.time === years ? f.amount : 0), 0);
    if (!flows.some(f => f.time < years) || terminal <= lastDateAmount) return null;
    const fv = x => flows.reduce((sum, f) => sum + f.amount * Math.exp(x * (years - f.time)), 0);
    let low = -1, high = 1;
    while (fv(low) > terminal && low > -1024) low *= 2;
    while (fv(high) < terminal && high < 1024) high *= 2;
    if (fv(low) > terminal || fv(high) < terminal) return null;
    for (let i = 0; i < 100; i++) {
      const mid = (low + high) / 2;
      if (fv(mid) > terminal) high = mid; else low = mid;
      if (high - low < 1e-13) break;
    }
    return Math.expm1((low + high) / 2);
  }

  // Mulberry32: deterministic, non-cryptographic simulation generator, including seed 0.
  function randomSource(seed) {
    let state = seed >>> 0;
    return function () {
      state = (state + 0x6D2B79F5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randomDistributions(random) {
    let spare = null;
    return {
      normal() {
        if (spare !== null) { const z = spare; spare = null; return z; }
        const u = 1 - random();
        const angle = 2 * Math.PI * random();
        const radius = Math.sqrt(-2 * Math.log(u));
        spare = radius * Math.sin(angle);
        return radius * Math.cos(angle);
      },
      poisson(mean) {
        if (mean === 0) return 0;
        const threshold = Math.exp(-mean);
        let product = 1, count = 0;
        do { count++; product *= random(); } while (product > threshold);
        return count - 1;
      }
    };
  }

  // Exact one-year simple-return moments for the compensated compound-Poisson model.
  function modelMoments(p) {
    const lambda = p.jumps ? p.jumpFrequency : 0;
    const logJumpMean = Math.log1p(p.jumpMean) - 0.5 * p.jumpLogStd ** 2;
    const jumpSecondMoment = p.jumpMean ** 2 + (1 + p.jumpMean) ** 2 * Math.expm1(p.jumpLogStd ** 2);
    const logVarianceRate = p.volatility ** 2 + lambda * jumpSecondMoment;
    const growth = Math.log1p(p.expectedReturn) - p.ter;
    const mean = Math.expm1(growth);
    const standardDeviation = Math.exp(growth) * Math.sqrt(Math.expm1(logVarianceRate));
    return {
      lambda, growth, logJumpMean, jumpSecondMoment, logVarianceRate,
      mean, standardDeviation,
      sharpe: standardDeviation > 0 ? (mean - p.riskFree) / standardDeviation : null,
      simpleSharpe: p.volatility > 0 ? (p.expectedReturn - p.riskFree) / p.volatility : null
    };
  }

  // Type-7 quantile, with optional monotone transform applied before interpolation.
  function quantile(sorted, probability, transform = v => v) {
    if (sorted.length === 0) return null;
    const index = Math.max(0, Math.min(1, probability)) * (sorted.length - 1);
    const low = Math.floor(index), high = Math.ceil(index), fraction = index - low;
    return transform(sorted[low]) * (1 - fraction) + transform(sorted[high]) * fraction;
  }

  function lowerTailMean(sorted, fraction) {
    const mass = sorted.length * fraction;
    const whole = Math.floor(mass);
    let sum = 0;
    for (let i = 0; i < whole; i++) sum += sorted[i];
    if (whole < sorted.length) sum += (mass - whole) * sorted[whole];
    return sum / mass;
  }

  // Positive loss = shortfall below the stated reference; negative loss = profit.
  function tailRisk(sortedWealth, reference, confidence) {
    const fraction = 1 - confidence;
    const floor = quantile(sortedWealth, fraction);
    return {
      confidence, reference, wealthQuantile: floor,
      var: reference - floor,
      es: reference - lowerTailMean(sortedWealth, fraction),
      tailObservations: sortedWealth.length * fraction
    };
  }

  function cumulativeFlows(p, step) {
    const time = step / STEPS_PER_YEAR;
    const flows = cashflows(p).filter(f => f.time <= time + 1e-10);
    return { nominal: presentValue(flows, 0), real: presentValue(flows, p.inflation) };
  }

  function simulate(parameters, onProgress) {
    const p = validate({ ...DEFAULTS, ...parameters });
    const flows = cashflows(p);
    const totalDeposited = presentValue(flows, 0);
    const pv = presentValue(flows, p.riskFree);
    const realDeposits = presentValue(flows, p.inflation);
    const moments = modelMoments(p);
    const totalSteps = p.years * STEPS_PER_YEAR;
    const paymentEvery = STEPS_PER_YEAR / p.frequency;
    const dt = 1 / STEPS_PER_YEAR;
    const drift = (moments.growth - moments.lambda * p.jumpMean - 0.5 * p.volatility ** 2) * dt;
    const diffusion = p.volatility * Math.sqrt(dt);
    const random = randomDistributions(randomSource(p.seed));
    const n = p.simulations;
    const pac = new Float64Array(n), pic = new Float64Array(n);
    const pacDD = new Float64Array(n), picDD = new Float64Array(n), assetDD = new Float64Array(n);
    const deltaGross = new Float64Array(n), deltaNet = new Float64Array(n);
    const pacSamples = Array.from({ length: p.years + 1 }, () => new Float64Array(n));
    const picSamples = Array.from({ length: p.years + 1 }, () => new Float64Array(n));
    const initialNet = p.initial > 0 ? p.initial - p.fee : 0;
    const installmentNet = p.recurring > 0 ? p.recurring - p.fee : 0;
    const firstInstallment = p.timing === 'start' ? installmentNet : 0;
    let jumpCount = 0;

    for (let sim = 0; sim < n; sim++) {
      let a = initialNet + firstInstallment, b = pv - p.fee, asset = 1;
      let peakA = a, peakB = b, peakAsset = 1;
      let maxA = 0, maxB = 0, maxAsset = 0;
      pacSamples[0][sim] = a;
      picSamples[0][sim] = b;
      for (let step = 1; step <= totalSteps; step++) {
        const jumps = random.poisson(moments.lambda * dt);
        jumpCount += jumps;
        const logJump = jumps > 0 ? jumps * moments.logJumpMean + Math.sqrt(jumps) * p.jumpLogStd * random.normal() : 0;
        const factor = Math.exp(drift + (diffusion > 0 ? diffusion * random.normal() : 0) + logJump);
        a *= factor; b *= factor; asset *= factor;
        peakA = Math.max(peakA, a); peakB = Math.max(peakB, b); peakAsset = Math.max(peakAsset, asset);
        if (peakA > 0) maxA = Math.max(maxA, 1 - a / peakA);
        maxB = Math.max(maxB, 1 - b / peakB);
        maxAsset = Math.max(maxAsset, 1 - asset / peakAsset);
        const paymentDue = step % paymentEvery === 0 && (p.timing === 'end' || step < totalSteps);
        if (paymentDue) { a += installmentNet; peakA = Math.max(peakA, a); }
        if (step % STEPS_PER_YEAR === 0) {
          pacSamples[step / STEPS_PER_YEAR][sim] = a;
          picSamples[step / STEPS_PER_YEAR][sim] = b;
        }
      }
      if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('La simulazione ha prodotto un valore non finito. Riduci i parametri estremi.');
      pac[sim] = a; pic[sim] = b;
      pacDD[sim] = maxA; picDD[sim] = maxB; assetDD[sim] = maxAsset;
      deltaGross[sim] = b - a;
      deltaNet[sim] = liquidate(b, pv, p.taxRate).net - liquidate(a, totalDeposited, p.taxRate).net;
      if (onProgress && (sim + 1) % Math.max(1, Math.floor(n / 20)) === 0) onProgress((sim + 1) / n);
    }
    const pairedWinRates = values => {
      let pacWins = 0, picWins = 0, ties = 0;
      const tolerance = 1e-8 * Math.max(1, pv, totalDeposited);
      for (const d of values) {
        if (d > tolerance) picWins++;
        else if (d < -tolerance) pacWins++;
        else ties++;
      }
      return { pac: pacWins / n, pic: picWins / n, tie: ties / n };
    };
    const wins = { gross: pairedWinRates(deltaGross), net: pairedWinRates(deltaNet) };
    const fan = [];
    for (let year = 0; year <= p.years; year++) {
      const sPac = pacSamples[year].sort(), sPic = picSamples[year].sort();
      const contributed = cumulativeFlows(p, year * STEPS_PER_YEAR);
      const entry = { year, contributed, pac: { gross: {}, net: {} }, pic: { gross: {}, net: {} } };
      for (const q of QUANTILES) {
        entry.pac.gross[q] = quantile(sPac, q / 100);
        entry.pic.gross[q] = quantile(sPic, q / 100);
        entry.pac.net[q] = quantile(sPac, q / 100, v => liquidate(v, contributed.nominal, p.taxRate).net);
        entry.pic.net[q] = quantile(sPic, q / 100, v => liquidate(v, pv, p.taxRate).net);
      }
      fan.push(entry);
    }
    return {
      params: p, pv, totalDeposited, realDeposits, moments, wins, fan,
      fees: { pac: flows.length * p.fee, pic: p.fee },
      wealth: { pac: pac.sort(), pic: pic.sort() },
      delta: { gross: deltaGross.sort(), net: deltaNet.sort() },
      drawdown: { pac: pacDD.sort(), pic: picDD.sort(), asset: assetDD.sort() },
      jumpCount, stepsPerYear: STEPS_PER_YEAR
    };
  }

  function view(result, mode = 'net', real = false, riskReference = 'capital') {
    const p = result.params;
    const discount = real ? (1 + p.inflation) ** p.years : 1;
    const shownWealth = {}, references = {}, tails = {}, lossProbability = {};
    const commonRfGross = result.pv * (1 + p.riskFree) ** p.years;
    for (const strategy of ['pac', 'pic']) {
      const basis = strategy === 'pac' ? result.totalDeposited : result.pv;
      const transform = value => (mode === 'net' ? liquidate(value, basis, p.taxRate).net : value) / discount;
      shownWealth[strategy] = Float64Array.from(result.wealth[strategy], transform);
      references[strategy] = riskReference === 'riskFree'
        ? transform(commonRfGross)
        : (real ? (strategy === 'pac' ? result.realDeposits : result.pv) : basis);
      tails[strategy] = [0.95, 0.99].map(c => tailRisk(shownWealth[strategy], references[strategy], c));
      lossProbability[strategy] = shownWealth[strategy].filter(v => v < references[strategy] - 1e-8 * Math.max(1, references[strategy])).length / p.simulations;
    }
    return { wealth: shownWealth, references, tails, lossProbability, discount };
  }

  // Keep all observations. The open-ended final bin is explicitly labelled by the UI.
  function histogram(series, bins = 24) {
    const arrays = Object.values(series);
    const min = Math.min(...arrays.map(a => a[0]));
    const max = Math.max(...arrays.map(a => quantile(a, 0.99)));
    const width = max > min ? (max - min) / (bins - 1) : Math.max(1, Math.abs(min) * 0.02);
    const counts = {};
    for (const [key, values] of Object.entries(series)) {
      counts[key] = new Array(bins).fill(0);
      for (const v of values) counts[key][Math.max(0, Math.min(bins - 1, Math.floor((v - min) / width)))]++;
    }
    return { min, width, bins, counts };
  }

  return { DEFAULTS, STEPS_PER_YEAR, QUANTILES, validate, cashflows, presentValue, futureValue,
    liquidate, irr, randomSource, randomDistributions, modelMoments, quantile, lowerTailMean,
    tailRisk, cumulativeFlows, simulate, view, histogram };
});
