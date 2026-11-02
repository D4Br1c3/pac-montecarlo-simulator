# Revisione del simulatore

La revisione parte dalla versione `80a44222714a55b7d6e74d8e304e44a22127c3b9` del 30 ottobre 2026. Mantiene la scelta di un confronto a pari valore attuale tra risparmio periodico e investimento iniziale equivalente.

| Area | Problema rilevato | Comportamento aggiornato |
| --- | --- | --- |
| Date dei flussi | Il PAC versava a inizio periodo, ma il PIC scontava rate a fine periodo. | Selettore inizio/fine, con date identiche in simulazione, PV e TIR. Predefinito fine periodo. |
| Convenzione RF | Il RF veniva diviso per la frequenza senza spiegare che ciò implicava un tasso nominale convertibile. | RF annuo effettivo, equivalente per periodo tramite capitalizzazione composta. |
| Rendimento atteso | L'input percentuale era usato direttamente come drift continuo, dando una media annua `exp(mu)−1`, non `mu`. | Input come rendimento annuo aritmetico effettivo; drift convertito con `log1p`. |
| Salti | La probabilità Bernoulli permetteva al massimo un salto per periodo. Il moltiplicatore normale veniva tagliato arbitrariamente. La descrizione di Merton non coincideva pienamente con l'implementazione. | Poisson composto, più salti per intervallo, moltiplicatori lognormali positivi, compensazione coerente della media. |
| Sharpe | Il rapporto non era mostrato e la volatilità di base non comprendeva i salti. | Sharpe semplificato degli input e Sharpe annuo completo calcolato dai momenti del modello. |
| Input zero | L'uso di `valore || default` sostituiva alcuni zeri con valori predefiniti. | Lettura numerica esplicita, limiti validati e zero ammesso dove previsto. |
| Commissioni | La stima contava anche ordini su versamenti zero; versamenti inferiori alla commissione venivano azzerati silenziosamente. | Solo ordini finanziati, costo incluso nel versamento, controllo degli ordini insufficienti. |
| TIR | L'intervallo inferiore di ricerca non copriva l'intero dominio delle perdite annue. Non venivano distinti i casi senza soluzione. | Ricerca nel log-tasso, intervallo adattivo, N.D. quando non esiste un TIR finito. |
| Inflazione | Il totale dei versamenti, il PV e i capitali finali potevano essere deflazionati tutti a scadenza, mescolando date diverse. | Capitali a scadenza deflazionati a scadenza; ogni versamento deflazionato alla sua data; il PV iniziale è già in euro iniziali. |
| Istogramma finale | Bin derivati dal lordo ma conteggi sul netto; omissione dei valori fuori range; vista lordo/netto incoerente. | Serie coerente con la vista, tutti gli scenari inclusi e intervallo finale aperto etichettato. |
| Drawdown | Il calo del saldo PAC risentiva dei nuovi versamenti; la frequenza di osservazione variava con quella delle rate. | Serie asset senza flussi e saldi separati; griglia comune di 24 osservazioni/anno. |
| Code | P99,9 del drawdown poteva sembrare una perdita estrema universalmente significativa. Non c'era VaR del capitale finale. | VaR/ES 95/99 a scadenza, due riferimenti di perdita, P95/P99 del MDD distinti e campione di coda dichiarato. |
| Confronto | “PAC vince = 100% − PIC vince” attribuiva al PAC tutte le parità. | Conteggio separato di vittorie PAC, PIC e parità. |
| Percentili | Il delta fra percentili marginali poteva essere letto come differenza nello stesso scenario. | Etichetta esplicita e statistiche aggiuntive della differenza appaiata. |
| Ripetibilità | Ogni visualizzazione poteva ridisegnare un nuovo campione, confondendo confronto e rumore. | Seed esplicito, cambio vista senza ricalcolo, avviso di risultati da aggiornare. |
| Fiscalità | Il testo dichiarava una fiscalità “integrale” e un riferimento normativo generico. | Modello semplificato e aliquota modificabile, con esclusioni dichiarate e costo fiscale coerente. |
| Architettura | Un solo HTML di oltre mille righe mescolava calcoli, interfaccia e dipendenze remote. | Motore puro testabile, interfaccia e CSS separati, worker, Chart.js locale con licenza. |
| Istruzioni | La guida iniziava da formule e termini specialistici. | Avvio in tre passi, esempio numerico, glossario, aiuto nell'app e metodologia tecnica separata. |

## Verifiche

La suite `node --test tests/engine.test.cjs` copre date, attualizzazione, capitalizzazione, TIR, imposte, inflazione, code, frequenze, zeri e ripetibilità. Include confronti con i momenti esatti del modello di Merton e i quantili analitici del GBM.

La verifica dell'interfaccia e i relativi comandi sono descritti in [tests/README.md](../tests/README.md). I test campionari non validano la calibrazione delle ipotesi rispetto al mercato reale.
