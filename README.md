# 📈 PAC vs PIC Monte Carlo Quant Simulator

Un simulatore quantitativo stocastico avanzato per l'analisi e il confronto testa a testa tra **Piano di Accumulo del Capitale (PAC / Dollar-Cost Averaging)** e **Piano di Investimento del Capitale (PIC / Lump-Sum)** su asset azionari globali (*MSCI World*).

L'applicazione viene eseguita **al 100% lato client** nel browser tramite JavaScript ottimizzato con `TypedArrays` (nessuna dipendenza server, calcolo istantaneo) ed è ospitata gratuitamente su GitHub Pages.

---

## 🔬 Caratteristiche e Motore Quantitativo

### 1. Confronto Equo a Parità di Valore Attuale ($PV$)
A differenza dei simulatori convenzionali che confrontano la semplice somma algebrica nominale dei versamenti PAC con un PIC di pari importo (trascurando il valore temporale del denaro), questo motore calcola il capitale di partenza del PIC attualizzando i flussi futuri del PAC al tasso privo di rischio ($r_f$):

```math
PV = S_0 + \sum_{k=1}^{N} \frac{C}{\left(1 + \frac{r_f}{m}\right)^k}
```

*Se $r_f = 0\%$, il PIC utilizza la somma nominale totale non attualizzata.*

---

### 2. Merton Jump Diffusion con Compensazione di Martingala
I mercati azionari reali presentano code spesse (*fat tails*) e asimmetria negativa (rischio di crolli repentini). L'algoritmo integra un processo di Poisson per simulare crolli improvvisi e applica la **compensazione di Merton sul drift** per evitare che la presenza dei salti decurti artificiosamente il rendimento geometrico medio impostato:

```math
S(t + \Delta t) = S(t) \cdot \exp\left[ \left(\mu - \text{TER} - \lambda \mathbb{E}[J] - \frac{1}{2}\sigma^2\right)\Delta t + \sigma\sqrt{\Delta t}\,Z \right] \cdot \left(1 + J \cdot N_{\text{jump}}\right)
```

dove $Z \sim \mathcal{N}(0, 1)$ è generata con trasformata di Box-Muller e $N_{\text{jump}} \sim \text{Poisson}(\lambda \Delta t)$.

---

### 3. Coni di Ibbotson a Stratificazione Multipla
Il grafico temporale disegna due fasce di dispersione concentriche a gradiente cromatico:
* **Fascia Esterna (P10 - P90):** confidenza all'80% per quantificare gli scenari estremi (favorevoli e sfavorevoli).
* **Cuore Interquartilico (P25 - P75):** dispersione centrale (50% dei casi più probabili).
* **Traiettoria Mediana (P50):** linea di tendenza geometrica centrale per entrambe le strategie.

---

### 4. Tasso Interno di Rendimento (MWRR / TIR) Esatto
Per il PAC, il semplice CAGR finale è finanziariamente scorretto perché i flussi di cassa entrano a intervalli temporali diversi. Il motore integra un solutore a bisezione numerica che risolve l'equazione di equivalenza finanziaria attualizzando ogni singolo versamento:

```math
V_{\text{finale}} = S_0 (1 + r)^T + \sum_{k=1}^N C_k (1 + r)^{T - t_k}
```

---

### 5. Fiscalità Italiana Integrale (26% Art. 67 TUIR) & Inflazione
* **Imposta Capital Gain:** Aliquota del 26% applicata sul differenziale positivo tra capitale finale e costo fiscale di carico nominale.
* **Potere d'Acquisto Reale:** Opzione per convertire tutte le grandezze monetarie a valori costanti dell'anno zero tramite la relazione di Fisher:

```math
1 + r_{\text{reale}} = \frac{1 + r_{\text{nominale}}}{1 + \pi}
```

Tutte le colonne della tabella (Lordo, Netto, Imposta) mantengono rigorosamente l'identità contabile: $\text{Lordo} - \text{Imposta} = \text{Netto}$.

---

### 6. Analisi del Rischio: Maximum Drawdown (MDD)
Tracciamento lungo le 10.000 simulazioni del massimo calo percentuale subito dal picco di periodo per quantificare l'impatto del rischio di sequenza dei rendimenti (*Sequence of Returns Risk*).

---

## 🛠️ Stack Tecnologico

* **Frontend:** HTML5 semantico, TailwindCSS (Dark Fintech UI), Canvas API.
* **Rendering Matematico:** KaTeX CDN per la visualizzazione delle formule all'interno dell'app e blocchi math per GitHub.
* **Engine Grafico:** Chart.js 4.x con configurazione di fill a cascata.
* **Performance:** Vettorizzazione matematica tramite `Float32Array` in memoria (10.000 simulazioni a 180 step calcolate in ~40–60 ms).
* **Hosting:** GitHub Pages (Static Web Hosting a costo zero).

---

## 📚 Riferimenti Bibliografici

1. **Constantinides, G. M. (1979).** *A Note on the Suboptimality of Dollar-Cost Averaging as an Investment Policy*. Journal of Financial and Quantitative Analysis, 14(2), 443–450.
2. **Wallick, D. W., Shanahan, A. R., Tasopoulos, P., & Yoon, J. (2012).** *Dollar-cost averaging just means taking risk later*. Vanguard Research.
3. **Statman, M. (1995).** *A Behavioral Framework for Dollar-Cost Averaging*. The Journal of Portfolio Management, 22(1), 70–78.
4. **Ayres, I., & Nalebuff, B. (2010).** *Life-Cycle Investing and Leverage: Buying Stock on Margin Can Reduce Retirement Risk*. Yale University Working Paper.
5. **Merton, R. C. (1976).** *Option pricing when underlying stock returns are discontinuous*. Journal of Financial Economics, 3(1-2), 125–144.

---

## ⚖️ Disclaimer
*Questo simulatore ha finalità esclusivamente didattiche, quantitative e di modellazione stocastica. Non costituisce sollecitazione al pubblico risparmio né consulenza finanziaria ai sensi del D.Lgs. 58/1998 (TUF).*
