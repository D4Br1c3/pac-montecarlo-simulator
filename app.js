(function () {
  'use strict';
  const E = window.PacPic;
  const $ = id => document.getElementById(id);
  const form = $('simulatorForm');
  const currency = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const number = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 3 });
  const compactCurrency = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 0 });
  const money = value => currency.format(value);
  const percent = (value, digits = 1, signed = false) => value === null || !Number.isFinite(value) ? 'N.D.' : `${signed && value > 0 ? '+' : ''}${(value * 100).toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
  const ratio = value => value === null || !Number.isFinite(value) ? 'N.D.' : value.toLocaleString('it-IT', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const percentInputs = new Set(['expectedReturn', 'volatility', 'riskFree', 'jumpMean', 'inflation', 'ter', 'taxRate']);
  const colors = { pac: '#46e0bd', pic: '#ffb176', asset: '#86c8fc' };
  let lastResult = null, mode = 'net', real = false, worker = null, jobId = 0, busy = false;
  let tableRows = [], chartObjects = {};

  function readParams() {
    const p = { ...E.DEFAULTS };
    for (const key of Object.keys(E.DEFAULTS)) {
      const input = $(key);
      if (!input) continue;
      if (input.type === 'checkbox') p[key] = input.checked;
      else if (input.tagName === 'SELECT' && key === 'timing') p[key] = input.value;
      else p[key] = input.value.trim() === '' ? NaN : Number(input.value) / (percentInputs.has(key) ? 100 : 1);
    }
    if (!p.jumps) {
      p.jumpFrequency = 0;
      p.jumpMean = E.DEFAULTS.jumpMean;
    }
    return p;
  }

  function error(message) {
    $('formError').textContent = message;
    $('formError').hidden = !message;
  }

  function syncParameters() {
    const p = readParams();
    $('jumpFields').hidden = !p.jumps;
    $('jumpHint').hidden = !p.jumps;
    $('jumpFrequency').disabled = !p.jumps;
    $('jumpMean').disabled = !p.jumps;
    if (Number.isFinite(p.jumpFrequency)) {
      $('jumpHint').textContent = p.jumpFrequency > 0
        ? `${number.format(p.jumpFrequency)} salti/anno: in media uno ogni ${number.format(1 / p.jumpFrequency)} anni. Il rendimento atteso resta invariato; la dispersione cambia.`
        : 'Frequenza zero: nessun salto, anche con il modulo attivo.';
    }
    const validDates = Number.isInteger(p.years) && p.years >= 1 && p.years <= 40 && [4, 12, 24].includes(p.frequency);
    if (validDates && Number.isFinite(p.initial) && Number.isFinite(p.recurring) && Number.isFinite(p.riskFree) && p.riskFree > -1) {
      const flows = E.cashflows(p);
      $('equivalentCapital').textContent = money(E.presentValue(flows, p.riskFree));
      $('nominalContributions').textContent = `Il PAC versa in totale ${money(E.presentValue(flows, 0))} in ${p.years} anni.`;
    } else {
      $('equivalentCapital').textContent = 'Completa i dati';
      $('nominalContributions').textContent = '';
    }
    $('staleNotice').hidden = !lastResult || JSON.stringify(p) === JSON.stringify(lastResult.params);
  }

  function setBusy(value) {
    busy = value;
    $('simulateButton').disabled = value;
    $('simulateButton').textContent = value ? 'Simulazione in corso...' : 'Simula gli scenari ↗';
    $('cancelButton').hidden = !value;
    $('progressWrap').hidden = !value;
    $('results').setAttribute('aria-busy', String(value));
    if (value) $('calculationProgress').value = 0;
  }

  function calculate() {
    if (busy) return;
    error('');
    if (!form.reportValidity()) return;
    let p;
    try { p = E.validate(readParams()); } catch (err) { error(err.message); return; }
    const id = ++jobId;
    const started = performance.now();
    setBusy(true);
    $('calculationStatus').textContent = `Calcolo di ${number.format(p.simulations)} scenari...`;
    function done(result) {
      if (id !== jobId) return;
      if (worker) { worker.terminate(); worker = null; }
      lastResult = result;
      setBusy(false);
      render();
      syncParameters();
      const seconds = (performance.now() - started) / 1000;
      $('calculationStatus').textContent = `Completato in ${number.format(seconds)} s. Campione ${p.seed}.`;
    }
    function failed(message) {
      if (id !== jobId) return;
      if (worker) { worker.terminate(); worker = null; }
      setBusy(false);
      error(message);
      $('calculationStatus').textContent = 'Calcolo interrotto. Correggi i dati e riprova.';
    }
    function localFallback() {
      if (id !== jobId) return;
      if (worker) { worker.terminate(); worker = null; }
      // Direct file opening can block workers. The same pure model still runs locally.
      setTimeout(() => {
        if (id !== jobId) return;
        try { done(E.simulate(p)); } catch (err) { failed(err.message); }
      }, 20);
    }
    if (window.Worker && location.protocol !== 'file:') {
      try {
        worker = new Worker('./simulation-worker.js');
        worker.onmessage = event => {
          if (event.data.id !== id || id !== jobId) return;
          if (event.data.error) failed(event.data.error);
          else if (event.data.result) done(event.data.result);
          else $('calculationProgress').value = event.data.progress;
        };
        worker.onerror = event => { event.preventDefault(); localFallback(); };
        worker.postMessage({ id, params: p });
      } catch { localFallback(); }
    } else localFallback();
  }

  function netRate(rate) {
    if (rate === null || !Number.isFinite(rate)) return null;
    return real ? (1 + rate) / (1 + lastResult.params.inflation) - 1 : rate;
  }

  function render() {
    if (!lastResult) return;
    const r = lastResult, p = r.params;
    const v = E.view(r, mode, real, $('riskReference').value);
    const medianPac = E.quantile(v.wealth.pac, 0.5), medianPic = E.quantile(v.wealth.pic, 0.5);
    $('pacMedian').textContent = money(medianPac);
    $('picMedian').textContent = money(medianPic);
    const viewLabel = mode === 'net' ? 'netto' : 'lordo';
    $('pacMedianLabel').textContent = `Capitale mediano PAC · ${viewLabel}`;
    $('picMedianLabel').textContent = `Capitale mediano PIC · ${viewLabel}`;
    const pacNetMedian = E.quantile(r.wealth.pac, 0.5, x => E.liquidate(x, r.totalDeposited, p.taxRate).net);
    const picNetMedian = E.quantile(r.wealth.pic, 0.5, x => E.liquidate(x, r.pv, p.taxRate).net);
    $('pacIrr').textContent = `TIR annuo netto${real ? ' reale' : ''}: ${percent(netRate(E.irr(pacNetMedian, E.cashflows(p), p.years)), 2, true)}`;
    $('picCagr').textContent = `CAGR annuo netto${real ? ' reale' : ''}: ${percent(netRate((picNetMedian / r.pv) ** (1 / p.years) - 1), 2, true)}`;
    $('winRate').textContent = percent(r.wins[mode].pic);
    $('otherWinRates').textContent = `PAC: ${percent(r.wins[mode].pac)} · Parità: ${percent(r.wins[mode].tie)}`;
    $('modelSharpe').textContent = ratio(r.moments.sharpe);
    $('sharpeExplanation').innerHTML = `<strong>Sharpe semplificato: ${ratio(r.moments.simpleSharpe)}</strong> = (rendimento atteso − RF) / volatilità di base, prima dei costi e senza salti. Il modello completo ha rendimento annuo medio dopo TER ${percent(r.moments.mean, 2)} e deviazione standard annua ${percent(r.moments.standardDeviation, 2)}. Lo Sharpe principale è nominale, prima di commissioni e imposte.`;
    $('comparisonExplanation').textContent = `Confronto a pari valore attuale: PIC ${money(r.pv)} oggi; PAC ${money(r.totalDeposited)} distribuiti nel tempo. Commissioni pagate: PAC ${money(r.fees.pac)}, PIC ${money(r.fees.pic)}. Non sono simulati prestiti né liquidità in attesa di investimento.`;
    $('resultStamp').textContent = `${number.format(p.simulations)} scenari · ${p.years} anni · rate a ${p.timing === 'end' ? 'fine' : 'inizio'} periodo · campione ${p.seed} · ${real ? 'euro di oggi' : 'euro nominali'}`;
    $('fanSubtitle').textContent = `${mode === 'net' ? 'Capitali dopo la liquidazione ipotetica' : 'Capitali prima dell’imposta'}, ${real ? 'in euro di oggi' : 'in euro nominali'}. Mediana e fasce a ogni anno.`;
    $('histogramSubtitle').textContent = `Capitali ${mode === 'net' ? 'netti' : 'lordi'} a scadenza, ${real ? 'in euro di oggi' : 'nominali'}. Percentuale degli scenari per intervallo.`;
    $('tableSubtitle').textContent = `Importi ${real ? 'in euro di oggi' : 'nominali'}. Imposta del ${percent(p.taxRate, 1)} sui guadagni nominali. TIR e CAGR sempre netti${real ? ' e reali' : ''}.`;
    renderRisk(v);
    renderStats(v);
    renderDrawdownSummary();
    if (!window.Chart) { $('chartError').hidden = false; return; }
    try {
      window.Chart.defaults.color = '#a5b4c8';
      window.Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
      window.Chart.defaults.font.size = 11;
      window.Chart.defaults.animation = false;
      drawFan(); drawHistogram(v); drawDrawdown();
      $('chartError').hidden = true;
    } catch (err) {
      console.error('Chart rendering failed:', err);
      $('chartError').hidden = false;
    }
  }

  function renderRisk(v) {
    const r = lastResult, p = r.params;
    const rfReference = $('riskReference').value === 'riskFree';
    $('riskDescription').textContent = `Orizzonte: ${p.years} anni. Valori ${mode === 'net' ? 'dopo' : 'prima delle'} imposte, ${real ? 'in euro di oggi' : 'nominali'}. ${rfReference ? 'La perdita è lo scarto dall’investimento degli stessi flussi al tasso RF, con lo stesso trattamento fiscale semplificato.' : `La perdita è lo scarto dal capitale versato${real ? ', riportando ogni rata al potere d’acquisto della sua data' : ', senza rivalutarlo al RF'}.`} Riferimenti: PAC ${money(v.references.pac)}; PIC ${money(v.references.pic)}.`;
    const descriptions = [
      ['VaR 95%', 0, 'var', 'Circa il 5% degli scenari ha una perdita maggiore.'],
      ['ES 95%', 0, 'es', 'Perdita media nel peggior 5% degli scenari.'],
      ['VaR 99%', 1, 'var', 'Circa l’1% degli scenari ha una perdita maggiore.'],
      ['ES 99%', 1, 'es', 'Perdita media nel peggior 1% degli scenari.']
    ];
    const cell = (strategy, index, key) => {
      const value = v.tails[strategy][index][key];
      return `${money(value)}<small>${percent(value / v.references[strategy], 1)} del riferimento</small>`;
    };
    $('riskTableBody').innerHTML = descriptions.map(([label, index, key, description]) => `<tr class="${key === 'es' ? 'es-row' : ''}"><th scope="row">${label}</th><td>${cell('pac', index, key)}</td><td>${cell('pic', index, key)}</td><td>${description}</td></tr>`).join('') + `<tr><th scope="row">Probabilità di perdita</th><td>${percent(v.lossProbability.pac)}</td><td>${percent(v.lossProbability.pic)}</td><td>Quota di scenari con capitale finale sotto il riferimento scelto.</td></tr>`;
    $('tailSampleNote').textContent = `Con ${number.format(p.simulations)} scenari, l’ES 99% usa circa ${number.format(p.simulations * 0.01)} esiti, l’ES 95% circa ${number.format(p.simulations * 0.05)}. Le code oscillano tra campioni: prova anche un seed diverso.`;
  }

  function renderStats(v) {
    const r = lastResult, p = r.params;
    tableRows = [];
    $('statsTableBody').innerHTML = E.QUANTILES.map(q => {
      const pac = E.liquidate(E.quantile(r.wealth.pac, q / 100), r.totalDeposited, p.taxRate);
      const pic = E.liquidate(E.quantile(r.wealth.pic, q / 100), r.pv, p.taxRate);
      const pacIrr = netRate(E.irr(pac.net, E.cashflows(p), p.years));
      const picCagr = netRate((pic.net / r.pv) ** (1 / p.years) - 1);
      const values = [q, pac.gross / v.discount, pac.net / v.discount, pac.tax / v.discount, pacIrr,
        pic.gross / v.discount, pic.net / v.discount, pic.tax / v.discount, picCagr, (pic.net - pac.net) / v.discount];
      tableRows.push(values);
      return `<tr${q === 50 ? ' class="median-row"' : ''}><th scope="row">P${q}${q === 50 ? ' · Mediana' : ''}</th><td>${money(values[1])}</td><td class="pac-text">${money(values[2])}</td><td>${money(values[3])}</td><td class="pac-text">${percent(pacIrr, 2, true)}</td><td>${money(values[5])}</td><td class="pic-text">${money(values[6])}</td><td>${money(values[7])}</td><td class="pic-text">${percent(picCagr, 2, true)}</td><td>${money(values[9])}</td></tr>`;
    }).join('');
    const deltas = r.delta.net;
    $('pairedDelta').textContent = `Sugli stessi percorsi di mercato: mediana della differenza netta PIC − PAC ${money(E.quantile(deltas, 0.5) / v.discount)}; intervallo P5-P95 da ${money(E.quantile(deltas, 0.05) / v.discount)} a ${money(E.quantile(deltas, 0.95) / v.discount)}.`;
  }

  function chart(id, config) {
    if (chartObjects[id]) chartObjects[id].destroy();
    chartObjects[id] = new window.Chart($(id), config);
  }

  function axes(yType = 'money') {
    return {
      x: { grid: { display: false }, ticks: { color: '#a5b4c8', maxTicksLimit: 10 } },
      y: { beginAtZero: true, grid: { color: '#ffffff0a' }, ticks: {
        color: '#a5b4c8', maxTicksLimit: 6,
        callback: value => yType === 'money' ? compactCurrency.format(value) : `${number.format(value)}%`
      } }
    };
  }

  function drawFan() {
    const r = lastResult, p = r.params, datasets = [];
    for (const strategy of ['pic', 'pac']) {
      const name = strategy.toUpperCase(), color = colors[strategy];
      const values = q => r.fan.map(f => f[strategy][mode][q] / (real ? (1 + p.inflation) ** f.year : 1));
      const add = (q, extra = {}) => datasets.push({ label: `${name} · P${q}`, data: values(q), borderColor: color, borderWidth: 0.7, pointRadius: 0, fill: false, order: 2, ...extra });
      add(90, { fill: '+1', backgroundColor: `${color}12`, borderColor: `${color}77` });
      add(10, { borderColor: `${color}77` });
      add(75, { fill: '+1', backgroundColor: `${color}28`, borderColor: `${color}99` });
      add(25, { borderColor: `${color}99` });
      add(50, { borderWidth: 2.4, pointRadius: 2, pointHoverRadius: 4, order: 0 });
      if ($('showTailLines').checked) {
        add(5, { borderWidth: 1.2, borderDash: [5, 4], order: 1 });
        add(1, { borderWidth: 1.2, borderDash: [2, 4], order: 1 });
      }
    }
    datasets.push({ label: 'Versamenti PAC', data: r.fan.map(f => real ? f.contributed.real : f.contributed.nominal), borderColor: '#9fb0c7', borderDash: [5, 5], borderWidth: 1.3, pointRadius: 0, fill: false, order: 1 });
    chart('fanChart', { type: 'line', data: { labels: r.fan.map(f => `Anno ${f.year}`), datasets }, options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { backgroundColor: '#091423', callbacks: { label: c => `${c.dataset.label}: ${money(c.parsed.y)}` } } }, scales: axes()
    } });
  }

  function drawHistogram(v) {
    const h = E.histogram(v.wealth), r = lastResult;
    const labels = Array.from({ length: h.bins }, (_, i) => i === h.bins - 1
      ? `≥ ${compactCurrency.format(h.min + i * h.width)}`
      : compactCurrency.format(h.min + i * h.width));
    $('histogramNote').textContent = `Tutti gli scenari sono inclusi. Gli intervalli hanno ampiezza ${money(h.width)}; l’ultimo, da ${money(h.min + (h.bins - 1) * h.width)}, è aperto e raccoglie anche la coda superiore.`;
    chart('histogramChart', { type: 'bar', data: { labels, datasets: ['pac', 'pic'].map(strategy => ({
      label: strategy.toUpperCase(), data: h.counts[strategy].map(n => n / r.params.simulations * 100), backgroundColor: `${colors[strategy]}a6`, borderRadius: 2
    })) }, options: {
      responsive: true, maintainAspectRatio: false, scales: axes('percentage'),
      plugins: { legend: { position: 'top', labels: { boxWidth: 12, boxHeight: 3 } }, tooltip: { callbacks: {
        title: items => {
          const i = items[0].dataIndex;
          return i === h.bins - 1 ? `Da ${money(h.min + i * h.width)} in su` : `${money(h.min + i * h.width)} ≤ capitale < ${money(h.min + (i + 1) * h.width)}`;
        }, label: c => `${c.dataset.label}: ${number.format(h.counts[c.dataset.label.toLowerCase()][c.dataIndex])} scenari (${percent(c.parsed.y / 100)})`
      } } }
    } });
  }

  function drawdownSeries() {
    return $('drawdownType').value === 'asset' ? { asset: lastResult.drawdown.asset } : { pac: lastResult.drawdown.pac, pic: lastResult.drawdown.pic };
  }

  function renderDrawdownSummary() {
    const series = drawdownSeries();
    $('drawdownSummary').innerHTML = Object.entries(series).map(([name, values]) => `<div><span>${name === 'asset' ? 'Mercato comune' : name.toUpperCase()} · mediana / P95 / P99</span><strong>${[0.5, 0.95, 0.99].map(q => percent(E.quantile(values, q))).join(' / ')}</strong></div>`).join('');
    $('drawdownNote').textContent = $('drawdownType').value === 'asset'
      ? 'Stesso asset per PAC e PIC: il drawdown senza flussi è comune. Misura il calo nominale dopo TER, prima di imposte e commissioni. P95/P99 sono percentili del massimo drawdown, distinti dal VaR a scadenza.'
      : 'Drawdown del saldo nominale prima delle imposte, con TER e commissioni. I nuovi versamenti possono recuperare parte delle perdite e ridurre il drawdown del PAC. Non misura il solo rischio di mercato.';
    $('drawdownNote').textContent += ' Osservazioni 24 volte l’anno: i minimi tra due date possono essere più profondi.';
  }

  function drawDrawdown() {
    const series = drawdownSeries();
    const labels = Array.from({ length: 25 }, (_, i) => `${i * 4}-${(i + 1) * 4}%`);
    chart('drawdownChart', { type: 'bar', data: { labels, datasets: Object.entries(series).map(([name, values]) => {
      const counts = new Array(25).fill(0);
      for (const v of values) counts[Math.min(24, Math.max(0, Math.floor(v * 25)))]++;
      return { label: name === 'asset' ? 'Mercato comune' : name.toUpperCase(), data: counts.map(n => n / values.length * 100), backgroundColor: `${colors[name]}a0`, borderRadius: 2 };
    }) }, options: {
      responsive: true, maintainAspectRatio: false, scales: axes('percentage'),
      plugins: { legend: { labels: { boxWidth: 12, boxHeight: 3 } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${percent(c.parsed.y / 100)} degli scenari` } } }
    } });
  }

  const tableHeaders = ['Percentile', 'PAC lordo (EUR)', 'PAC netto (EUR)', 'Imposta PAC (EUR)', 'TIR netto PAC (%)', 'PIC lordo (EUR)', 'PIC netto (EUR)', 'Imposta PIC (EUR)', 'CAGR netto PIC (%)', 'Differenza percentili netti PIC-PAC (EUR)'];
  const numericRows = () => tableRows.map(row => row.map((x, i) => x === null ? 'N.D.' : (i === 4 || i === 8 ? x * 100 : x)));

  function exportRows() {
    const r = lastResult, p = r.params, v = E.view(r, mode, real, $('riskReference').value);
    const rows = [['PAC vs PIC - simulazione'], ['Valori monetari', real ? 'Euro di oggi' : 'Nominali'], ['Modalità rischio e grafici', mode], ['Riferimento rischio', $('riskReference').value], ['Tassi dei parametri', 'Decimali annui, salvo dove indicato'], [], ['Parametro', 'Valore']];
    Object.entries(p).forEach(pair => rows.push(pair));
    rows.push([], tableHeaders, ...numericRows(), [], ['Rischio a scadenza', 'PAC (EUR)', 'PIC (EUR)']);
    for (const [label, index, key] of [['VaR95', 0, 'var'], ['ES95', 0, 'es'], ['VaR99', 1, 'var'], ['ES99', 1, 'es']]) rows.push([label, v.tails.pac[index][key], v.tails.pic[index][key]]);
    rows.push(['Riferimento perdita', v.references.pac, v.references.pic], ['Probabilità perdita (%)', v.lossProbability.pac * 100, v.lossProbability.pic * 100], [], ['Sharpe annuo modello', r.moments.sharpe], ['Sharpe semplificato', r.moments.simpleSharpe], ['Rendimento medio annuo dopo TER', r.moments.mean], ['Deviazione standard annua modello', r.moments.standardDeviation]);
    rows.push([], ['Massimo drawdown nominale (%)', 'Mediana', 'P95', 'P99']);
    for (const [name, values] of Object.entries(r.drawdown)) rows.push([name, ...[0.5, 0.95, 0.99].map(q => E.quantile(values, q) * 100)]);
    rows.push([], ['Differenza netta appaiata PIC-PAC (EUR)', 'P5', 'Mediana', 'P95'], ['Stessi percorsi', ...[0.05, 0.5, 0.95].map(q => E.quantile(r.delta.net, q) / v.discount)]);
    return rows;
  }

  function downloadCsv() {
    if (!lastResult) return;
    const escape = value => {
      const s = typeof value === 'number' ? value.toLocaleString('it-IT', { useGrouping: false, maximumFractionDigits: 10 }) : value === null ? 'N.D.' : String(value);
      return /[;"\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
    };
    const csv = '\uFEFF' + exportRows().map(row => row.map(escape).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `PAC-PIC_seed-${lastResult.params.seed}_${real ? 'reale' : 'nominale'}.csv`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  form.addEventListener('submit', event => { event.preventDefault(); calculate(); });
  form.addEventListener('input', () => { error(''); syncParameters(); });
  form.addEventListener('change', syncParameters);
  $('cancelButton').addEventListener('click', () => {
    jobId++;
    if (worker) { worker.terminate(); worker = null; }
    setBusy(false);
    $('calculationStatus').textContent = 'Calcolo annullato. Gli eventuali risultati precedenti restano visibili.';
    syncParameters();
  });
  $('resetButton').addEventListener('click', () => {
    if (busy) $('cancelButton').click();
    form.reset(); error(''); syncParameters(); calculate();
  });
  $('newSeedButton').addEventListener('click', () => {
    const seed = new Uint32Array(1);
    window.crypto.getRandomValues(seed);
    $('seed').value = seed[0];
    syncParameters();
  });
  for (const [id, value] of [['grossButton', 'gross'], ['netButton', 'net']]) {
    $(id).addEventListener('click', () => {
      mode = value;
      for (const [button, active] of [[$('grossButton'), mode === 'gross'], [$('netButton'), mode === 'net']]) {
        button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
      }
      render();
    });
  }
  $('realTerms').addEventListener('change', () => { real = $('realTerms').checked; render(); });
  $('riskReference').addEventListener('change', () => { if (lastResult) renderRisk(E.view(lastResult, mode, real, $('riskReference').value)); });
  $('showTailLines').addEventListener('change', () => { if (lastResult && window.Chart) drawFan(); });
  $('drawdownType').addEventListener('change', () => { if (lastResult) { renderDrawdownSummary(); if (window.Chart) drawDrawdown(); } });
  $('csvButton').addEventListener('click', downloadCsv);
  $('copyButton').addEventListener('click', async () => {
    if (!lastResult) return;
    const text = [tableHeaders, ...numericRows()].map(row => row.map(x => typeof x === 'number' ? x.toLocaleString('it-IT', { useGrouping: false, maximumFractionDigits: 8 }) : String(x)).join('\t')).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      $('copyButton').textContent = 'Copiata';
      setTimeout(() => { $('copyButton').textContent = 'Copia tabella'; }, 1800);
    } catch { $('calculationStatus').textContent = 'Copia non disponibile in questo browser. Puoi usare Scarica CSV.'; }
  });
  $('guideButton').addEventListener('click', () => $('guideDialog').showModal());
  $('closeGuideButton').addEventListener('click', () => $('guideDialog').close());
  $('guideDialog').addEventListener('click', event => {
    const rect = $('guideDialog').getBoundingClientRect();
    if (event.target === $('guideDialog') && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) $('guideDialog').close();
  });
  syncParameters();
  calculate();
})();
