# Metodologia del simulatore PAC vs PIC

Questa pagina documenta il modello implementato in `engine.js`. Le ipotesi iniziali non sono una calibrazione storica né una previsione sull'MSCI World. Rendimento, volatilità e RF restano input indipendenti: il default 6,25% / 15% / 2,5% implica uno Sharpe base di 0,25, senza bloccare le scelte dell’utente.

## 1. Flussi e tassi

Siano `S0` il versamento iniziale PAC, `C` la rata, `m` il numero di rate annue e `T` gli anni. Le date sono:

- Fine periodo, impostazione iniziale: `t_k = k/m`, per `k = 1, ..., mT`.
- Inizio periodo: `t_k = k/m`, per `k = 0, ..., mT−1`.

Il capitale iniziale PIC è:

```math
PV = S_0 + \sum_k C(1+r_f)^{-t_k}.
```

Il RF è **annuo effettivo**, quindi il tasso equivalente per periodo è `(1+RF)^(1/m)−1`, non `RF/m`. Sono ammessi anche RF zero e negativi entro i limiti dell'interfaccia.

Il confronto uguaglia il valore attuale dei flussi. Non modella la capacità di anticipare il risparmio futuro, il costo di un prestito o una riserva di liquidità. Il RF è un'ipotesi costante, non il prezzo osservato di un prodotto o una curva dei tassi.

Anche il rendimento atteso in input, `a`, è un tasso annuo **effettivo aritmetico**, non un CAGR atteso né il drift logaritmico. `sigma` è invece il coefficiente di diffusione annualizzato della componente browniana. La sua corrispondenza alla deviazione standard del rendimento annuo semplice è solo approssimata.

## 2. Processo dei rendimenti

La griglia di simulazione ha 24 intervalli per anno, indipendentemente dalla frequenza dei versamenti. Le date trimestrali, mensili e due volte al mese coincidono con la griglia. Il conteggio `N` dei salti nell'intervallo segue una Poisson di parametro `lambda × dt`: sono possibili più salti nello stesso intervallo.

Il moltiplicatore di ciascun salto è `F = exp(Y)`, con:

```math
Y \sim \mathcal{N}(\eta,\delta^2),\qquad
\eta=\ln(1+j)-\frac{\delta^2}{2},\qquad
E[F-1]=j.
```

`j` è il salto medio percentuale impostato dall'utente. `delta = 0,05` è la deviazione standard del **log-moltiplicatore**, fissata e documentata; non significa cinque punti percentuali di deviazione standard del salto semplice. La frequenza iniziale è `lambda = 0,2` all'anno e il salto medio è `j = −18%`. I salti sono moltiplicativi e mantengono il capitale positivo, senza soglie arbitrarie sul crollo.

Il fattore di crescita sull'intervallo è:

```math
G_{t,t+\Delta t}=
\exp\left[
\left(g-\lambda j-\frac{\sigma^2}{2}\right)\Delta t
+\sigma\sqrt{\Delta t}Z
+\sum_{i=1}^{N}Y_i
\right],\qquad
g=\ln(1+a)-c,
```

con `Z` normale standard indipendente dai salti e `c` TER annuo, applicato come costo proporzionale continuo. Condizionatamente a `N`, la somma dei log-salti è normale di media `N × eta` e deviazione standard `sqrt(N) × delta`: il codice campiona direttamente questa somma.

La compensazione `−lambda × j` conserva la crescita **aritmetica attesa**, non la mediana o la crescita geometrica:

```math
E[G_{t,t+h}]=e^{gh}.
```

Senza TER, il rendimento annuo semplice atteso è esattamente `a`. Dopo TER è `(1+a) exp(−c)−1`. Disattivando i salti o impostando `lambda = 0`, il processo diventa un GBM. Non viene sostituito il rendimento atteso con il RF: il modello opera sulle ipotesi di rendimento dell'utente, non in misura neutrale al rischio.

PAC e PIC ricevono **lo stesso fattore G a ogni data in ogni scenario**. Non si confrontano estrazioni di mercato indipendenti. Le rate entrano esattamente alle date usate per il PV e per il TIR.

Il generatore è Mulberry32 con seed intero a 32 bit; le normali usano Box-Muller con riuso della seconda estrazione. La Poisson usa l'algoritmo moltiplicativo di Knuth, adatto al piccolo parametro per intervallo. Non è un generatore crittografico. La ripetibilità vale per la stessa versione del motore e gli stessi parametri, salvo minime differenze floating point tra runtime.

## 3. Sharpe annuo implicito

Il rapporto approssimato degli input è:

```math
S_{\mathrm{base}}=\frac{a-r_f}{\sigma}.
```

Viene chiamato **Sharpe semplificato**: non incorpora TER e salti, e approssima la deviazione standard annua con il coefficiente di diffusione.

Per il modello completo si utilizzano i momenti del rendimento semplice a un anno. Posto:

```math
v=\sigma^2+\lambda E[(F-1)^2],\qquad
E[(F-1)^2]=(1+j)^2e^{\delta^2}-2(1+j)+1,
```

si ottiene:

```math
E[R_1]=e^g-1,\qquad
\operatorname{SD}(R_1)=e^g\sqrt{e^v-1},\qquad
S_{\mathrm{modello}}=\frac{e^g-1-r_f}{e^g\sqrt{e^v-1}}.
```

Queste espressioni derivano dai primi due momenti del processo composto: `E[G²] = exp(2g+v)`. Il RF è deterministico e annuo effettivo; quindi sottrarlo non modifica la varianza.

Con gli input iniziali, lo Sharpe base è 0,25. Dopo TER, lo Sharpe del modello senza salti è 0,221169 e quello con salti è 0,193426. La media annua dopo TER è 6,037712%; la deviazione standard annua è 15,995547% senza salti e 18,289764% con salti. La metrica riguarda l'asset, **prima di commissioni fisse e imposte**, non il TIR del PAC. Resta nominale anche quando gli importi sono espressi in euro di oggi. Se la deviazione standard è zero, il rapporto non è definito e viene mostrato N.D.

L’interfaccia mostra sempre il rapporto degli input e i due scenari del modello, evidenziando quello attivo. Il flag dei salti cambia soltanto il processo simulato: non cancella frequenza o intensità impostate e non modifica rendimento e volatilità scelti dall’utente. I valori di confronto sono analitici, non stime rumorose dello Sharpe da un campione Monte Carlo. Lo Sharpe 0,25 è una scelta didattica iniziale; non viene presentato come un dato universale stabilito dalla letteratura.

## 4. Commissioni e imposta

Il costo annuo può descrivere un **ETF / Fondo comune**, usando TER o oneri correnti senza duplicare costi già inclusi. L’ipotesi di rendimento deve essere prima di questi oneri. Costi di ingresso/uscita percentuali, commissioni di performance e classi di quote specifiche non sono modellati.

Ogni importo è l'esborso totale dell'investitore, **commissione di acquisto inclusa**. Il capitale che entra nell'asset è `versamento − commissione`. Non si addebitano ordini su versamenti zero. Se una rata positiva non supera la commissione, l'app rifiuta i parametri. Un versamento iniziale e una rata anticipata al tempo zero restano due ordini distinti.

I costi fiscali di riferimento del modello sono:

- PAC: `B_PAC = S0 + mT × C`.
- PIC: `B_PIC = PV`.

Si assume che le commissioni di acquisto siano comprese nel costo fiscale. Il TER è già incorporato nel valore dell'asset, senza un secondo addebito finale.

Per una liquidazione di valore nominale `V`:

```math
Tax=\tau\max(V-B,0),\qquad V_{net}=V-Tax.
```

`tau` è inizialmente 26%, modificabile. Il modello non ricostruisce la fiscalità italiana integrale: esclude bollo, distribuzioni, imposte anticipate, crediti per minusvalenze, aliquote differenziate tra strumenti e commissioni di vendita. In perdita non si riconosce alcun rimborso d'imposta.

Le curve nette sono **liquidazioni ipotetiche** a ciascuna data, usando il costo fiscale accumulato fino a quel momento. Non si vende realmente ogni anno: la traiettoria sottostante continua al lordo dell'imposta fino alla scadenza.

## 5. Euro nominali ed euro di oggi

Con inflazione annua effettiva costante `pi`, il capitale finale in euro iniziali è `V_T / (1+pi)^T`. Imposta e lordo sono deflazionati con lo stesso fattore, preservando l'identità lordo − imposta = netto.

Il riferimento dei versamenti in potere d'acquisto iniziale è invece:

```math
B_{PAC,reale}=S_0+\sum_k\frac{C}{(1+\pi)^{t_k}},\qquad B_{PIC,reale}=PV.
```

Non si divide il totale dei versamenti nominali per l'inflazione a scadenza: ogni esborso è riportato al valore reale della propria data. La linea dei versamenti nel cono usa la stessa convenzione.

Per i rendimenti annualizzati:

```math
1+r_{reale}=\frac{1+r_{nominale}}{1+\pi}.
```

Questa relazione è coerente con il TIR dei flussi deflazionati individualmente. L'imposta viene sempre calcolata prima su valori nominali.

## 6. TIR, CAGR e percentili

Il TIR PAC netto annuo effettivo risolve:

```math
V_{net,T}=\sum_i C_i(1+r)^{T-t_i},
```

dove tra i flussi è incluso il versamento iniziale e tutte le rate, commissioni comprese. Si risolve per bisezione in `x = log(1+r)`, con espansione dell'intervallo. Ciò ammette l'intero dominio `r > −100%`, evitando limiti arbitrari sulle perdite annue.

Con soli esborsi positivi e un incasso finale, il valore futuro è monotono nel tasso e il TIR è unico quando esiste. Se l'incasso finale non supera un esborso simultaneo alla scadenza, può non esistere un TIR finito; in questo caso si mostra **N.D.**. Anche un valore finale nullo non viene arbitrariamente trasformato in un tasso calcolabile.

Il CAGR PIC è `(V_net / PV)^(1/T)−1`. Il denominatore è l'esborso iniziale completo, comprendente la commissione.

Le tabelle e i coni usano quantili interpolati lineari di tipo 7: ordinato un campione di `n` valori, il quantile a probabilità `q` interpola tra gli indici intorno a `(n−1)q`. Per i coni netti, l'imposta viene applicata agli estremi dell'interpolazione. La tabella finale applica la liquidazione al percentile lordo, garantendo la quadratura contabile: in presenza del punto di discontinuità della derivata fiscale, questa convenzione può differire lievemente dal percentile del campione netto interpolato.

La mediana TIR è ricavata dal capitale netto mediano, mantenendo gli stessi flussi deterministici. La tabella include P1, P5, P10, P25, P50, P75, P90, P95 e P99. Le fasce dei coni sono **puntuali per data**, non intervalli di confidenza sui parametri né bande simultanee di un intero percorso.

## 7. VaR ed Expected Shortfall

L'orizzonte del rischio coincide con `T`, non con un giorno o un anno standard. Si usa il capitale finale lordo o netto a seconda della vista. Il riferimento è selezionabile.

### Capitale versato

```math
L=B-V_T.
```

In nominale, `B` è il totale esborsi PAC oppure il PV iniziale PIC. In euro di oggi, `B` è il valore reale dei versamenti descritto sopra e `V_T` è deflazionato. Per questa ragione la probabilità di perdita reale può differire dalla probabilità di perdita nominale.

Le percentuali di perdita hanno come denominatore il riferimento della **singola** strategia. A pari PV i due riferimenti nominali non sono necessariamente uguali: le perdite sui versamenti misurano due budget nominali diversi.

### Alternativa al tasso RF

Il valore finale lordo del benchmark è uguale per le due strategie:

```math
V_{RF}=PV(1+r_f)^T=S_0(1+r_f)^T+\sum_k C(1+r_f)^{T-t_k}.
```

In vista netta, il benchmark applica la stessa formula di imposta e il rispettivo costo fiscale PAC/PIC: i riferimenti netti possono quindi differire. Il benchmark non applica TER e commissioni, ed è una crescita teorica priva di volatilità. In euro di oggi sia benchmark sia capitale sono deflazionati a scadenza.

In entrambi i casi si stima:

```math
VaR_\alpha=Q_\alpha(L)=B-Q_{1-\alpha}(V_T),
```

con `alpha = 95%` o `99%`. Il VaR impiega il quantile campionario lineare. L'ES è stimato come media delle perdite nel peggior `(1−alpha)` del campione: si usa un numero frazionario di osservazioni con peso residuo quando necessario. È la media della coda empirica, distinta dalla convenzione di interpolazione del quantile.

Un valore positivo indica una perdita rispetto al riferimento; un valore negativo è mantenuto e indica un guadagno, senza tagliare il VaR a zero. ES non è la media dei capitali, ma la media delle **perdite** di coda. Il VaR non limita la perdita massima possibile e non descrive la profondità della coda oltre la soglia.

Con 10.000 scenari, la coda 99% contiene circa 100 osservazioni. Le stime non sono probabilità “vere” del mercato: sono stime campionarie condizionate al modello. La medesima limitazione vale per le probabilità di vittoria e perdita.

## 8. Drawdown

Il drawdown positivo di una serie `X` è:

```math
DD_t=1-\frac{X_t}{\max_{s\le t} X_s},\qquad MDD=\max_t DD_t.
```

Si mantiene una serie di quote dell'asset, indipendente dai versamenti, inizializzata a 1. Il suo MDD nominale dopo TER è comune a entrambe le strategie e isola il rischio di mercato. Non si attribuisce al PAC uno Sharpe o un drawdown di mercato inferiore solo perché riceve nuove rate.

Si calcola anche il MDD dei saldi nominali. Il calo è osservato prima di ogni nuova rata; i picchi sono aggiornati anche dopo la rata. Le iniezioni di capitale possono contribuire a recuperare i cali precedenti. Le commissioni iniziali non sono un drawdown dal capitale preacquisto: la serie parte dal saldo investito dopo gli ordini al tempo zero.

La griglia è fissa a 24 osservazioni annue. È una misura discreta, non il massimo drawdown intraperiodale o continuo. Può sottostimare i cali avvenuti tra osservazioni. I percentili P95/P99 della distribuzione di MDD sono mostrati come tali, non come VaR del capitale finale.

## 9. Grafici, confronti e conservazione dei dati

L'istogramma finale usa la vista selezionata: lordo/netto e nominale/reale. I bin ordinari hanno ampiezza uniforme; l'ultimo è dichiaratamente aperto, con soglia prossima al più alto P99 delle strategie. I valori estremi non vengono scartati: i conteggi sommano sempre al numero di simulazioni. Nei casi senza dispersione si usa comunque un'ampiezza positiva.

L'istogramma del MDD copre 0-100% con intervalli di 4 punti. Si usano barre di frequenza, senza suggerire una densità continua con linee smussate.

La probabilità di vittoria usa confronti **appaiati**: PIC e PAC dello stesso mercato simulato. Le parità numeriche, con tolleranza relativa `1e−8` sul budget, sono riportate separatamente. Viene conservata anche la distribuzione appaiata `PIC − PAC`, lorda e netta. Una differenza fra percentili marginali è una statistica diversa e non viene presentata come vantaggio di uno stesso scenario.

Cambiare vista non rigenera i numeri casuali. Le modifiche dei parametri richiedono un nuovo calcolo e sono segnalate dall'interfaccia.

## 10. Limiti e fonti

Il modello non include volatilità stocastica, regimi, autocorrelazione, dipendenze tra asset, cambi, distribuzioni, bollo o vincoli di finanziamento. I parametri dei salti non sono calibrati a dati reali. Più simulazioni riducono il rumore Monte Carlo, non gli errori di specificazione.

Fonti primarie consultate:

1. Sharpe, W. F. (1994), [The Sharpe Ratio](https://web.stanford.edu/~wfsharpe/art/sr/sr.htm).
2. Basel Committee, [Market risk terminology, §§10.17-10.18](https://www.bis.org/committees/bcbs/basel-framework/standard/mar/10/inforce/2022-01-01/published/2019-12-15). Sono utilizzate le definizioni generali, non le regole di capitale regolamentare.
3. MathWorks, [Merton jump diffusion model](https://www.mathworks.com/help/finance/merton.html), per convenzioni sul processo di Poisson e sui salti lognormali.
4. Finlay, M. e Zorn, J. (2023), Vanguard, [Cost averaging: Invest now or temporarily hold your cash?](https://corporate.vanguard.com/content/dam/corp/research/pdf/cost_averaging_invest_now_or_temporarily_hold_your_cash.pdf). Riguarda l'ingresso graduale con capitale già disponibile, un problema diverso da quello implementato qui.

Le formule dei momenti e gli adattamenti a flussi, imposte e inflazione sono derivazioni del modello specifico documentate e verificate nei test, non risultati empirici attribuiti alle fonti.
