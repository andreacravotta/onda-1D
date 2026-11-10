# Simulazione Meccanica d'Onda 1D: Ritardo Temporale $y(x,t) = y(0, t - x/v)$

Simulatore fisico interattivo per visualizzare e verificare sperimentalmente che l'oscillazione di una particella della corda a distanza $x$ è la replica esatta dell'oscillazione della sorgente a $x=0$, ritardata nel tempo dell'intervallo $\Delta t = x / v$.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> Decisioni confermate dall'utente nella fase di allineamento:
> - **Contenitore dell'applicazione**: Esecuzione diretta e reattiva all'interno della web app, con rendering su HTML5 Canvas gestito con precisione a 60 FPS.
> - **Dotazione controlli**: Inclusione rigorosa dei controlli didattici essenziali richiesti (Impulso Asimmetrico, Onda Sinusoidale continua, slider di velocità di propagazione $v$, pulsante Pausa/Play e slider selettore della posizione $X$).

---

## 1. Panoramica & Concetto Didattico

### Cosa fa l'applicazione
L'applicazione fornisce agli studenti e ai docenti di fisica uno strumento visivo ad alta precisione per comprendere l'equazione fondamentale delle onde progressive unidimensionali:
$$y(x, t) = y\left(0, t - \frac{x}{v}\right)$$

La simulazione connette istantaneamente la dimensione spaziale (lungo la corda) e la dimensione temporale (due grafici $y-t$ sincroni ad oscilloscopio):
1. **Vista Spaziale (La Corda)**: Un treno discreto di particelle collegate. La sorgente ($x=0$) è colorata in rosso corallo vibrante. Una particella bersaglio a coordinata $x$ è evidenziata in blu ciano con una finestra di osservazione trasparente.
2. **Vista Temporale Sorgente $y_0(t)$ (Grafico Rosso)**: Traccia in tempo reale lo spostamento verticale della particella a $x=0$.
3. **Vista Temporale Particella Selezionata $y_x(t)$ (Grafico Blu)**: Traccia in tempo reale lo spostamento della particella a distanza $x$, evidenziando visivamente la traslazione temporale verso destra del segnale.
4. **Allineamento a Griglia**: La griglia cartesiana calibrata e le linee guida verticali rendono tangibile il conteggio dei quadretti corrispondente al ritardo $\Delta t = x/v$.

---

## 2. Esperienza Utente & Design Visivo

### Layout e Gerarchia Visiva
Seguendo le linee guida per le simulazioni scientifiche didattiche, l'interfaccia adotta un'estetica tecnica minimale e pulita (sfondo bianco/grigio perla `#F8FAFC`, assi grafici netti in grigio ardesia `#334155`, senza elementi superflui o decorazioni rumorose):

1. **Testata Scientifica (Header)**:
   - Titolo chiaro dell'esperimento: *Propagazione di un'Onda Meccanica 1D*.
   - Scheda formula didattica in primo piano: $y(x,t) = y(0,\, t - x/v)$.

2. **Stage Principale: Vista Spaziale della Corda**:
   - Canvas ad alta risoluzione con asse di riposo orizzontale tratteggiato.
   - Particelle sferiche discrete collegate da filamento elastico teso.
   - Sorgente a $x=0$ evidenziata in rosso vivo (`#DC2626`).
   - Selettore mobile della particella $x$ evidenziata in blu cobalto (`#2563EB`) all'interno di una finestra traslucida (`rgba(37, 99, 235, 0.12)`).
   - Lettura telemetrica sotto il canvas con valori numerici tabulari:
     - Distanza selezionata $X$ (es. $4.50\text{ m}$)
     - Velocità d'onda $v$ (es. $2.00\text{ m/s}$)
     - Ritardo teorico calcolato $\Delta t = X / v$ (es. $2.25\text{ s}$).

3. **Doppio Oscilloscopio Temporale ($y-t$) Allineato**:
   - Due grafici cartesiani sovrapposti con la medesima scala temporale su asse orizzontale (da $t - T_{\text{window}}$ a $t$).
   - **Grafico Superiore (Sorgente $x=0$)**: Traccia continua rossa con marker istantaneo sul fronte temporale corrente.
   - **Grafico Inferiore (Particella $x$)**: Traccia continua blu identica nella forma d'onda, ma ritardata esattamente di $\Delta t$.
   - Marcatori di ritardo con freccia di offset $\Delta t$ ben visibile e griglia coerente per la misurazione didattica dei quadretti.

4. **Pannello Controlli Unificato**:
   - **Invia Impulso Asimmetrico**: Genera una perturbazione con rampa di salita dolce e discesa rapida. In questo modo gli studenti notano subito l'orientamento della cresta nello spazio rispetto al tempo (nello spazio la salita dolce è a destra, nel tempo è a sinistra!).
   - **Genera Onda Sinusoidale**: Attiva/disattiva un oscillatore armonico continuo alla sorgente.
   - **Slider Velocità di propagazione ($v$)**: Varia istantaneamente $v$ da $1.0\text{ m/s}$ a $5.0\text{ m/s}$, aggiornando la dilatazione spaziale della forma d'onda e riducendo $\Delta t$.
   - **Slider Selettore Posizione $X$**: Trascina fluidamente la particella osservata lungo l'intera lunghezza della corda.
   - **Pausa / Riprendi**: Congela l'intero sistema per permettere al docente di analizzare le coordinate spaziotemporali ferme.
   - **Azzera / Reset**: Riporta la corda allo stato di riposo.

---

## 3. Scelte Progettuali & Algoritmo Fisico

### Il Buffer Circolare Temporale vs Equazioni alle Derivate Parziali
- **Approccio scelto**: Come suggerito dalle specifiche didattiche, la posizione verticale di ogni particella $i$ a coordinata $x_i$ viene calcolata interrogando la storia della sorgente:
  $$y(x_i, t) = y_{\text{source}}\left(t - \frac{x_i}{v}\right)$$
- **Vantaggi**:
  1. *Rigore Didattico*: Mostra esattamente l'essenza matematica dell'onda progressiva non dispersiva senza introdurre approssimazioni numeriche, smorzamento spurio o instabilità di Eulero/Verlet.
  2. *Prestazioni Perfette*: Nessun costo computazionale di risoluzione matriciale, rendering a 60 FPS fluido anche su dispositivi a bassa potenza.
  3. *Invarianza di Forma*: L'impulso asimmetrico conserva intatta la sua geometria durante la propagazione.

### Interpolazione Temporale Lineare
- Poiché il tempo fisico avanza in frazioni di secondo ($\Delta t_{\text{frame}}$) e il buffer campiona con frequenza costante (es. 120 o 240 Hz), l'algoritmo effettua un'interpolazione lineare tra i campioni del buffer storico per garantire fluidità sub-frame senza scalettature grafiche.

---

## 4. Architettura Tecnica & Flusso Dati

```
┌─────────────────────────────────────────────────────────────┐
│                     Stato della Simulazione                 │
│  - tempo globale t (secondi)                                │
│  - velocità v (m/s)                                         │
│  - posizione selettore X (m)                                │
│  - modalità sorgente: Quiescente | Impulso | Sinusoidale   │
│  - flag isPaused: true | false                              │
│  - buffer storico: ring buffer Float32Array y_0(t)          │
└──────────────────────────────┬──────────────────────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
 ┌──────────────────────┐             ┌──────────────────────┐
 │  Loop Fisico (Tick)  │             │   Loop Grafico (rAF) │
 │  - calcola y_0(t)    │             │  1. Canvas Corda     │
 │  - salva nel buffer  │             │     (vista spaziale) │
 │  - campiona y(x_i,t) │             │  2. Oscilloscopio 1  │
 └──────────────────────┘             │     (y-t sorgente)   │
                                      │  3. Oscilloscopio 2  │
                                      │     (y-t particella) │
                                      └──────────────────────┘
```

### Mappatura Componenti e Controlli
- **`WaveCanvas`**: Rendering Retina a doppio DPR del canvas della corda con scala metrica gradata, sorgente rossa, particelle intermedie e sonda blu.
- **`OscilloscopeCanvas`**: Doppio tracciatore coordinato su asse temporale comune con cursore mobile e griglia millimetrata.
- **`ControlPanel`**: Tutti gli slider con valori istantanei tabulari (`tabular-nums`) e pulsanti d'azione ergonomici con feedback visivo immediato.
