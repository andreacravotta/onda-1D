/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Play,
  Pause,
  Rewind,
  RotateCcw,
  Activity,
  Waves,
  Info,
  Clock,
  Gauge,
  Sliders,
  Eye,
  EyeOff,
  Sparkles
} from 'lucide-react';

// Costanti fisiche e geometriche del sistema
const STRING_LENGTH = 10.0; // Lunghezza corda in metri
const PARTICLE_COUNT = 81; // Numero di particelle discrete sulla corda
const TIME_WINDOW = 8.0; // Finestra temporale visualizzata negli oscilloscopi (secondi)
const SAMPLE_RATE = 200; // Campioni al secondo nel buffer temporale (200 Hz = dt = 0.005 s)
const BUFFER_DURATION = 60.0; // Durata massima storica memorizzata nel buffer (secondi)
const BUFFER_SIZE = Math.floor(BUFFER_DURATION * SAMPLE_RATE);
const AMPLITUDE_MAX = 1.0; // Ampiezza adimensionale normalizzata (-1 a +1)
const PULSE_DURATION = 1.6; // Durata totale dell'impulso asimmetrico (secondi)
const PULSE_RISE_RATIO = 0.75; // 75% salita dolce (1.2s), 25% discesa rapida (0.4s)
const SINE_FREQUENCY = 0.5; // Frequenza oscillatore sinusoidale (0.5 Hz -> T = 2.0 s)

export default function App() {
  // Parametri fisici controllabili
  const [velocity, setVelocity] = useState<number>(2.0); // v: da 1.0 a 5.0 m/s
  const [targetX, setTargetX] = useState<number>(4.0); // X: posizione della particella selezionata (m)
  const [playMode, setPlayMode] = useState<'play' | 'pause' | 'rewind'>('pause');
  const [isSineActive, setIsSineActive] = useState<boolean>(false);

  // La simulazione parte solo alla prima pressione di "Invia Impulso" o "Onda Sinusoidale"
  const [hasStarted, setHasStarted] = useState<boolean>(false);

  // All'inizio il movimento è nascosto per tutte le particelle tranne quella rossa (x=0) e quella blu (x=X).
  const [showOtherParticlesAndWave, setShowOtherParticlesAndWave] = useState<boolean>(false);

  // Lettura temporale visualizzata nell'interfaccia
  const [currentTimeDisplay, setCurrentTimeDisplay] = useState<number>(0.0);

  // Riferimenti agli elementi Canvas
  const stringCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceGraphRef = useRef<HTMLCanvasElement | null>(null);
  const probeGraphRef = useRef<HTMLCanvasElement | null>(null);

  // Stato dinamico del motore fisico (conservato nei ref per il loop a 60fps)
  const simState = useRef({
    hasStarted: false,
    time: 0.0,
    maxTime: 0.0,
    lastRafTime: 0,
    lastUiUpdateTime: 0,
    playMode: 'pause' as 'play' | 'pause' | 'rewind',
    velocity: 2.0,
    targetX: 4.0,
    isSineActive: false,
    sineStartTime: 0.0,
    showOtherParticlesAndWave: false,
    // Buffer circolare storico di y(0, t): [indice] -> { t: number, y: number }
    buffer: new Float32Array(BUFFER_SIZE),
    bufferTime: new Float64Array(BUFFER_SIZE),
    bufferHead: 0,
    bufferCount: 0,
    // Impulsi asimmetrici attivi
    activePulses: [] as { startTime: number }[],
    // Telemetria istantanea per la UI
    instantY0: 0,
    instantYX: 0,
  });

  // Sincronizza lo stato React nei ref del motore fisico
  useEffect(() => {
    simState.current.velocity = velocity;
  }, [velocity]);

  useEffect(() => {
    simState.current.targetX = targetX;
  }, [targetX]);

  useEffect(() => {
    simState.current.playMode = playMode;
  }, [playMode]);

  useEffect(() => {
    simState.current.hasStarted = hasStarted;
  }, [hasStarted]);

  useEffect(() => {
    simState.current.showOtherParticlesAndWave = showOtherParticlesAndWave;
  }, [showOtherParticlesAndWave]);

  useEffect(() => {
    simState.current.isSineActive = isSineActive;
    if (isSineActive && simState.current.hasStarted) {
      simState.current.sineStartTime = simState.current.time;
    }
  }, [isSineActive]);

  // Funzione che calcola lo spostamento della sorgente y(0, t) ad un dato istante t
  const evaluateSourceAtTime = useCallback((t: number) => {
    if (t < 0) return 0;
    let y = 0;

    // 1. Contributo oscillazione sinusoidale
    if (simState.current.isSineActive) {
      const tSine = t - simState.current.sineStartTime;
      if (tSine >= 0) {
        y += AMPLITUDE_MAX * Math.sin(2 * Math.PI * SINE_FREQUENCY * tSine);
      }
    }

    // 2. Contributo impulsi asimmetrici generati
    for (const pulse of simState.current.activePulses) {
      const dt = t - pulse.startTime;
      if (dt >= 0 && dt <= PULSE_DURATION) {
        const riseTime = PULSE_DURATION * PULSE_RISE_RATIO;
        const fallTime = PULSE_DURATION * (1 - PULSE_RISE_RATIO);

        if (dt <= riseTime) {
          const phase = (Math.PI / 2) * (dt / riseTime);
          y += AMPLITUDE_MAX * Math.sin(phase) * Math.sin(phase);
        } else {
          const phase = (Math.PI / 2) * ((dt - riseTime) / fallTime);
          y += AMPLITUDE_MAX * Math.cos(phase) * Math.cos(phase);
        }
      }
    }

    return Math.max(-1.2, Math.min(1.2, y));
  }, []);

  // Registra un campione nel buffer storico
  const recordSourceSample = useCallback((t: number, y: number) => {
    const state = simState.current;
    const idx = state.bufferHead % BUFFER_SIZE;
    state.buffer[idx] = y;
    state.bufferTime[idx] = t;
    state.bufferHead++;
    if (state.bufferCount < BUFFER_SIZE) {
      state.bufferCount++;
    }
  }, []);

  // Campiona il valore storico di y(0, t_query) tramite ricerca e interpolazione lineare
  const sampleHistory = useCallback((tQuery: number): number => {
    if (tQuery < 0) return 0;

    const state = simState.current;
    if (state.bufferCount === 0) return 0;

    const newestIdx = (state.bufferHead - 1 + BUFFER_SIZE) % BUFFER_SIZE;
    const newestTime = state.bufferTime[newestIdx];

    if (tQuery >= newestTime) {
      return state.buffer[newestIdx];
    }

    const oldestIdx = (state.bufferHead - state.bufferCount + BUFFER_SIZE) % BUFFER_SIZE;
    const oldestTime = state.bufferTime[oldestIdx];

    if (tQuery <= oldestTime) {
      return 0;
    }

    const approxOffset = Math.floor((newestTime - tQuery) * SAMPLE_RATE);
    let targetIdx = (state.bufferHead - 1 - approxOffset + BUFFER_SIZE * 4) % BUFFER_SIZE;

    let searchSteps = 0;
    while (state.bufferTime[targetIdx] > tQuery && searchSteps < 25) {
      targetIdx = (targetIdx - 1 + BUFFER_SIZE) % BUFFER_SIZE;
      searchSteps++;
    }
    searchSteps = 0;
    while (
      targetIdx !== newestIdx &&
      state.bufferTime[(targetIdx + 1) % BUFFER_SIZE] <= tQuery &&
      searchSteps < 25
    ) {
      targetIdx = (targetIdx + 1) % BUFFER_SIZE;
      searchSteps++;
    }

    const nextIdx = (targetIdx + 1) % BUFFER_SIZE;
    const t0 = state.bufferTime[targetIdx];
    const t1 = state.bufferTime[nextIdx];
    const y0 = state.buffer[targetIdx];
    const y1 = state.buffer[nextIdx];

    if (t1 === t0) return y0;

    const alpha = Math.max(0, Math.min(1, (tQuery - t0) / (t1 - t0)));
    return y0 + alpha * (y1 - y0);
  }, []);

  // Calcola lo spostamento di una particella a posizione x e tempo t: y(x, t) = y(0, t - x/v)
  const getDisplacementAt = useCallback(
    (x: number, t: number, v: number): number => {
      const delay = x / v;
      const tDelayed = t - delay;
      return sampleHistory(tDelayed);
    },
    [sampleHistory]
  );

  // Azione: invio impulso asimmetrico (avvia la simulazione al primo click)
  const triggerAsymmetricPulse = useCallback(() => {
    const state = simState.current;
    if (!state.hasStarted) {
      state.hasStarted = true;
      setHasStarted(true);
      state.time = 0.0;
      state.maxTime = 0.0;
      state.activePulses = [{ startTime: 0.0 }];
      state.playMode = 'play';
      setPlayMode('play');
    } else {
      const now = state.time;
      state.activePulses.push({ startTime: now });
      if (state.playMode !== 'play') {
        state.playMode = 'play';
        setPlayMode('play');
      }
    }
  }, []);

  // Azione: commutazione onda sinusoidale (avvia la simulazione al primo click)
  const toggleSineWave = useCallback(() => {
    const state = simState.current;
    if (!state.hasStarted) {
      state.hasStarted = true;
      setHasStarted(true);
      state.time = 0.0;
      state.maxTime = 0.0;
      state.isSineActive = true;
      state.sineStartTime = 0.0;
      setIsSineActive(true);
      state.playMode = 'play';
      setPlayMode('play');
    } else {
      setIsSineActive((prev) => {
        const next = !prev;
        state.isSineActive = next;
        if (next) {
          state.sineStartTime = state.time;
        }
        return next;
      });
      if (state.playMode !== 'play') {
        state.playMode = 'play';
        setPlayMode('play');
      }
    }
  }, []);

  // Azione: reset / azzeramento corda
  const handleReset = useCallback(() => {
    const state = simState.current;
    state.hasStarted = false;
    state.time = 0.0;
    state.maxTime = 0.0;
    state.lastRafTime = 0;
    state.buffer.fill(0);
    state.bufferTime.fill(0);
    state.bufferHead = 0;
    state.bufferCount = 0;
    state.activePulses = [];
    state.instantY0 = 0;
    state.instantYX = 0;
    setIsSineActive(false);
    setHasStarted(false);
    setPlayMode('pause');
    setCurrentTimeDisplay(0.0);
  }, []);

  // Azione: click/drag sul canvas per spostare la finestra di osservazione X
  const handleStringCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = stringCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const paddingLeft = 60;
      const paddingRight = 40;
      const usableWidth = canvas.clientWidth - paddingLeft - paddingRight;
      const ratio = Math.max(0, Math.min(1, (clickX - paddingLeft) / usableWidth));
      const newX = parseFloat((ratio * STRING_LENGTH).toFixed(1));
      if (newX >= 0.2 && newX <= 9.8) {
        setTargetX(newX);
      }
    },
    []
  );

  // Loop principale di rendering e simulazione a 60 FPS
  useEffect(() => {
    let animationFrameId: number;

    const render = (currentTime: number) => {
      const state = simState.current;

      if (!state.lastRafTime) {
        state.lastRafTime = currentTime;
      }

      const rawDt = (currentTime - state.lastRafTime) / 1000;
      state.lastRafTime = currentTime;
      const dt = Math.min(rawDt, 0.05);

      if (!state.hasStarted) {
        state.time = 0.0;
        state.maxTime = 0.0;
      } else if (state.playMode === 'play') {
        state.time += dt;

        if (state.time >= state.maxTime) {
          state.maxTime = state.time;
          const currentY0 = evaluateSourceAtTime(state.time);
          recordSourceSample(state.time, currentY0);

          state.activePulses = state.activePulses.filter(
            (p) => state.time - p.startTime < BUFFER_DURATION
          );
        }
      } else if (state.playMode === 'rewind') {
        state.time = Math.max(0, state.time - dt * 0.5);
        if (state.time <= 0) {
          state.time = 0;
          state.playMode = 'pause';
          setPlayMode('pause');
        }
      }

      state.instantY0 = sampleHistory(state.time);
      state.instantYX = getDisplacementAt(state.targetX, state.time, state.velocity);

      if (currentTime - state.lastUiUpdateTime > 60) {
        state.lastUiUpdateTime = currentTime;
        setCurrentTimeDisplay(state.time);
      }

      const tNow = state.time;
      const v = state.velocity;
      const selX = state.targetX;
      const showAll = state.showOtherParticlesAndWave;

      // -------------------------------------------------------------
      // 1. DISEGNO DELLA CORDA (Vista Spaziale)
      // -------------------------------------------------------------
      const sCanvas = stringCanvasRef.current;
      if (sCanvas) {
        const ctx = sCanvas.getContext('2d');
        if (ctx) {
          const dpr = window.devicePixelRatio || 1;
          const width = sCanvas.clientWidth;
          const height = sCanvas.clientHeight;

          if (sCanvas.width !== width * dpr || sCanvas.height !== height * dpr) {
            sCanvas.width = width * dpr;
            sCanvas.height = height * dpr;
          }

          ctx.save();
          ctx.scale(dpr, dpr);
          ctx.clearRect(0, 0, width, height);

          const padL = 60;
          const padR = 40;
          const padTop = 32;
          const padBottom = 45;
          const simW = width - padL - padR;
          const simH = height - padTop - padBottom;
          const midY = padTop + simH / 2;
          const yAmplitudeScale = simH * 0.38;

          // Sfondo area di lavoro
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(padL, padTop, simW, simH);

          // Asse orizzontale di equilibrio (y = 0) tratteggiato
          ctx.beginPath();
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = '#94A3B8';
          ctx.lineWidth = 1;
          ctx.moveTo(padL, midY);
          ctx.lineTo(padL + simW, midY);
          ctx.stroke();
          ctx.setLineDash([]);

          // Posizione orizzontale e verticale della sorgente (x = 0)
          const sourceYDisp = sampleHistory(tNow);
          const sourceYPix = midY - sourceYDisp * yAmplitudeScale;
          const sourceXPix = padL;

          // Posizione orizzontale e verticale della particella a distanza X
          const probeYDisp = getDisplacementAt(selX, tNow, v);
          const probeYPix = midY - probeYDisp * yAmplitudeScale;
          const probeXPix = padL + (selX / STRING_LENGTH) * simW;

          // Guide verticali tratteggiate per evidenziare il moto puramente verticale dei due punti
          ctx.beginPath();
          ctx.setLineDash([2, 3]);
          ctx.strokeStyle = 'rgba(220, 38, 38, 0.25)';
          ctx.lineWidth = 1;
          ctx.moveTo(sourceXPix, midY - yAmplitudeScale);
          ctx.lineTo(sourceXPix, midY + yAmplitudeScale);
          ctx.stroke();

          ctx.beginPath();
          ctx.strokeStyle = 'rgba(37, 99, 235, 0.25)';
          ctx.moveTo(probeXPix, midY - yAmplitudeScale);
          ctx.lineTo(probeXPix, midY + yAmplitudeScale);
          ctx.stroke();
          ctx.setLineDash([]);

          // Finestra di osservazione traslucida attorno alla particella bersaglio X
          const windowW = 28;
          ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
          ctx.fillRect(probeXPix - windowW / 2, padTop, windowW, simH);

          ctx.strokeStyle = 'rgba(37, 99, 235, 0.45)';
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1.5;
          ctx.strokeRect(probeXPix - windowW / 2, padTop, windowW, simH);
          ctx.setLineDash([]);

          ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
          ctx.fillStyle = '#1D4ED8';
          ctx.textAlign = 'center';
          ctx.fillText(`x = ${selX.toFixed(1)} m`, probeXPix, padTop - 12);

          // SE L'UTENTE HA ATTIVATO "MOSTRA ALTRE PARTICELLE":
          if (showAll) {
            // Curva continua della perturbazione y(x)
            ctx.beginPath();
            ctx.strokeStyle = '#3B82F6';
            ctx.lineWidth = 2.5;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            const curveSteps = 160;
            for (let step = 0; step <= curveSteps; step++) {
              const frac = step / curveSteps;
              const xM = frac * STRING_LENGTH;
              const xP = padL + frac * simW;
              const yD = getDisplacementAt(xM, tNow, v);
              const yP = midY - yD * yAmplitudeScale;
              if (step === 0) ctx.moveTo(xP, yP);
              else ctx.lineTo(xP, yP);
            }
            ctx.stroke();

            // Disegna le altre particelle discrete intermedie lungo la corda
            for (let i = 1; i < PARTICLE_COUNT; i++) {
              const xMeter = (i / (PARTICLE_COUNT - 1)) * STRING_LENGTH;
              if (Math.abs(xMeter - selX) < 0.06) continue;

              const xPix = padL + (xMeter / STRING_LENGTH) * simW;
              const yDisp = getDisplacementAt(xMeter, tNow, v);
              const yPix = midY - yDisp * yAmplitudeScale;

              ctx.beginPath();
              ctx.arc(xPix, yPix, 3.5, 0, Math.PI * 2);
              ctx.fillStyle = '#64748B';
              ctx.fill();
              ctx.lineWidth = 1;
              ctx.strokeStyle = '#334155';
              ctx.stroke();
            }
          }

          // SORGENTE (x = 0) - ROSSO
          ctx.beginPath();
          ctx.arc(sourceXPix, sourceYPix, 7.5, 0, Math.PI * 2);
          ctx.fillStyle = '#DC2626';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#991B1B';
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(sourceXPix, sourceYPix, 12, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(220, 38, 38, 0.35)';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
          ctx.fillStyle = '#DC2626';
          ctx.textAlign = 'center';
          ctx.fillText('Sorgente (x = 0)', padL, padTop - 12);

          // PARTICELLA SELEZIONATA A DISTANZA X - BLU
          ctx.beginPath();
          ctx.arc(probeXPix, probeYPix, 7.5, 0, Math.PI * 2);
          ctx.fillStyle = '#2563EB';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#1E40AF';
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(probeXPix, probeYPix, 12, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(37, 99, 235, 0.35)';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          // Asse graduato spaziale X (metri)
          ctx.beginPath();
          ctx.strokeStyle = '#64748B';
          ctx.lineWidth = 1.5;
          ctx.moveTo(padL, padTop + simH);
          ctx.lineTo(padL + simW, padTop + simH);
          ctx.stroke();

          ctx.font = '500 11px "JetBrains Mono", monospace';
          ctx.fillStyle = '#475569';
          ctx.textAlign = 'center';

          for (let m = 0; m <= STRING_LENGTH; m += 1) {
            const xPos = padL + (m / STRING_LENGTH) * simW;
            ctx.beginPath();
            ctx.moveTo(xPos, padTop + simH);
            ctx.lineTo(xPos, padTop + simH + 6);
            ctx.stroke();
            ctx.fillText(`${m}m`, xPos, padTop + simH + 18);
          }

          for (let sm = 0.5; sm < STRING_LENGTH; sm += 1) {
            const xPos = padL + (sm / STRING_LENGTH) * simW;
            ctx.beginPath();
            ctx.moveTo(xPos, padTop + simH);
            ctx.lineTo(xPos, padTop + simH + 3);
            ctx.stroke();
          }

          ctx.font = '600 12px "Plus Jakarta Sans", sans-serif';
          ctx.fillStyle = '#334155';
          ctx.textAlign = 'right';
          ctx.fillText('Posizione x (m) ➔', padL + simW, padTop + simH + 34);

          // Indicatore della modalità attiva in basso a sinistra
          ctx.textAlign = 'left';
          ctx.font = '600 11px "JetBrains Mono", monospace';
          ctx.fillStyle = showAll ? '#2563EB' : '#DC2626';
          ctx.fillText(
            showAll
              ? '● Modalità: Andamento perturbazione e tutte le particelle visibili'
              : '● Modalità iniziale: Visibili solo la sorgente (x=0) e la particella a distanza X',
            padL,
            padTop + simH + 34
          );

          // Scala asse Y a sinistra
          ctx.textAlign = 'right';
          ctx.font = '500 11px "JetBrains Mono", monospace';
          ctx.fillStyle = '#64748B';
          ctx.fillText('+A', padL - 8, midY - yAmplitudeScale + 4);
          ctx.fillText('0', padL - 8, midY + 4);
          ctx.fillText('-A', padL - 8, midY + yAmplitudeScale + 4);

          ctx.restore();
        }
      }

      // -------------------------------------------------------------
      // 2. DISEGNO OSCILLOSCOPI TEMPORALI y(t)
      // -------------------------------------------------------------
      const drawTimeGraph = (
        canvas: HTMLCanvasElement | null,
        title: string,
        lineColor: string,
        pointColor: string,
        evaluateFn: (tSample: number) => number,
        showDelayMarker: boolean = false
      ) => {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;

        if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
          canvas.width = width * dpr;
          canvas.height = height * dpr;
        }

        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, height);

        const padL = 60;
        const padR = 40;
        const padTop = 24;
        const padBottom = 28;
        const plotW = width - padL - padR;
        const plotH = height - padTop - padBottom;
        const midY = padTop + plotH / 2;
        const yAmp = plotH * 0.4;

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(padL, padTop, plotW, plotH);

        const tEnd = tNow;
        const tStart = tNow - TIME_WINDOW;
        const firstMajorSecond = Math.ceil(tStart);

        ctx.beginPath();
        ctx.strokeStyle = '#F1F5F9';
        ctx.lineWidth = 1;
        for (let tGrid = Math.floor(tStart * 2) / 2; tGrid <= tEnd; tGrid += 0.5) {
          const frac = (tGrid - tStart) / TIME_WINDOW;
          if (frac >= 0 && frac <= 1) {
            const xGrid = padL + frac * plotW;
            ctx.moveTo(xGrid, padTop);
            ctx.lineTo(xGrid, padTop + plotH);
          }
        }
        ctx.stroke();

        ctx.beginPath();
        ctx.strokeStyle = '#E2E8F0';
        ctx.lineWidth = 1.2;
        for (let tGrid = firstMajorSecond; tGrid <= tEnd; tGrid += 1.0) {
          const frac = (tGrid - tStart) / TIME_WINDOW;
          const xGrid = padL + frac * plotW;
          ctx.moveTo(xGrid, padTop);
          ctx.lineTo(xGrid, padTop + plotH);
        }
        ctx.moveTo(padL, midY - yAmp);
        ctx.lineTo(padL + plotW, midY - yAmp);
        ctx.moveTo(padL, midY + yAmp);
        ctx.lineTo(padL + plotW, midY + yAmp);
        ctx.stroke();

        ctx.beginPath();
        ctx.strokeStyle = '#94A3B8';
        ctx.lineWidth = 1.5;
        ctx.moveTo(padL, midY);
        ctx.lineTo(padL + plotW, midY);
        ctx.stroke();

        ctx.strokeStyle = '#CBD5E1';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(padL, padTop, plotW, plotH);

        const stepPix = 1.5;
        ctx.beginPath();
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 2.2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        let started = false;
        for (let xPix = 0; xPix <= plotW; xPix += stepPix) {
          const frac = xPix / plotW;
          const tSample = tStart + frac * TIME_WINDOW;
          const yVal = evaluateFn(tSample);
          const yScreen = midY - yVal * yAmp;

          const screenX = padL + xPix;
          if (!started) {
            ctx.moveTo(screenX, yScreen);
            started = true;
          } else {
            ctx.lineTo(screenX, yScreen);
          }
        }
        ctx.stroke();

        const currentY = evaluateFn(tNow);
        const currentScreenY = midY - currentY * yAmp;
        ctx.beginPath();
        ctx.arc(padL + plotW, currentScreenY, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = pointColor;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#FFFFFF';
        ctx.stroke();

        ctx.font = '600 11px "JetBrains Mono", monospace';
        ctx.fillStyle = '#0F172A';
        ctx.textAlign = 'right';
        ctx.fillText(`t = ${tNow.toFixed(2)}s`, padL + plotW, padTop + plotH + 18);

        ctx.textAlign = 'left';
        ctx.fillStyle = '#64748B';
        ctx.fillText(`t - ${TIME_WINDOW.toFixed(0)}s`, padL, padTop + plotH + 18);

        ctx.textAlign = 'center';
        ctx.font = '500 10px "JetBrains Mono", monospace';
        for (let tGrid = firstMajorSecond; tGrid <= tEnd - 0.4; tGrid += 1.0) {
          const frac = (tGrid - tStart) / TIME_WINDOW;
          if (frac > 0.08 && frac < 0.92) {
            const xGrid = padL + frac * plotW;
            ctx.fillText(`${tGrid.toFixed(0)}s`, xGrid, padTop + plotH + 18);
          }
        }

        ctx.textAlign = 'right';
        ctx.font = '500 11px "JetBrains Mono", monospace';
        ctx.fillStyle = '#64748B';
        ctx.fillText('+A', padL - 8, midY - yAmp + 4);
        ctx.fillText('0', padL - 8, midY + 4);
        ctx.fillText('-A', padL - 8, midY + yAmp + 4);

        ctx.textAlign = 'left';
        ctx.font = '600 12px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = '#1E293B';
        ctx.fillText(title, padL + 10, padTop + 16);

        ctx.textAlign = 'right';
        ctx.font = '600 11px "JetBrains Mono", monospace';
        ctx.fillStyle = lineColor;
        ctx.fillText(`y = ${currentY >= 0 ? '+' : ''}${currentY.toFixed(2)}`, padL + plotW - 10, padTop + 16);

        if (showDelayMarker) {
          const delaySec = selX / v;
          if (delaySec <= TIME_WINDOW) {
            const delayPix = (delaySec / TIME_WINDOW) * plotW;
            const markerX = padL + plotW - delayPix;

            if (markerX >= padL) {
              ctx.save();
              ctx.beginPath();
              ctx.strokeStyle = 'rgba(37, 99, 235, 0.45)';
              ctx.lineWidth = 1.5;
              ctx.setLineDash([3, 3]);
              ctx.moveTo(markerX, padTop);
              ctx.lineTo(markerX, padTop + plotH);
              ctx.stroke();

              ctx.setLineDash([]);
              ctx.strokeStyle = '#2563EB';
              ctx.fillStyle = '#2563EB';
              ctx.lineWidth = 1.5;
              const arrowY = padTop + plotH - 12;
              ctx.beginPath();
              ctx.moveTo(markerX, arrowY);
              ctx.lineTo(padL + plotW, arrowY);
              ctx.stroke();

              ctx.beginPath();
              ctx.moveTo(markerX + 5, arrowY - 3);
              ctx.lineTo(markerX, arrowY);
              ctx.lineTo(markerX + 5, arrowY + 3);
              ctx.stroke();

              ctx.font = '600 10px "JetBrains Mono", monospace';
              ctx.textAlign = 'center';
              ctx.fillText(`Δt = ${delaySec.toFixed(2)}s`, markerX + delayPix / 2, arrowY - 4);
              ctx.restore();
            }
          }
        }

        ctx.restore();
      };

      // Grafico 1: Sorgente y(0, t)
      drawTimeGraph(
        sourceGraphRef.current,
        'Grafico 1: Oscilloscopio Sorgente — y(0, t)',
        '#DC2626',
        '#DC2626',
        (tSample) => sampleHistory(tSample)
      );

      // Grafico 2: Particella a coordinata X
      drawTimeGraph(
        probeGraphRef.current,
        `Grafico 2: Oscilloscopio Particella a X = ${selX.toFixed(1)} m — y(X, t) = y(0, t - X/v)`,
        '#2563EB',
        '#2563EB',
        (tSample) => getDisplacementAt(selX, tSample, v),
        true
      );

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationFrameId);
  }, [evaluateSourceAtTime, recordSourceSample, sampleHistory, getDisplacementAt]);

  const delaySeconds = parseFloat((targetX / velocity).toFixed(2));

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col items-center">
      {/* Top Header Tecnico & Didattico */}
      <header className="w-full bg-white border-b border-slate-200 sticky top-0 z-30 shadow-2xs">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold shadow-xs">
              <Waves className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold tracking-tight text-slate-900 leading-tight">
                Propagazione Onda Meccanica 1D
              </h1>
              <p className="text-xs text-slate-500 font-medium">
                Simulazione didattica del ritardo temporale spaziale
              </p>
            </div>
          </div>

          {/* Formula fondamentale didattica ben visibile */}
          <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 px-3.5 py-1.5 rounded-lg">
            <span className="text-xs text-slate-500 font-medium">Legge dell'onda:</span>
            <span className="font-mono text-xs sm:text-sm font-semibold text-blue-700 tracking-wide">
              y(x, t) = y(0, t - x/v)
            </span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Banner Didattico Sintetico */}
        <section className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs sm:text-sm text-slate-600">
            <div className="flex items-start gap-2.5">
              <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <strong className="text-slate-800 font-semibold">Principio didattico:</strong>{' '}
                Il moto di ogni punto della corda a coordinata <span className="font-mono text-blue-700 font-semibold">x</span> è la replica esatta del moto della sorgente a <span className="font-mono text-red-600 font-semibold">x = 0</span>, ritardato del tempo necessario affinché l'onda percorra la distanza <span className="font-mono font-medium">x</span> a velocità <span className="font-mono font-medium">v</span>:
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-2 bg-blue-50/80 border border-blue-100 text-blue-900 px-3 py-1.5 rounded-md font-mono text-xs font-semibold">
              <span>Δt = x / v</span>
              <span>=</span>
              <span>{targetX.toFixed(1)}m / {velocity.toFixed(1)}m/s</span>
              <span>=</span>
              <span className="text-blue-700 font-bold">{delaySeconds.toFixed(2)}s</span>
            </div>
          </div>
        </section>

        {/* SEZIONE 1: LA CORDA (Vista Spaziale) */}
        <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  1. Vista Spaziale (Istantanea della Corda)
                </span>
                <span className="text-xs text-slate-400 font-normal hidden md:inline">
                  · Clicca sulla corda per spostare la finestra blu
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {showOtherParticlesAndWave
                  ? 'Ora è visibile la propagazione della perturbazione lungo tutta la corda e le particelle.'
                  : 'Fase iniziale: visibili solo i due oscillatori (sorgente rossa e particella blu).'}
              </p>
            </div>

            {/* Comando per mostrare/nascondere le altre particelle e l'andamento della perturbazione */}
            <button
              onClick={() => setShowOtherParticlesAndWave((prev) => !prev)}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all border shadow-xs cursor-pointer ${
                showOtherParticlesAndWave
                  ? 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600'
                  : 'bg-white hover:bg-slate-50 text-slate-800 border-slate-300'
              }`}
              title={
                showOtherParticlesAndWave
                  ? 'Torna alla vista con solo sorgente e particella X'
                  : 'Mostra le particelle intermedie della corda e la perturbazione'
              }
            >
              {showOtherParticlesAndWave ? (
                <>
                  <EyeOff className="w-4 h-4" />
                  <span>Nascondi altre particelle (Solo 2 punti)</span>
                </>
              ) : (
                <>
                  <Eye className="w-4 h-4 text-blue-600" />
                  <span>Mostra altre particelle e corda</span>
                </>
              )}
            </button>
          </div>

          {/* Canvas della corda */}
          <div className="relative w-full h-44 bg-slate-50 rounded-lg border border-slate-200 overflow-hidden cursor-crosshair">
            <canvas
              ref={stringCanvasRef}
              onClick={handleStringCanvasClick}
              className="w-full h-full block"
            />
          </div>

          {/* Selettore posizione X e Valori Correnti */}
          <div className="mt-4 pt-3 border-t border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
            {/* Slider Selettore Particella X */}
            <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-3">
              <label htmlFor="target-x-slider" className="text-xs font-bold text-slate-700 uppercase tracking-wide shrink-0 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-blue-600" />
                Selettore Posizione X:
              </label>
              <div className="flex-1 flex items-center gap-3">
                <span className="text-xs font-mono text-slate-400">0.2m</span>
                <input
                  id="target-x-slider"
                  type="range"
                  min="0.2"
                  max="9.8"
                  step="0.1"
                  value={targetX}
                  onChange={(e) => setTargetX(parseFloat(e.target.value))}
                  className="flex-1 accent-blue-600 cursor-pointer h-2 bg-slate-200 rounded-lg"
                />
                <span className="text-xs font-mono text-slate-400">9.8m</span>
              </div>
              <span className="font-mono text-sm font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-md shrink-0">
                X = {targetX.toFixed(1)} m
              </span>
            </div>

            {/* Dati Telemetrici Calcolati */}
            <div className="flex items-center gap-4 text-xs font-mono bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-md">
              <div className="text-slate-600">
                Velocità: <span className="font-bold text-slate-900">{velocity.toFixed(1)} m/s</span>
              </div>
              <div className="w-px h-3.5 bg-slate-200"></div>
              <div className="text-slate-600">
                Ritardo <span className="font-sans font-semibold">Δt = X/v</span>:{' '}
                <span className="font-bold text-blue-700">{delaySeconds.toFixed(2)} s</span>
              </div>
            </div>
          </div>
        </section>

        {/* SEZIONE 2: CONTROLLI SPERIMENTALI (Timeline rimossa, tasto riavvolgi mantenuto) */}
        <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              2. Controlli Sperimentali
            </span>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 font-mono text-xs bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-md">
                <Clock className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-slate-500">Tempo:</span>
                <span className="font-bold text-slate-900">t = {currentTimeDisplay.toFixed(2)}s</span>
              </div>

              {!hasStarted && (
                <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded text-xs font-medium">
                  <Sparkles className="w-3 h-3 text-amber-600" />
                  Pronto per l'avvio
                </span>
              )}
              {hasStarted && playMode === 'play' && (
                <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded text-xs font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></span>
                  In onda
                </span>
              )}
              {hasStarted && playMode === 'pause' && (
                <span className="inline-flex items-center text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded text-xs font-medium">
                  Pausa
                </span>
              )}
              {hasStarted && playMode === 'rewind' && (
                <span className="inline-flex items-center text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded text-xs font-medium">
                  Riavvolgimento 0.5x
                </span>
              )}
            </div>
          </div>

          {!hasStarted && (
            <div className="bg-amber-50/70 border border-amber-200/80 text-amber-900 px-3.5 py-2 rounded-lg text-xs flex items-center gap-2">
              <Info className="w-4 h-4 text-amber-700 shrink-0" />
              <span>
                Clicca su <strong>"Invia Impulso"</strong> o <strong>"Onda Sinusoidale"</strong> per far partire l'animazione da t = 0.00s.
              </span>
            </div>
          )}

          {/* Pulsantiera controlli */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-center">
            {/* Pulsante 1: Invia Impulso Asimmetrico */}
            <button
              onClick={triggerAsymmetricPulse}
              className="flex items-center justify-center gap-2 px-3.5 py-2.5 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-semibold text-xs sm:text-sm rounded-lg transition-colors shadow-xs cursor-pointer ring-2 ring-red-300 ring-offset-1"
            >
              <Activity className="w-4 h-4" />
              <span>Invia Impulso</span>
            </button>

            {/* Pulsante 2: Genera Onda Sinusoidale continua */}
            <button
              onClick={toggleSineWave}
              className={`flex items-center justify-center gap-2 px-3.5 py-2.5 font-medium text-xs sm:text-sm rounded-lg transition-colors border shadow-xs cursor-pointer ${
                isSineActive
                  ? 'bg-amber-600 hover:bg-amber-700 text-white border-amber-600'
                  : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
              }`}
            >
              <Waves className="w-4 h-4" />
              <span>{isSineActive ? 'Arresta Sinusoide' : 'Onda Sinusoidale'}</span>
            </button>

            {/* Pulsante Riavvolgi a velocità 0.5x (MANTENUTO) */}
            <button
              onClick={() => {
                if (!hasStarted) return;
                if (playMode === 'rewind') {
                  setPlayMode('play');
                } else {
                  setPlayMode('rewind');
                }
              }}
              disabled={!hasStarted}
              className={`flex items-center justify-center gap-2 px-3.5 py-2.5 font-medium text-xs sm:text-sm rounded-lg transition-colors border shadow-xs ${
                !hasStarted
                  ? 'opacity-50 cursor-not-allowed bg-slate-100 text-slate-400 border-slate-200'
                  : playMode === 'rewind'
                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600 cursor-pointer'
                  : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300 cursor-pointer'
              }`}
              title={hasStarted ? "Riavvolge il tempo indietro a velocità dimezzata (0.5x)" : "Avvia prima la simulazione"}
            >
              <Rewind className="w-4 h-4" />
              <span>{playMode === 'rewind' ? 'Riavvolgimento 0.5x' : 'Riavvolgi (0.5x)'}</span>
            </button>

            {/* Pulsante 3: Pausa / Play */}
            <button
              onClick={() => {
                if (!hasStarted) return;
                if (playMode === 'play') setPlayMode('pause');
                else setPlayMode('play');
              }}
              disabled={!hasStarted}
              className={`flex items-center justify-center gap-2 px-3.5 py-2.5 font-medium text-xs sm:text-sm rounded-lg transition-colors border shadow-xs ${
                !hasStarted
                  ? 'opacity-50 cursor-not-allowed bg-slate-100 text-slate-400 border-slate-200'
                  : playMode === 'play'
                  ? 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300 cursor-pointer'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600 cursor-pointer'
              }`}
              title={hasStarted ? (playMode === 'play' ? 'Metti in pausa' : 'Riprendi') : 'Avvia prima la simulazione'}
            >
              {playMode === 'play' ? <Pause className="w-4 h-4 text-slate-600" /> : <Play className="w-4 h-4" />}
              <span>{playMode === 'play' ? 'Pausa' : 'Riprendi'}</span>
            </button>

            {/* Pulsante 4: Reset / Azzera */}
            <button
              onClick={handleReset}
              className="flex items-center justify-center gap-2 px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs sm:text-sm rounded-lg transition-colors border border-slate-200 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4 text-slate-500" />
              <span>Azzera</span>
            </button>
          </div>

          {/* Slider Parametro Fisico: Velocità di propagazione (v) */}
          <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-center gap-2 shrink-0">
              <Gauge className="w-4 h-4 text-slate-600" />
              <label htmlFor="velocity-slider" className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                Velocità di propagazione (v):
              </label>
            </div>
            <div className="flex-1 flex items-center gap-3">
              <span className="text-xs font-mono text-slate-400">1.0 m/s</span>
              <input
                id="velocity-slider"
                type="range"
                min="1.0"
                max="5.0"
                step="0.1"
                value={velocity}
                onChange={(e) => setVelocity(parseFloat(e.target.value))}
                className="flex-1 accent-slate-800 cursor-pointer h-2 bg-slate-200 rounded-lg"
              />
              <span className="text-xs font-mono text-slate-400">5.0 m/s</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-mono text-sm font-bold text-slate-900 bg-slate-100 border border-slate-200 px-3 py-1 rounded-md">
                v = {velocity.toFixed(1)} m/s
              </span>
            </div>
          </div>
        </section>

        {/* SEZIONE 3: I GRAFICI TEMPORALI (y-t) */}
        <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                3. Grafici Temporali (y in funzione del tempo t)
              </span>
              <p className="text-xs text-slate-500">
                Gli oscilloscopi scorrono in sincronia da destra verso sinistra. Conta i quadretti di scarto per verificare il ritardo <span className="font-mono text-blue-600 font-semibold">Δt = X/v</span>.
              </p>
            </div>
            <div className="flex items-center gap-2 font-mono text-xs text-slate-500 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-md self-start sm:self-auto">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>Finestra visualizzata: 8.0s</span>
            </div>
          </div>

          {/* GRAFICO 1 (Rosso): Sorgente x = 0 */}
          <div className="space-y-1">
            <div className="w-full h-36 bg-slate-50 rounded-lg border border-slate-200 overflow-hidden">
              <canvas ref={sourceGraphRef} className="w-full h-full block" />
            </div>
          </div>

          {/* Linea didattica di connessione visiva tra i due grafici */}
          <div className="flex items-center justify-center gap-2 py-0.5 text-xs font-medium text-slate-500">
            <span className="w-16 h-px bg-slate-200"></span>
            <span className="inline-flex items-center gap-1 text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full text-[11px]">
              <span>Ritardo temporale osservabile tra le due curve:</span>
              <strong className="font-mono text-blue-700 font-bold">Δt = {delaySeconds.toFixed(2)}s</strong>
            </span>
            <span className="w-16 h-px bg-slate-200"></span>
          </div>

          {/* GRAFICO 2 (Blu): Particella a distanza X */}
          <div className="space-y-1">
            <div className="w-full h-36 bg-slate-50 rounded-lg border border-slate-200 overflow-hidden">
              <canvas ref={probeGraphRef} className="w-full h-full block" />
            </div>
          </div>
        </section>

        {/* Guida Didattica & Note sull'Asimmetria dell'Impulso */}
        <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs text-xs sm:text-sm text-slate-600 space-y-3">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Info className="w-4 h-4 text-blue-600" />
            Percorso Didattico: Dalle due particelle all'onda continua
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
            <div className="bg-slate-50 border border-slate-200 p-3 rounded-lg space-y-1">
              <span className="font-semibold text-slate-900 block">1. Confronto tra i due oscillatori:</span>
              <p>
                All'inizio, osservando solo la sorgente rossa a <span className="font-mono text-red-600 font-semibold">x = 0</span> e la particella blu a <span className="font-mono text-blue-700 font-semibold">x = X</span>, gli studenti notano che entrambi i punti compiono solo un moto verticale e che la particella blu si muove con un ritardo esatto di <span className="font-mono text-blue-700 font-semibold">Δt = X / v</span>.
              </p>
            </div>
            <div className="bg-slate-50 border border-slate-200 p-3 rounded-lg space-y-1">
              <span className="font-semibold text-slate-900 block">2. Rivelazione della perturbazione nella corda:</span>
              <p>
                Attivando <span className="font-semibold text-blue-700">"Mostra altre particelle e corda"</span>, viene svelato il legame meccanico elastico: l'onda viaggia nello spazio trasferendo la perturbazione da ogni particella alla successiva.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer Tecnico Pulito */}
      <footer className="w-full border-t border-slate-200 bg-white py-4 mt-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2">
          <span>Simulazione didattica di Fisica · Modello d'Onda Unidimensionale</span>
          <span className="font-mono">y(x,t) = y(0, t - x/v)</span>
        </div>
      </footer>
    </div>
  );
}
