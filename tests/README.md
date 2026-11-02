# Verifiche

## Motore finanziario

Con Node.js 22 o successivo, dalla radice del progetto:

```sh
node --test tests/engine.test.cjs
```

Non sono necessarie dipendenze npm. I confronti Monte Carlo usano seed fissi, campioni dichiarati e tolleranze statistiche; non si pretende che una media campionaria coincida esattamente con quella teorica.

## Interfaccia nel browser

Con un server statico che espone la cartella del progetto:

1. Aprire la pagina su desktop e telefono; attendere lo stato “Completato”. Verificare grafici, tabella e assenza di scorrimento orizzontale della pagina. Le tabelle scorrono nel proprio riquadro.
2. Cambiare rendimento, volatilità, TER, inflazione, frequenza dei salti e salto medio a zero. Dopo il calcolo, gli zeri devono essere mantenuti. Con RF zero, rendimento zero, nessun salto e nessun costo: PAC e PIC devono risultare in parità.
3. Verificare il segnale di risultati da aggiornare dopo una modifica. Al termine di un calcolo il segnale deve sparire solo se i parametri attuali coincidono con quelli calcolati.
4. Cambiare lordo/netto, euro di oggi, riferimento del rischio e tipo di drawdown: il seed e il campione non devono essere rigenerati. Dopo aver spento i salti e ricalcolato, il confronto degli Sharpe deve conservare i parametri dei salti. Con i default: ipotesi 0,250, senza salti 0,221, con salti 0,193. Provare rendimento 9%, volatilità 20%, RF 3%: lo Sharpe delle ipotesi deve diventare 0,300 senza modificare gli input.
5. Mostrare P1/P5, mantenendo P10/P90 e P25/P75. Controllare le etichette dei grafici e dei riferimenti di perdita.
6. Aprire/chiudere la guida, anche con Escape; usare Tab per raggiungere controlli e tabelle. Verificare il focus e le etichette.
7. Verificare l’avvertenza sempre visibile e l’apertura delle avvertenze complete dal collegamento in alto. Scaricare il CSV e controllare la presenza di ipotesi, seed, nove righe di percentili, VaR/ES, tutti e tre gli Sharpe, drawdown e avvertenze. Il file ha BOM UTF-8, separatore `;` e virgola decimale.
8. Provare un input vuoto, una durata oltre 40 anni, tutti i versamenti a zero e una rata inferiore alla commissione. Devono comparire errori, senza numeri non finiti in tabella.
9. Iniziare un calcolo lungo e annullarlo: il worker deve terminare e la pagina restare utilizzabile. I risultati precedenti devono restare identificabili come precedenti.
10. Scaricare tutto il progetto e aprire `index.html` direttamente: statistiche e grafici devono funzionare anche senza rete; la modalità senza worker può occupare la pagina durante il calcolo.

Per una verifica automatica dell'interfaccia è incluso `tests/browser-smoke.cjs`, che richiede Playwright già disponibile nell'ambiente e un Chromium. La libreria non è necessaria al simulatore. Senza un URL esterno, il test avvia un proprio server statico locale temporaneo. Genera screenshot fuori dal progetto e verifica anche apertura offline e annullamento del worker.

```sh
node tests/browser-smoke.cjs
```

Il test accetta `PAC_PIC_URL` (server già attivo), `PLAYWRIGHT_MODULE` (percorso al modulo), `CHROMIUM_PATH` (browser già installato) e `QA_OUTPUT` (cartella degli screenshot). Con `SAVE_README_PREVIEW=1` aggiorna anche l'immagine di anteprima della documentazione.
