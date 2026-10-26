import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBtcPrice } from '../../context/BtcPriceContext';
import PageSeo from '../PageSeo';
import VaultGameStakePicker from '../VaultGameStakePicker';
import { csrfHeaders } from '../../utils/csrfHeaders';
import {
  Box,
  Typography,
  Button,
  Paper,
  Alert,
  Card,
  CardContent,
  Grid,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  LinearProgress,
  IconButton,
  Tooltip,
  useMediaQuery
} from '@mui/material';
import {
  ArrowBack,
  PlayArrow,
  Close as CloseIcon,
  LocalActivity,
  EmojiEvents,
  Info,
  ContentCopy as ContentCopyIcon,
  BeachAccess
} from '@mui/icons-material';
import { keyframes } from '@mui/system';
import { getInventoryDisplayImageUrl, withThumbWidth } from '../../utils/inventoryImagesClient';
import {
  marketPageShellSx,
  marketContentSx,
  lightPanelPaperSx,
  heroTitleSx,
  heroSubtitleSx,
  heroOutlineButtonSx,
  MARKET_GRADIENT,
  BRAND_BLUE,
  PANEL_INK,
  PANEL_MUTED
} from '../../styles/marketShellSx';
import { useTheme } from '@mui/material/styles';

const winCardIn = keyframes`
  from { opacity: 0; transform: translateY(20px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
`;

const winImageGlow = keyframes`
  0%, 100% { filter: drop-shadow(0 8px 24px rgba(37, 99, 235, 0.25)); }
  50% { filter: drop-shadow(0 12px 32px rgba(37, 99, 235, 0.45)); }
`;

const TESTNET_NOTICE = 'The testnet sandbox game: dig with tTARI play stacks, win pretend items. Nothing is delivered.';

const SITE_PRIMARY_BTN = {
  background: MARKET_GRADIENT,
  color: '#fff',
  fontWeight: 700,
  boxShadow: '0 8px 24px rgba(37, 99, 235, 0.35)',
  '&:hover': {
    background: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)',
    boxShadow: '0 10px 28px rgba(37, 99, 235, 0.45)'
  }
};

const ADMIN_PRIMARY_BTN = {
  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
  color: 'white',
  '&:hover': { background: 'linear-gradient(135deg, #059669 0%, #047857 100%)' }
};

const CANVAS_W = 720;
const CANVAS_H = 460;
const HORIZON_Y = 0.2;

const smoothstep = (t) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

/** Frame-rate independent exponential ease toward a target (0–1). */
const easeToward = (current, target, deltaMs, halfLifeMs = 220) => {
  const factor = 1 - Math.pow(0.5, Math.max(0, deltaMs) / halfLifeMs);
  return current + (target - current) * factor;
};

const MAX_SAND_PARTICLES = 44;

/** Debris tossed off the crater lip — not random screen-wide pops. */
const spawnExcavationDebris = (particles, x, y, centerX, centerY, holeRadius) => {
  const dx = x - centerX;
  const dy = y - centerY;
  const dist = Math.hypot(dx, dy) || 1;
  const edgeDelta = dist - Math.max(6, holeRadius);
  if (edgeDelta > 38 && holeRadius > 14) return;

  const outward = Math.atan2(dy, dx);
  const tangent = outward + Math.PI / 2;
  const count = edgeDelta < 24 ? 3 : 2;

  for (let i = 0; i < count; i++) {
    const isDust = Math.random() < 0.45;
    const angle = outward + (Math.random() - 0.5) * (isDust ? 0.9 : 0.45);
    const speed = isDust ? 0.3 + Math.random() * 0.5 : 0.75 + Math.random() * 1;
    particles.push({
      type: isDust ? 'dust' : 'grain',
      x: x + Math.cos(tangent) * (Math.random() - 0.5) * 7,
      y: y + Math.sin(tangent) * (Math.random() - 0.5) * 5,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed * 0.2 - (0.45 + Math.random() * 0.75),
      life: isDust ? 0.2 + Math.random() * 0.16 : 0.34 + Math.random() * 0.2,
      size: isDust ? 0.55 + Math.random() * 0.7 : 0.9 + Math.random() * 1.4,
      shade: Math.floor(Math.random() * 14),
      rot: Math.random() * Math.PI
    });
  }
  while (particles.length > MAX_SAND_PARTICLES) particles.shift();
};

const traceOrganicRing = (ctx, cx, cy, radius, jitter, phase, shouldClose = true) => {
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = t * Math.PI * 2;
    const waveA = Math.sin(angle * 3 + phase * 0.06) * jitter;
    const waveB = Math.cos(angle * 5 - phase * 0.04) * jitter * 0.45;
    const r = radius + waveA + waveB;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  if (shouldClose) ctx.closePath();
};

/** Strip black backdrop from Graal-era 32×32 shell sprites. */
const processEraShellSprite = (img) =>
  new Promise((resolve) => {
    if (!img?.width) {
      resolve(null);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const c = canvas.getContext('2d');
    if (!c) {
      resolve(img);
      return;
    }
    c.drawImage(img, 0, 0);
    const frame = c.getImageData(0, 0, canvas.width, canvas.height);
    const { data } = frame;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = r * 0.299 + g * 0.587 + b * 0.114;
      if (lum < 18) {
        data[i + 3] = 0;
      } else if (lum < 42) {
        data[i + 3] = Math.min(255, Math.floor(((lum - 18) / 24) * 255));
      }
    }
    c.putImageData(frame, 0, 0);
    const processed = new Image();
    processed.onload = () => resolve(processed);
    processed.onerror = () => resolve(img);
    processed.src = canvas.toDataURL('image/png');
  });

/** Graal-era shells seated on the crater berm — even spacing, tangent to the wall. */
const drawEmergingShells = (
  ctx,
  { centerX, centerY, maxHoleRadius, currentHoleRadius, shells, shellSprites }
) => {
  if (!currentHoleRadius || currentHoleRadius < 6 || !shells?.length) return;

  const holeT = currentHoleRadius / maxHoleRadius;
  const sorted = [...shells].sort((a, b) => (a.ringT ?? 0) - (b.ringT ?? 0));

  sorted.forEach((shell) => {
    const reveal = smoothstep(shell.revealProgress || 0);
    if (reveal < 0.006) return;

    const ringT = shell.ringT ?? 0.5;
    const theta = shell.baseAngle ?? shell.angle ?? 0;

    // Sit on berm slope between pit floor and outer lip (distributed by ring depth).
    const wallInner = currentHoleRadius * 0.92;
    const wallOuter = currentHoleRadius * 0.965;
    const wallSpan = Math.max(0.12, holeT - 0.12);
    const wallPos = Math.max(0, Math.min(1, (ringT - 0.12) / wallSpan));
    const drawRadius = wallInner + (wallOuter - wallInner) * wallPos;

    const wx = centerX + Math.cos(theta) * drawRadius;
    const wy = centerY + Math.sin(theta) * drawRadius * 0.88;

    const digScale = 0.38 + holeT * 0.62;
    const revealScale = 0.6 + reveal * 0.4;
    const shellSize =
      Math.max(8, currentHoleRadius * 0.092) * digScale * revealScale * (shell.sizeMultiplier || 1);
    const buryLift = (1 - reveal) * shellSize * 1.02;
    const sandCover = shell.sandCover ?? Math.max(0, 1 - reveal);

    const sprite = shellSprites?.[shell.shellIndex];
    if (!sprite) return;

    ctx.save();
    ctx.translate(wx, wy);
    // Lay shell tangent to the berm with slight per-shell tilt.
    ctx.rotate(theta + Math.PI * 0.5 + (shell.tilt || 0));

    if (reveal > 0.1) {
      ctx.globalAlpha = 0.1 * reveal;
      ctx.fillStyle = 'rgba(30, 20, 12, 0.4)';
      ctx.beginPath();
      ctx.ellipse(0, buryLift + shellSize * 0.35, shellSize * 0.7, shellSize * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = Math.min(1, 0.66 + reveal * 0.34);
    ctx.translate(0, buryLift);
    const prevSmooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprite, -shellSize, -shellSize, shellSize * 2, shellSize * 2);
    ctx.imageSmoothingEnabled = prevSmooth;

    if (sandCover > 0.04) {
      ctx.globalAlpha = Math.min(0.96, sandCover * 0.96);
      ctx.fillStyle = 'rgba(214, 186, 139, 0.82)';
      ctx.beginPath();
      ctx.ellipse(0, shellSize * 0.16, shellSize * 0.94, shellSize * 0.4 * sandCover, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(184, 152, 112, 0.72)';
      ctx.beginPath();
      ctx.ellipse(0, shellSize * 0.24, shellSize * 0.72, shellSize * 0.24 * sandCover, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  });
};

const fillOrganicAnnulus = (ctx, cx, cy, rInner, rOuter, jitter, phase) => {
  const steps = 40;
  ctx.beginPath();
  traceOrganicRing(ctx, cx, cy, rOuter, jitter, phase, false);
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const angle = t * Math.PI * 2;
    const waveA = Math.sin(angle * 3 + phase * 0.06) * jitter * 0.82;
    const waveB = Math.cos(angle * 5 - phase * 0.04) * jitter * 0.36;
    const r = rInner + waveA + waveB;
    ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
  }
  ctx.closePath();
};

const OotleSandboxGame = ({ user }) => {
  const { btcUsd } = useBtcPrice();
  const btcPrice = Number(btcUsd) > 0 ? Number(btcUsd) : 0;
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const isCompactMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();
  const canvasRef = useRef(null);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [gameState, setGameState] = useState('idle'); // idle, paying, playing, revealing, completed
  const [gameSession, setGameSession] = useState(null);
  const [revealedItem, setRevealedItem] = useState(null);
  const [error, setError] = useState(null);
  const [diggingProgress, setDiggingProgress] = useState(0);
  const [isDigging, setIsDigging] = useState(false);
  const [digMarks, setDigMarks] = useState([]);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const cursorPosRef = useRef({ x: 0, y: 0 });
  const [lastCursorPos, setLastCursorPos] = useState({ x: 0, y: 0 });
  const [seashells, setSeashells] = useState([]);
  const animationFrameRef = useRef(null);
  const completeInFlightRef = useRef(false);
  const spriteRef = useRef({
    shovel: null,
    shells: []
  });
  const sandPatternRef = useRef(null);
  const sandParticlesRef = useRef([]);
  const revealFlashRef = useRef(0);
  const gameStateRef = useRef(gameState);
  const diggingProgressRef = useRef(0);
  const digMarksRef = useRef([]);
  const seashellsRef = useRef([]);
  const digStepRef = useRef(0);
  const toolPoseRef = useRef({ x: CANVAS_W / 2, y: CANVAS_H / 2, angle: -0.9 });
  const replayRef = useRef({ startedAt: 0, events: [] });
  const toolMotionRef = useRef({ velocity: 0, lastMoveAt: 0 });
  const idlePreviewRef = useRef(null);
  const [winRevealReady, setWinRevealReady] = useState(false);
  const [lastReplayAt, setLastReplayAt] = useState(null);
  const [showVouchers, setShowVouchers] = useState(false);
  const [vouchers, setVouchers] = useState([]);
  const [vouchersLoading, setVouchersLoading] = useState(false);
  const [walletBalance, setWalletBalance] = useState(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('wallet');
  const [selectedVaultItemId, setSelectedVaultItemId] = useState('');
  const [spritesReady, setSpritesReady] = useState(false);
  const [sandboxDebug] = useState(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('sandboxDebug') === '1';
  });
  const hasTouchInput = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
  const isBrowser = typeof window !== 'undefined';
  const reportSandboxIssue = (message, err) => {
    if (sandboxDebug) {
      console.error(message, err);
    }
  };

  const resetReplay = () => {
    replayRef.current = { startedAt: 0, events: [] };
  };

  const appendReplayEvent = (type, payload = {}) => {
    if (!isBrowser) return;
    const now = Date.now();
    if (!replayRef.current.startedAt) replayRef.current.startedAt = now;
    replayRef.current.events.push({
      t: now - replayRef.current.startedAt,
      type,
      ...payload
    });
    if (replayRef.current.events.length > 5000) {
      replayRef.current.events = replayRef.current.events.slice(-5000);
    }
  };

  const persistReplay = (status = 'completed') => {
    if (!isBrowser || replayRef.current.events.length === 0) return;
    const snapshot = {
      savedAt: new Date().toISOString(),
      status,
      sessionId: gameSession?.gameId || null,
      events: replayRef.current.events
    };
    try {
      window.localStorage.setItem('sandboxReplay:last', JSON.stringify(snapshot));
      setLastReplayAt(Date.now());
      if (sandboxDebug) console.info('[Sandbox Replay] saved', snapshot);
    } catch (err) {
      reportSandboxIssue('Failed to persist sandbox replay', err);
    }
  };

  const copyLastReplay = async () => {
    if (!isBrowser) return;
    try {
      const replay = window.localStorage.getItem('sandboxReplay:last');
      if (!replay) return;
      await navigator.clipboard.writeText(replay);
      setLastReplayAt(Date.now());
    } catch (err) {
      reportSandboxIssue('Failed to copy sandbox replay', err);
    }
  };

  useEffect(() => {
    let mounted = true;
    const loadImage = (src) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      });

    const loadEraShell = async (src) => {
      const raw = await loadImage(src);
      if (!raw) return null;
      return processEraShellSprite(raw);
    };

    Promise.all([
      loadImage('/images/sandbox/shovel-pro-v5.svg?v=20260527'),
      loadEraShell('/images/sandbox/era-shell-1.png?v=20260527'),
      loadEraShell('/images/sandbox/era-shell-2.png?v=20260527'),
      loadEraShell('/images/sandbox/era-shell-3.png?v=20260527'),
      loadEraShell('/images/sandbox/era-shell-4.png?v=20260527')
    ]).then(([shovel, era1, era2, era3, era4]) => {
      if (!mounted) return;
      spriteRef.current = {
        shovel,
        shells: [era1, era2, era3, era4].filter(Boolean)
      };
      setSpritesReady(true);
    });

    return () => {
      mounted = false;
    };
  }, []);
  
  // Fetch game settings
  useEffect(() => {
    fetchSettings();
    if (user) {
      fetchVouchers();
      fetchWalletBalance();
    } else {
      setWalletBalance(null);
    }
  }, [user]);

  useEffect(() => {
    gameStateRef.current = gameState;
    if (gameState === 'completed') {
      setWinRevealReady(false);
      const t = requestAnimationFrame(() => setWinRevealReady(true));
      return () => cancelAnimationFrame(t);
    }
    setWinRevealReady(false);
    return undefined;
  }, [gameState, revealedItem]);

  useEffect(() => {
    diggingProgressRef.current = diggingProgress;
  }, [diggingProgress]);

  useEffect(() => {
    digMarksRef.current = digMarks;
  }, [digMarks]);

  useEffect(() => {
    seashellsRef.current = seashells;
  }, [seashells]);

  useEffect(() => {
    if (diggingProgress >= 99.5 && gameState === 'playing') {
      revealFlashRef.current = 1;
    }
  }, [diggingProgress, gameState]);

  const drawIdlePreview = (ctx) => {
    const canvas = ctx.canvas;
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const horizon = canvas.height * HORIZON_Y;
    const centerX = canvas.width / 2;
    const centerY = horizon + (canvas.height - horizon) * 0.52;

    drawSceneBackdrop(ctx);
    const gradient = ctx.createLinearGradient(0, horizon, 0, canvas.height);
    gradient.addColorStop(0, '#efe4cf');
    gradient.addColorStop(0.5, '#e2d2b4');
    gradient.addColorStop(1, '#d4c4a2');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, horizon, canvas.width, canvas.height - horizon);

    if (sandPatternRef.current) {
      ctx.save();
      ctx.globalAlpha = 0.32;
      ctx.fillStyle = sandPatternRef.current;
      ctx.fillRect(0, horizon, canvas.width, canvas.height - horizon);
      ctx.restore();
    }

    ctx.save();
    ctx.strokeStyle = 'rgba(30, 41, 59, 0.12)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(14, horizon + 10, canvas.width - 28, canvas.height - horizon - 24, 14);
    ctx.stroke();

    const hintR = 42;
    ctx.setLineDash([6, 8]);
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, hintR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    const shovel = spriteRef.current.shovel;
    if (shovel) {
      ctx.save();
      ctx.translate(centerX + 52, centerY - 36);
      ctx.rotate(-0.5);
      ctx.globalAlpha = 0.85;
      ctx.drawImage(shovel, -28, -84, 56, 112);
      ctx.restore();
    }

    ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
    ctx.beginPath();
    ctx.roundRect(centerX - 128, centerY + 58, 256, 40, 10);
    ctx.fill();
    ctx.font = '600 14px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText('Press Play, then drag to dig', centerX, centerY + 78);
    ctx.restore();
  };

  useEffect(() => {
    if (gameState !== 'idle' || !idlePreviewRef.current) return;
    const canvas = idlePreviewRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawIdlePreview(ctx);
  }, [gameState, settings, spritesReady]);

  const fetchWalletBalance = async () => {
    if (!user) return;
    setWalletLoading(true);
    try {
      const response = await fetch('/api/ootle/games/state', { credentials: 'include' });
      const data = await response.json();
      if (response.ok && data.success && data.data) {
        setWalletBalance({ balance: data.data.tari, availableBalance: data.data.tari, currency: 'tTARI' });
      }
    } catch (err) {
      reportSandboxIssue('Error fetching wallet balance:', err);
    } finally {
      setWalletLoading(false);
    }
  };
  
  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/ootle/sandbox/settings');
      const data = await response.json();
      setSettings(data);
      setLoading(false);
    } catch (err) {
      reportSandboxIssue('Error fetching game settings:', err);
      setError('Failed to load game settings');
      setLoading(false);
    }
  };
  
  const fetchVouchers = async () => {
    setVouchersLoading(true);
    try {
      const response = await fetch('/api/ootle/sandbox/my-vouchers', {
        credentials: 'include'
      });
      const data = await response.json();
      const rows = Array.isArray(data.vouchers) ? data.vouchers : [];
      rows.sort((a, b) => {
        const aTs = Date.parse(a?.issuedAt || '') || 0;
        const bTs = Date.parse(b?.issuedAt || '') || 0;
        return bTs - aTs;
      });
      setVouchers(rows);
    } catch (err) {
      reportSandboxIssue('Error fetching vouchers:', err);
    } finally {
      setVouchersLoading(false);
    }
  };

  const getVoucherDisplayImage = (voucher) => {
    const details = voucher?.itemDetails || {};
    return withThumbWidth(getInventoryDisplayImageUrl({
      marketHashName: voucher?.itemName || '',
      imageUrl: details.imageUrl || '',
      iconUrl: details.imageUrl || '',
      classId: details.classId ?? details.classid ?? null,
      rarity: details.rarity || '',
      marketPrice: details.marketPrice || 0,
      lastUpdated: voucher?.issuedAt || ''
    }), 256);
  };

  const handleCopyVoucherCode = async (voucherCode) => {
    if (!voucherCode) return;
    try {
      await navigator.clipboard.writeText(voucherCode);
    } catch (err) {
      reportSandboxIssue('Failed to copy voucher code:', err);
    }
  };
  
  // Initialize canvas and pre-generate static seashells
  useEffect(() => {
    if (!canvasRef.current || (gameState !== 'playing' && gameState !== 'revealing')) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    sandParticlesRef.current = [];
    
    // Pre-generate shells assigned to fold radii so they emerge with crater growth.
    const initialShells = [];
    const centerX = canvas.width / 2;
    const centerY = canvas.height * HORIZON_Y + (canvas.height - canvas.height * HORIZON_Y) * 0.52;

    const maxHoleRadiusInit = Math.min(canvas.width, canvas.height - canvas.height * HORIZON_Y) * 0.42;
    const shellCount = 10;
    const angleOffset = (Math.random() - 0.5) * 0.5;
    for (let i = 0; i < shellCount; i++) {
      const baseAngle = (Math.PI * 2 * i) / shellCount - Math.PI / 2 + angleOffset + (Math.random() - 0.5) * 0.12;
      const ringT = 0.2 + (i / (shellCount - 1)) * 0.72 + (Math.random() - 0.5) * 0.025;
      const buriedRadius = ringT * maxHoleRadiusInit;

      initialShells.push({
        x: centerX,
        y: centerY,
        angle: baseAngle,
        baseAngle,
        ringT,
        ringRadius: buriedRadius,
        tilt: (Math.random() - 0.5) * 0.6,
        rotation: (Math.random() - 0.5) * 0.08,
        sizeMultiplier: 0.96 + (i % 3) * 0.03,
        hidden: false,
        detached: false,
        orderIndex: i,
        revealProgress: 0,
        buriedDepth: 1,
        sandCover: 1,
        fallProgress: 0,
        shellIndex: i % 4
      });
    }
    
    seashellsRef.current = initialShells;
    setSeashells(initialShells);

    let lastUpdate = Date.now();
    const updatePhysics = () => {
      const now = Date.now();
      const deltaTime = Math.min(48, now - lastUpdate);
      lastUpdate = now;

      if (sandParticlesRef.current.length > 0) {
        sandParticlesRef.current = sandParticlesRef.current
          .map((p) => {
            const isDust = p.type === 'dust';
            const drag = isDust ? 0.9 : 0.94;
            const gravity = isDust ? 0.05 : 0.16;
            return {
              ...p,
              x: p.x + p.vx,
              y: p.y + p.vy,
              vx: p.vx * drag,
              vy: p.vy * drag + gravity,
              life: p.life - (isDust ? 0.05 : 0.032),
              rot: (p.rot || 0) + (isDust ? 0.02 : 0.06)
            };
          })
          .filter((p) => p.life > 0);
      }

      const maxHoleRadius = Math.min(canvas.width, canvas.height - canvas.height * HORIZON_Y) * 0.42;
      const digProgress = diggingProgressRef.current;
      const holeRadius = (digProgress / 100) * maxHoleRadius;
      const holeT = holeRadius / maxHoleRadius;
      const shells = seashellsRef.current;
      if (!shells.length) return;

      const next = [];
      for (let i = 0; i < shells.length; i++) {
        const shell = shells[i];
        const ringT = shell.ringT ?? 0.5;
        const targetReveal = smoothstep((holeT - ringT + 0.03) / 0.12);
        const smoothedReveal = easeToward(shell.revealProgress || 0, targetReveal, deltaTime, 900);
        const sandCover = Math.max(0, Math.pow(1 - smoothedReveal, 1.35));

        if (!shell.detached) {
          next.push({
            ...shell,
            revealProgress: smoothedReveal,
            buriedDepth: Math.max(0, 1 - smoothstep(smoothedReveal)),
            sandCover
          });
          continue;
        }

        const centerX = canvas.width / 2;
        const centerY = canvas.height * HORIZON_Y + (canvas.height - canvas.height * HORIZON_Y) * 0.52;
        const dx = shell.x - centerX;
        const dy = shell.y - centerY;
        const distFromCenter = Math.hypot(dx, dy);
        if (distFromCenter < 20 && digProgress > 97) continue;

        const angle = Math.atan2(dy, dx);
        const pullStrength = 0.35 * (deltaTime / 16);
        const fallReveal = easeToward(shell.revealProgress || 0, 1, deltaTime, 320);
        next.push({
          ...shell,
          x: shell.x - Math.cos(angle) * pullStrength,
          y: shell.y - Math.sin(angle) * pullStrength,
          revealProgress: fallReveal,
          buriedDepth: Math.max(0, 1 - smoothstep(fallReveal)),
          sandCover: Math.max(0, 1 - fallReveal),
          fallProgress: Math.min(1, shell.fallProgress + 0.01 * (deltaTime / 16))
        });
      }
      seashellsRef.current = next;
    };
    
    // Animation loop for continuous redrawing
    const animate = () => {
      if (revealFlashRef.current > 0) {
        revealFlashRef.current = Math.max(0, revealFlashRef.current - 0.028);
      }
      updatePhysics();
      drawSandbox(ctx);
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    animate();
    
    // Add event listeners for digging (passive: false to allow preventDefault)
    const handleDigStartWrapper = (e) => {
      e.preventDefault();
      handleDigStart(e);
    };
    
    const handleDigMoveWrapper = (e) => {
      e.preventDefault();
      handleDigMove(e);
    };
    
    const handleDigEndWrapper = (e) => {
      e.preventDefault();
      handleDigEnd(e);
    };
    
    canvas.addEventListener('pointerdown', handleDigStartWrapper);
    canvas.addEventListener('pointermove', handleDigMoveWrapper);
    canvas.addEventListener('pointerup', handleDigEndWrapper);
    canvas.addEventListener('pointercancel', handleDigEndWrapper);
    canvas.addEventListener('pointerleave', handleDigEndWrapper);
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      canvas.removeEventListener('pointerdown', handleDigStartWrapper);
      canvas.removeEventListener('pointermove', handleDigMoveWrapper);
      canvas.removeEventListener('pointerup', handleDigEndWrapper);
      canvas.removeEventListener('pointercancel', handleDigEndWrapper);
      canvas.removeEventListener('pointerleave', handleDigEndWrapper);
    };
  }, [gameState]);
  
  // Helper to darken colors
  const darkenColor = (hex, percent) => {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, ((num >> 16) & 0xff) - percent);
    const g = Math.max(0, ((num >> 8) & 0xff) - percent);
    const b = Math.max(0, (num & 0xff) - percent);
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  };
  
  const drawSceneBackdrop = (ctx) => {
    const canvas = ctx.canvas;
    const horizon = canvas.height * HORIZON_Y;

    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#1d4ed8');
    sky.addColorStop(0.45, '#3b82f6');
    sky.addColorStop(1, '#93c5fd');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, horizon + 2);

    const sunX = canvas.width * 0.78;
    const sunY = horizon * 0.42;
    const sunGlow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 56);
    sunGlow.addColorStop(0, 'rgba(255, 248, 220, 0.95)');
    sunGlow.addColorStop(0.45, 'rgba(255, 235, 180, 0.35)');
    sunGlow.addColorStop(1, 'rgba(255, 235, 180, 0)');
    ctx.fillStyle = sunGlow;
    ctx.beginPath();
    ctx.arc(sunX, sunY, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 252, 240, 0.92)';
    ctx.beginPath();
    ctx.arc(sunX, sunY, 18, 0, Math.PI * 2);
    ctx.fill();

    // Layered drifting clouds with low/high altitude motion.
    const now = Date.now();
    const cloudLayers = [
      { y: horizon * 0.24, speed: 0.014, alpha: 0.2, scale: 0.92, seed: 0.16 },
      { y: horizon * 0.43, speed: 0.01, alpha: 0.24, scale: 1.08, seed: 0.44 },
      { y: horizon * 0.61, speed: 0.016, alpha: 0.18, scale: 0.96, seed: 0.72 }
    ];
    cloudLayers.forEach((layer, layerIndex) => {
      const clusterSpacing = 190 * layer.scale;
      for (let cluster = -2; cluster <= 4; cluster++) {
        const driftBase = ((now * layer.speed + cluster * clusterSpacing) % (canvas.width + clusterSpacing * 2)) - clusterSpacing;
        const cx = driftBase + canvas.width * layer.seed;
        const blobCount = 4;
        for (let blob = 0; blob < blobCount; blob++) {
          const offsetX = (blob - 1.5) * 24 * layer.scale;
          const wobble = Math.sin((now * 0.0013) + (cluster * 0.8) + blob) * 3;
          const puffX = cx + offsetX + wobble;
          const puffY = layer.y + Math.cos((cluster + blob) * 0.7) * (5 + layerIndex * 2);
          const rx = (26 + blob * 7) * layer.scale;
          const ry = (10 + blob * 2.6) * layer.scale;
          const cloudGrad = ctx.createRadialGradient(puffX, puffY, 2, puffX, puffY, rx);
          cloudGrad.addColorStop(0, `rgba(255, 255, 255, ${layer.alpha})`);
          cloudGrad.addColorStop(0.58, `rgba(255, 255, 255, ${layer.alpha * 0.52})`);
          cloudGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
          ctx.fillStyle = cloudGrad;
          ctx.beginPath();
          ctx.ellipse(puffX, puffY, rx, ry, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });

    // Thin high-altitude streaks for extra realism.
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const streakW = canvas.width * (0.22 + i * 0.08);
      const streakX = (((now * (0.0062 + i * 0.0018)) % (canvas.width + streakW * 2)) - streakW) + (i * 64);
      const streakY = horizon * (0.16 + i * 0.12);
      const streakGrad = ctx.createLinearGradient(streakX, streakY, streakX + streakW, streakY + 4);
      streakGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
      streakGrad.addColorStop(0.5, `rgba(255, 255, 255, ${0.08 - i * 0.016})`);
      streakGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = streakGrad;
      ctx.fillRect(streakX, streakY, streakW, 10);
    }
    ctx.restore();

    const water = ctx.createLinearGradient(0, horizon - 4, 0, horizon + 28);
    water.addColorStop(0, 'rgba(37, 99, 235, 0.45)');
    water.addColorStop(1, 'rgba(59, 130, 246, 0.15)');
    ctx.fillStyle = water;
    ctx.fillRect(0, horizon - 4, canvas.width, 32);
  };

  const drawSandbox = (ctx) => {
    const canvas = ctx.canvas;
    const horizon = canvas.height * HORIZON_Y;
    const centerX = canvas.width / 2;
    const centerY = horizon + (canvas.height - horizon) * 0.52;
    const maxHoleRadius = Math.min(canvas.width, canvas.height - horizon) * 0.42;
    const digProgress = diggingProgressRef.current;
    const digMarksSnapshot = digMarksRef.current;

    drawSceneBackdrop(ctx);
    
    // Sand playfield
    const gradient = ctx.createLinearGradient(0, horizon, 0, canvas.height);
    gradient.addColorStop(0, '#efe4cf');
    gradient.addColorStop(0.35, '#e6d6b8');
    gradient.addColorStop(0.72, '#dcc9a4');
    gradient.addColorStop(1, '#d0bc96');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, horizon, canvas.width, canvas.height - horizon);

    // Sand texture pattern (cached once).
    if (!sandPatternRef.current) {
      const tex = document.createElement('canvas');
      tex.width = 256;
      tex.height = 256;
      const tctx = tex.getContext('2d');
      if (tctx) {
        tctx.fillStyle = '#d8c4a0';
        tctx.fillRect(0, 0, tex.width, tex.height);
        for (let i = 0; i < 2400; i++) {
          const x = Math.random() * tex.width;
          const y = Math.random() * tex.height;
          const r = 0.2 + Math.random() * 1.3;
          const shade = 144 + Math.random() * 52;
          tctx.fillStyle = `rgba(${shade + 18}, ${shade + 1}, ${shade - 30}, ${0.06 + Math.random() * 0.12})`;
          tctx.beginPath();
          tctx.arc(x, y, r, 0, Math.PI * 2);
          tctx.fill();
        }
        for (let i = 0; i < 7; i++) {
          const gx = Math.random() * tex.width;
          const gy = Math.random() * tex.height;
          const grad = tctx.createRadialGradient(gx, gy, 0, gx, gy, 60 + Math.random() * 40);
          grad.addColorStop(0, 'rgba(255, 235, 199, 0.10)');
          grad.addColorStop(1, 'rgba(255, 235, 199, 0)');
          tctx.fillStyle = grad;
          tctx.fillRect(0, 0, tex.width, tex.height);
        }
      }
      sandPatternRef.current = ctx.createPattern(tex, 'repeat');
    }
    if (sandPatternRef.current) {
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = sandPatternRef.current;
      ctx.fillRect(0, horizon, canvas.width, canvas.height - horizon);
      ctx.restore();
    }

    // Soft depth tint (gradient bands, no stroke lines).
    const sandDepth = canvas.height - horizon;
    const depthWash = ctx.createLinearGradient(0, horizon, 0, canvas.height);
    depthWash.addColorStop(0, 'rgba(255, 248, 230, 0.06)');
    depthWash.addColorStop(0.45, 'rgba(0, 0, 0, 0)');
    depthWash.addColorStop(1, 'rgba(72, 52, 30, 0.07)');
    ctx.fillStyle = depthWash;
    ctx.fillRect(0, horizon, canvas.width, sandDepth);

    const vignette = ctx.createRadialGradient(
      centerX,
      centerY,
      Math.min(canvas.width, canvas.height) * 0.25,
      centerX,
      centerY,
      Math.max(canvas.width, canvas.height) * 0.78
    );
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(15, 23, 42, 0.08)');
    ctx.save();
    ctx.fillStyle = vignette;
    ctx.fillRect(0, horizon, canvas.width, canvas.height - horizon);
    ctx.restore();
    
    // Draw organic excavation cavity.
    if (digProgress > 0) {
      const currentRadius = (digProgress / 100) * maxHoleRadius;
      const pulse = Math.sin(Date.now() / 400) * 1.2;
      const rimRadius = currentRadius * 1.08;

      // Displaced sand around excavation.
      ctx.save();
      ctx.globalAlpha = 0.95;
      const displacedGradient = ctx.createRadialGradient(centerX, centerY, currentRadius * 0.65, centerX, centerY, rimRadius * 1.2);
      displacedGradient.addColorStop(0, 'rgba(145, 111, 67, 0.04)');
      displacedGradient.addColorStop(0.7, 'rgba(130, 96, 55, 0.24)');
      displacedGradient.addColorStop(1, 'rgba(98, 70, 36, 0.06)');
      ctx.fillStyle = displacedGradient;
      ctx.beginPath();
      traceOrganicRing(ctx, centerX, centerY, rimRadius + pulse, Math.max(1.4, currentRadius * 0.03), digProgress);
      ctx.fill();
      ctx.restore();

      // Pit interior — darker floor, lighter walls (directional light from upper-left).
      const cavityGradient = ctx.createRadialGradient(
        centerX - currentRadius * 0.22,
        centerY - currentRadius * 0.24,
        Math.max(4, currentRadius * 0.05),
        centerX + currentRadius * 0.08,
        centerY + currentRadius * 0.06,
        currentRadius * 1.02
      );
      cavityGradient.addColorStop(0, '#1f1208');
      cavityGradient.addColorStop(0.28, '#3d2614');
      cavityGradient.addColorStop(0.62, '#6f4d2c');
      cavityGradient.addColorStop(1, '#a88055');
      ctx.fillStyle = cavityGradient;
      ctx.beginPath();
      traceOrganicRing(ctx, centerX, centerY, currentRadius, Math.max(1.8, currentRadius * 0.03), digProgress);
      ctx.fill();

      // Wall shadow on the right — shallow 3D read.
      ctx.save();
      ctx.beginPath();
      traceOrganicRing(ctx, centerX, centerY, currentRadius, Math.max(1.6, currentRadius * 0.028), digProgress);
      ctx.clip();
      const wallShadow = ctx.createLinearGradient(
        centerX - currentRadius,
        centerY,
        centerX + currentRadius * 1.1,
        centerY
      );
      wallShadow.addColorStop(0, 'rgba(0, 0, 0, 0)');
      wallShadow.addColorStop(0.55, 'rgba(0, 0, 0, 0)');
      wallShadow.addColorStop(1, 'rgba(12, 8, 4, 0.36)');
      ctx.fillStyle = wallShadow;
      ctx.fillRect(centerX - currentRadius * 1.2, centerY - currentRadius * 1.2, currentRadius * 2.6, currentRadius * 2.6);
      ctx.restore();

      // Subtle inner shading (filled rings only — no visible stroke lines).
      for (let i = 1; i <= 2; i++) {
        const depthR = currentRadius * (1 - i * 0.22);
        if (depthR < 14) continue;
        ctx.save();
        ctx.globalAlpha = 0.07 + i * 0.04;
        ctx.fillStyle = i === 1 ? 'rgba(18, 10, 5, 0.35)' : 'rgba(28, 18, 10, 0.2)';
        ctx.beginPath();
        traceOrganicRing(ctx, centerX, centerY, depthR, Math.max(0.6, depthR * 0.012), digProgress);
        ctx.fill();
        ctx.restore();
      }

      drawEmergingShells(ctx, {
        centerX,
        centerY,
        maxHoleRadius,
        currentHoleRadius: currentRadius,
        shells: seashellsRef.current,
        shellSprites: spriteRef.current.shells
      });

      // Raised sand berm (annulus) — covers lower portion of emerging shells.
      if (currentRadius > 10) {
        const innerBerm = currentRadius * 0.9;
        const outerBerm = currentRadius * 1.13 + pulse * 0.4;
        const bermGrad = ctx.createLinearGradient(
          centerX - outerBerm,
          centerY - outerBerm * 0.5,
          centerX + outerBerm * 0.6,
          centerY + outerBerm
        );
        bermGrad.addColorStop(0, '#efe2c8');
        bermGrad.addColorStop(0.45, '#e2cfa8');
        bermGrad.addColorStop(1, '#c4a574');
        ctx.fillStyle = bermGrad;
        fillOrganicAnnulus(
          ctx,
          centerX,
          centerY,
          innerBerm,
          outerBerm,
          Math.max(1.2, currentRadius * 0.025),
          digProgress
        );
        ctx.fill();
      }

      const hintRaw = Math.max(0, Math.min(1, (digProgress - 58) / 38));
      const hintStrength = smoothstep(hintRaw);
      if (hintStrength > 0.02 && currentRadius > 18) {
        const pulse = 0.94 + Math.sin(Date.now() / 520) * 0.04;
        const glowR = (14 + hintStrength * 18) * pulse;
        ctx.save();
        ctx.globalAlpha = hintStrength * 0.42;
        const hintGlow = ctx.createRadialGradient(
          centerX,
          centerY + 4,
          0,
          centerX,
          centerY,
          glowR * 1.4
        );
        hintGlow.addColorStop(0, 'rgba(251, 191, 36, 0.35)');
        hintGlow.addColorStop(0.45, 'rgba(217, 119, 6, 0.18)');
        hintGlow.addColorStop(1, 'rgba(120, 53, 15, 0)');
        ctx.fillStyle = hintGlow;
        ctx.beginPath();
        ctx.arc(centerX, centerY, glowR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      if (digProgress > 78) {
        const glintOpacity = smoothstep((digProgress - 78) / 18) * 0.22;
        ctx.save();
        ctx.globalAlpha = glintOpacity;
        const phase = Date.now() / 600;
        const sparkleSize = 12 + Math.sin(phase * 0.9) * 3;
        const glintGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, sparkleSize);
        glintGradient.addColorStop(0, 'rgba(251, 191, 36, 0.55)');
        glintGradient.addColorStop(0.6, 'rgba(217, 119, 6, 0.15)');
        glintGradient.addColorStop(1, 'rgba(120, 53, 15, 0)');
        ctx.fillStyle = glintGradient;
        ctx.beginPath();
        ctx.arc(centerX, centerY, sparkleSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    const flash = revealFlashRef.current;
    const isRevealing = gameStateRef.current === 'revealing';
    if (flash > 0 || isRevealing) {
      const strength = isRevealing
        ? 0.35 + Math.sin(Date.now() / 180) * 0.15
        : flash * 0.85;
      ctx.save();
      ctx.globalAlpha = strength;
      const burst = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxHoleRadius * 1.15);
      burst.addColorStop(0, 'rgba(191, 219, 254, 0.9)');
      burst.addColorStop(0.4, 'rgba(59, 130, 246, 0.35)');
      burst.addColorStop(1, 'rgba(37, 99, 235, 0)');
      ctx.fillStyle = burst;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
    
    // Minimal dig cursor
    const pointer = cursorPosRef.current;
    if (pointer.x > 0 && pointer.y > 0 && digProgress > 0 && digProgress < 100) {
      ctx.save();
      ctx.translate(pointer.x, pointer.y);
      ctx.fillStyle = 'rgba(30, 41, 59, 0.55)';
      ctx.beginPath();
      ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.75)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    
    if (digProgress > 0 && digProgress < 100 && gameStateRef.current === 'playing') {
      ctx.save();
      
      // Follow cursor when available, otherwise bias toward center.
      const targetX = pointer.x > 0 ? pointer.x : centerX + 30;
      const targetY = pointer.y > 0 ? pointer.y : centerY - 45;
      const pose = toolPoseRef.current;
      pose.x += (targetX - pose.x) * 0.24;
      pose.y += (targetY - pose.y) * 0.24;

      const xInfluence = Math.max(-1, Math.min(1, (pose.x - centerX) / 220));
      const intendedAngle = -0.92 + xInfluence * 0.26;
      const timeNow = Date.now();
      const elapsed = timeNow - (toolMotionRef.current.lastMoveAt || 0);
      const motionDecay = Math.max(0, 1 - (elapsed / 420));
      const motionBoost = Math.min(1, (toolMotionRef.current.velocity || 0) / 34) * motionDecay;
      const microTilt = Math.sin(timeNow / 180) * 0.04 * motionBoost;
      const targetAngle = intendedAngle + microTilt;
      pose.angle += (targetAngle - pose.angle) * 0.18;

      ctx.translate(pose.x, pose.y);
      ctx.rotate(pose.angle);
      ctx.scale(1 + motionBoost * 0.03, 1 - motionBoost * 0.02);
      
      ctx.shadowColor = 'rgba(0, 0, 0, 0.12)';
      ctx.shadowBlur = 1.5;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 1;

      const shovel = spriteRef.current.shovel;
      if (shovel) {
        // Keep true aspect ratio so the shovel silhouette stays correct.
        // Offsets are tuned so the blade tip tracks the dig point naturally.
        ctx.drawImage(shovel, -58, -96, 116, 116);
      } else {
        ctx.fillStyle = '#3f230d';
        ctx.fillRect(-5, -44, 10, 56);
      }
      
      ctx.restore();
    }

    if (sandParticlesRef.current.length > 0) {
      sandParticlesRef.current.forEach((p) => {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot || 0);
        const alpha = p.life * (p.type === 'dust' ? 0.45 : 0.82);
        ctx.globalAlpha = alpha;
        const r = p.size * (0.55 + p.life * 0.45);
        const grain = `rgba(${168 + p.shade}, ${140 + p.shade}, ${96 + p.shade}, 1)`;
        if (p.type === 'dust') {
          ctx.fillStyle = grain;
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = grain;
          ctx.beginPath();
          ctx.ellipse(0, 0, r * 1.35, r * 0.75, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      });
    }

    if (sandboxDebug) {
      const hasCursor = pointer.x > 0 && pointer.y > 0;
      const shovelX = hasCursor ? toolPoseRef.current.x : centerX + 30;
      const shovelY = hasCursor ? toolPoseRef.current.y : centerY - 45;

      ctx.save();
      ctx.fillStyle = 'rgba(8, 23, 48, 0.78)';
      ctx.fillRect(10, canvas.height - 64, 320, 54);
      ctx.font = '12px monospace';
      ctx.fillStyle = '#9fe5ff';
      ctx.fillText(`cursor: ${Math.round(pointer.x)}, ${Math.round(pointer.y)}`, 18, canvas.height - 42);
      ctx.fillText(`shovelAnchor: ${Math.round(shovelX)}, ${Math.round(shovelY)}`, 18, canvas.height - 24);

      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(shovelX, shovelY, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(shovelX - 12, shovelY);
      ctx.lineTo(shovelX + 12, shovelY);
      ctx.moveTo(shovelX, shovelY - 12);
      ctx.lineTo(shovelX, shovelY + 12);
      ctx.stroke();
      ctx.restore();
    }
  };
  
  const handleDigStart = (e) => {
    if (gameState !== 'playing') return;
    e.preventDefault();
    setIsDigging(true);

    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
      const y = (e.clientY || e.touches?.[0]?.clientY) - rect.top;
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const canvasX = x * scaleX;
      const canvasY = y * scaleY;
      setLastCursorPos({ x: canvasX, y: canvasY });
      cursorPosRef.current = { x: canvasX, y: canvasY };
      appendReplayEvent('pointer_down', { x: Math.round(canvasX), y: Math.round(canvasY), progress: Math.round(diggingProgress) });
      digStepRef.current += 1;
    }
    
    // Start digging immediately on pointer down.
    setDiggingProgress(prev => {
      const next = Math.min(100, prev + 0.8);
      diggingProgressRef.current = next;
      return next;
    });
  };
  
  const handleDigMove = (e) => {
    e.preventDefault();
    
    if (gameState !== 'playing') return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
    const y = (e.clientY || e.touches?.[0]?.clientY) - rect.top;
    
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = x * scaleX;
    const canvasY = y * scaleY;
    
    // Calculate distance moved since last position
    const distanceMoved = Math.sqrt(
      Math.pow(canvasX - lastCursorPos.x, 2) + 
      Math.pow(canvasY - lastCursorPos.y, 2)
    );
    
    // Require more dragging distance before registering (slower, more deliberate)
    if (distanceMoved < 15) return;
    
    // Update cursor positions
    setLastCursorPos({ x: canvasX, y: canvasY });
    cursorPosRef.current = { x: canvasX, y: canvasY };
    digStepRef.current += 1;

    setDigMarks((prev) => {
      const mark = { x: canvasX, y: canvasY, t: Date.now(), radius: 2 + Math.random() * 3.2 };
      const next = [...prev, mark];
      return next.length > 56 ? next.slice(-56) : next;
    });

    const horizonY = canvas.height * HORIZON_Y;
    const pitCenterX = canvas.width / 2;
    const pitCenterY = horizonY + (canvas.height - horizonY) * 0.52;
    const pitMaxR = Math.min(canvas.width, canvas.height - horizonY) * 0.42;
    const pitRadius = (diggingProgressRef.current / 100) * pitMaxR;
    spawnExcavationDebris(sandParticlesRef.current, canvasX, canvasY, pitCenterX, pitCenterY, pitRadius);
    
    // Trigger shovel motion on movement
    toolMotionRef.current.velocity = Math.min(60, distanceMoved);
    toolMotionRef.current.lastMoveAt = Date.now();
    appendReplayEvent('pointer_move', {
      x: Math.round(canvasX),
      y: Math.round(canvasY),
      v: Math.round(distanceMoved),
      progress: Math.round(diggingProgress)
    });
    
    // Increase digging progress slower (more dragging required)
    setDiggingProgress(prev => {
      const next = Math.min(100, prev + 0.3);
      diggingProgressRef.current = next;
      return next;
    });
  };
  
  const handleDigEnd = (e) => {
    e.preventDefault();
    setIsDigging(false);
    toolMotionRef.current.velocity = (toolMotionRef.current.velocity || 0) * 0.5;
    appendReplayEvent('pointer_up', { progress: Math.round(diggingProgress) });
  };
  
  const startGame = async () => {
    if (!user) {
      setError('Please log in to play');
      return;
    }
    
    setGameState('paying');
    setError(null);
    resetReplay();
    appendReplayEvent('start_click');
    
    try {
      const playBody =
        paymentMethod === 'vault' && selectedVaultItemId
          ? {
              paymentMethod: 'vault',
              vaultItemId: selectedVaultItemId,
              idempotencyKey: `sandbox_${selectedVaultItemId}_${Date.now()}`
            }
          : { paymentMethod: 'wallet' };

      const response = await fetch('/api/ootle/sandbox/play', {
        method: 'POST',
        headers: csrfHeaders({ 'Content-Type': 'application/json' }),
        credentials: 'include',
        body: JSON.stringify(playBody)
      });
      
      let data = await response.json();

      if (
        !response.ok &&
        response.status === 400 &&
        data?.canAbandon &&
        /active sandbox game/i.test(String(data?.error || ''))
      ) {
        const abandonRes = await fetch('/api/ootle/sandbox/abandon', {
          method: 'POST',
          headers: csrfHeaders({ 'Content-Type': 'application/json' }),
          credentials: 'include'
        });
        if (abandonRes.ok) {
          const retryRes = await fetch('/api/ootle/sandbox/play', {
            method: 'POST',
            headers: csrfHeaders({ 'Content-Type': 'application/json' }),
            credentials: 'include',
            body: JSON.stringify(playBody)
          });
          data = await retryRes.json();
          if (!retryRes.ok) {
            throw new Error(data.error || 'Failed to start game');
          }
        } else {
          throw new Error(data.error || 'Failed to start game');
        }
      } else if (!response.ok) {
        throw new Error(data.error || 'Failed to start game');
      }
      
      setGameSession({
        gameId: data.gameId,
        gameToken: data.gameToken,
        serverSeedHash: data.serverSeedHash,
        amount: data.amount,
        freePlay: data.freePlay || false
      });
      
      // Show admin free play message
      completeInFlightRef.current = false;
      setGameState('playing');
      setDiggingProgress(0);
      diggingProgressRef.current = 0;
      digStepRef.current = 0;
      toolPoseRef.current = { x: CANVAS_W / 2, y: CANVAS_H / 2, angle: -0.92 };
      appendReplayEvent('play_started');
      fetchWalletBalance();
      
    } catch (err) {
      reportSandboxIssue('Error starting game:', err);
      setError(err.message);
      setGameState('idle');
    }
  };
  
  const completeGame = async () => {
    if (completeInFlightRef.current || gameState !== 'playing' || !gameSession) return;
    completeInFlightRef.current = true;
    setGameState('revealing');
    
    try {
      const response = await fetch('/api/ootle/sandbox/dig', {
        method: 'POST',
        headers: csrfHeaders({ 'Content-Type': 'application/json' }),
        credentials: 'include',
        body: JSON.stringify({
          gameId: gameSession.gameId,
          gameToken: gameSession.gameToken
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        // Client-side drag events can race and attempt one extra completion after the successful one.
        if (response.status === 400 && /completed|invalid status/i.test(String(data?.error || ''))) {
          setGameState('completed');
          return;
        }
        throw new Error(data.error || 'Failed to reveal item');
      }
      
      setRevealedItem(data.item);
      setGameState('completed');
      appendReplayEvent('reveal_success', { item: data?.item?.name || 'unknown' });
      persistReplay('completed');

      fetchVouchers();
      fetchWalletBalance();
      
    } catch (err) {
      reportSandboxIssue('Error completing game:', err);
      setError(err.message);
      setGameState('idle');
      completeInFlightRef.current = false;
      appendReplayEvent('reveal_error', { message: String(err?.message || 'unknown') });
      persistReplay('error');
    }
  };

  useEffect(() => {
    if (gameState === 'playing' && diggingProgress >= 100) {
      completeGame();
    }
  }, [diggingProgress, gameState, gameSession]);
  
  const resetGame = () => {
    completeInFlightRef.current = false;
    setGameState('idle');
    setGameSession(null);
    setRevealedItem(null);
    setDiggingProgress(0);
    diggingProgressRef.current = 0;
    digStepRef.current = 0;
    setDigMarks([]);
    setSeashells([]);
    sandParticlesRef.current = [];
    cursorPosRef.current = { x: 0, y: 0 };
    setCursorPos({ x: 0, y: 0 });
    setLastCursorPos({ x: 0, y: 0 });
    toolPoseRef.current = { x: CANVAS_W / 2, y: CANVAS_H / 2, angle: -0.92 };
    completeInFlightRef.current = false;
    setError(null);
  };

  const priceUsd = settings?.priceUsd ?? settings?.price ?? 3;
  const priceBtc = settings?.priceBtc ?? null;
  const progressPct = Math.round(Math.max(0, Math.min(100, diggingProgress)));
  const availableBtc = walletBalance?.availableBalance ?? null;
  const needsPaidPlay = user && settings && !settings.isAdminViewer;
  const allowVaultPayment = settings?.allowVaultPayment === true;
  const insufficientBalance =
    needsPaidPlay &&
    paymentMethod === 'wallet' &&
    availableBtc != null &&
    priceBtc != null &&
    availableBtc < priceBtc;
  const vaultPlayBlocked =
    needsPaidPlay && paymentMethod === 'vault' && (!selectedVaultItemId || !allowVaultPayment);
  const mainPanelJustify =
    gameState === 'playing' || gameState === 'revealing' ? 'flex-start' : 'center';

  const getRevealedItemImage = (item) => {
    if (!item) return '/placeholder-item.png';
    return getInventoryDisplayImageUrl({
      marketHashName: item.marketHashName || item.name || '',
      imageUrl: item.imageUrl || '',
      iconUrl: item.imageUrl || item.iconUrl || '',
      classId: item.classId ?? item.classid ?? null,
      lastUpdated: item.lastUpdated || ''
    });
  };
  
  if (loading) {
    return (
      <Box sx={{ ...marketPageShellSx, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress sx={{ color: 'white' }} />
      </Box>
    );
  }

  if (!settings?.playEnabledForCurrentUser) {
    return (
      <Box sx={{ ...marketPageShellSx, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Box sx={{ ...marketContentSx, maxWidth: 720 }}>
          <Alert severity="warning">
            {settings?.globallyEnabled === false && settings?.isAdminViewer && settings?.allowAdminWhenDisabled
              ? 'Sandbox is off for everyone else. You can preview rounds while it stays offline.'
              : 'Sandbox is temporarily unavailable. Please check back later.'}
          </Alert>
        </Box>
      </Box>
    );
  }

  return (
    <>
      <PageSeo
        title="Sandbox: cosmetic digs | Tari DApp"
        description="Pay with tTARI, dig through the sand, and claim a random cosmetic voucher. Testnet play money only."
        path="/sandbox"
      />

      <Box sx={marketPageShellSx}>
        <Box sx={{ ...marketContentSx, maxWidth: '1600px', px: { xs: 0.5, sm: 0 } }}>
          <Paper
            elevation={0}
            sx={{
              mb: 3,
              p: { xs: 1.5, sm: 2.5, md: 3 },
              background: 'rgba(255, 255, 255, 0.12)',
              backdropFilter: 'blur(12px)',
              borderRadius: 3,
              border: '1px solid rgba(255, 255, 255, 0.2)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)'
            }}
          >
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: { xs: 'stretch', sm: 'center' },
                flexDirection: { xs: 'column', sm: 'row' },
                flexWrap: 'wrap',
                gap: { xs: 1.25, sm: 2 }
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1.25, sm: 2 }, flex: 1, minWidth: 0 }}>
                <Box
                  sx={{
                    p: { xs: 1, sm: 1.25 },
                    borderRadius: 2,
                    background: 'rgba(255, 255, 255, 0.15)',
                    border: '1px solid rgba(255, 255, 255, 0.25)'
                  }}
                >
                  <BeachAccess sx={{ color: '#fff', fontSize: 30 }} />
                </Box>
                <Box>
                  <Typography
                    variant={isCompactMobile ? 'h5' : 'h4'}
                    sx={{ ...heroTitleSx, lineHeight: 1.08 }}
                  >
                    Sandbox
                  </Typography>
                  <Typography variant="body2" sx={{ ...heroSubtitleSx, pr: { xs: 0, sm: 1 } }}>
                    Dig for a pretend item drop with tTARI testnet play stacks.
                  </Typography>
                </Box>
              </Box>
              <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap', width: { xs: '100%', sm: 'auto' } }}>
                <Button
                  startIcon={<LocalActivity />}
                  onClick={() => {
                    fetchVouchers();
                    setShowVouchers(true);
                  }}
                  sx={{ ...heroOutlineButtonSx, width: { xs: '100%', sm: 'auto' } }}
                >
                  My Vouchers ({vouchers.length})
                </Button>
              </Box>
            </Box>
          </Paper>

          {error && (
            <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <Grid container spacing={{ xs: 2, md: 3 }} alignItems="stretch">
            <Grid item xs={12} lg={8} sx={{ display: 'flex' }}>
              <Paper
                elevation={0}
                sx={{
                  ...lightPanelPaperSx,
                  p: { xs: 1.25, sm: 2, md: 3 },
                  minHeight: { xs: 380, sm: 500, md: 540 },
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: mainPanelJustify,
                  width: '100%'
                }}
              >
                {gameState === 'idle' && (
                  <Box sx={{ textAlign: 'center', width: '100%', maxWidth: 720, px: { xs: 0.25, sm: 0 } }}>
                    <Box
                      sx={{
                        mb: { xs: 2, sm: 3 },
                        borderRadius: 2,
                        overflow: 'hidden',
                        boxShadow: '0 12px 32px rgba(30, 41, 59, 0.12)',
                        border: '1px solid rgba(30, 41, 59, 0.1)',
                        lineHeight: 0
                      }}
                    >
                      <canvas
                        ref={idlePreviewRef}
                        style={{ display: 'block', width: '100%', maxWidth: CANVAS_W, height: 'auto' }}
                        aria-hidden
                      />
                    </Box>
                    <Typography variant={isCompactMobile ? 'h6' : 'h5'} sx={{ mb: 1, color: PANEL_INK, fontWeight: 700, letterSpacing: '-0.02em' }}>
                      Start a round
                    </Typography>
                    <Typography variant="body2" sx={{ mb: 2.5, color: PANEL_MUTED, maxWidth: 420, mx: 'auto' }}>
                      Pay 25 tTARI from your play stack, then dig through the sand to reveal a pretend item drop.
                    </Typography>
                    {settings?.isAdminViewer && settings?.globallyEnabled === false && settings?.allowAdminWhenDisabled && (
                      <Alert severity="success" sx={{ mb: 2, textAlign: 'left' }}>
                        Admin preview — public users see the maintenance screen. Rounds are free for you.
                      </Alert>
                    )}
                    {user && !settings?.isAdminViewer && allowVaultPayment && (
                      <Box sx={{ mb: 2, textAlign: 'left' }}>
                        <VaultGameStakePicker
                          vaultEnabled={allowVaultPayment}
                          paymentMethod={paymentMethod}
                          onPaymentMethodChange={setPaymentMethod}
                          selectedVaultItemId={selectedVaultItemId}
                          onSelectVaultItem={setSelectedVaultItemId}
                          btcPrice={btcPrice}
                          entryPriceUsd={priceUsd}
                          gameLabel="Sandbox"
                        />
                        {paymentMethod === 'vault' && (
                          <Alert severity="warning" sx={{ mt: 1.5, textAlign: 'left' }}>
                            Vault entry stakes the skin you select. It is forfeited when you start the round and cannot be
                            returned. Completing the dig still awards a separate random cosmetic via My Vouchers.
                          </Alert>
                        )}
                      </Box>
                    )}
                    {user && !settings?.isAdminViewer && paymentMethod === 'wallet' && (
                      <Paper
                        variant="outlined"
                        sx={{
                          mb: 2,
                          p: 2,
                          textAlign: 'left',
                          borderColor: 'rgba(59, 130, 246, 0.25)',
                          bgcolor: 'rgba(59, 130, 246, 0.04)'
                        }}
                      >
                        {walletLoading ? (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <CircularProgress size={18} />
                            <Typography variant="body2" sx={{ color: '#64748b' }}>Loading wallet…</Typography>
                          </Box>
                        ) : walletBalance ? (
                          <>
                            <Typography variant="body2" sx={{ color: '#64748b' }}>
                              Wallet balance
                            </Typography>
                            <Typography variant="h6" sx={{ fontWeight: 700, color: '#1e293b' }}>
                              {Math.round(walletBalance.availableBalance ?? 0).toLocaleString('en-US')} tTARI
                              <Typography component="span" variant="body2" sx={{ ml: 1, color: '#64748b', fontWeight: 500 }}>
                                (testnet play stack)
                              </Typography>
                            </Typography>
                            <Typography variant="body2" sx={{ mt: 1, color: '#64748b' }}>
                              Round entry: {priceUsd.toFixed(0)} tTARI
                            </Typography>
                          </>
                        ) : (
                          <Typography variant="body2" sx={{ color: '#64748b' }}>
                            Claim a tTARI play stack from the Games tab to pay for a round.
                          </Typography>
                        )}
                        {insufficientBalance && (
                          <Alert severity="warning" sx={{ mt: 1.5 }}>
                            Not enough tTARI for this entry. Claim more from the play stack.
                          </Alert>
                        )}
                      </Paper>
                    )}
                    <Button
                      variant="contained"
                      size="large"
                      startIcon={<PlayArrow />}
                      onClick={startGame}
                      disabled={!user || insufficientBalance || vaultPlayBlocked}
                      sx={{
                        ...(settings?.isAdminViewer ? ADMIN_PRIMARY_BTN : SITE_PRIMARY_BTN),
                        width: { xs: '100%', sm: 'auto' },
                        px: { xs: 2, sm: 4 },
                        py: { xs: 1.2, sm: 1.5 },
                        fontSize: '1.05rem',
                        fontWeight: 700,
                        borderRadius: 2
                      }}
                    >
                      {settings?.isAdminViewer
                        ? 'Preview round (free)'
                        : paymentMethod === 'vault'
                          ? (selectedVaultItemId ? 'Play — stake vault skin' : 'Select a vault skin')
                          : `Play — ${priceUsd.toFixed(0)} tTARI`}
                    </Button>
                    {!user && (
                      <Typography variant="caption" sx={{ display: 'block', mt: 2, color: '#64748b' }}>
                        Sign in to play
                      </Typography>
                    )}
                    {user && paymentMethod === 'vault' && !selectedVaultItemId && allowVaultPayment && (
                      <Typography variant="caption" sx={{ display: 'block', mt: 1.5, color: '#64748b' }}>
                        Choose an eligible vault skin above to continue.
                      </Typography>
                    )}
                  </Box>
                )}
                
                {gameState === 'paying' && (
                  <Box sx={{ textAlign: 'center' }}>
                    <CircularProgress sx={{ mb: 2 }} />
                    <Typography variant="h6" sx={{ color: '#1e293b' }}>
                      Processing entry…
                    </Typography>
                  </Box>
                )}

                {(gameState === 'playing' || gameState === 'revealing') && (
                  <Box sx={{ width: '100%', maxWidth: CANVAS_W, mx: 'auto', px: { xs: 0.25, sm: 0 } }}>
                    <Typography variant="subtitle1" sx={{ mb: 2, color: PANEL_INK, fontWeight: 600, textAlign: 'center' }}>
                      {gameState === 'revealing'
                        ? 'Uncovering your item…'
                        : 'Drag across the sand to dig'}
                    </Typography>
                    <Box
                      sx={{
                        position: 'relative',
                        borderRadius: 2,
                        overflow: 'hidden',
                        boxShadow: '0 20px 48px rgba(37, 99, 235, 0.14)',
                        border: '2px solid rgba(59, 130, 246, 0.2)',
                        width: '100%'
                      }}
                    >
                      <canvas
                        ref={canvasRef}
                        width={CANVAS_W}
                        height={CANVAS_H}
                        style={{
                          display: 'block',
                          cursor: gameState === 'revealing' || hasTouchInput ? 'default' : 'crosshair',
                          width: '100%',
                          height: 'auto',
                          touchAction: 'none'
                        }}
                      />
                      {gameState === 'revealing' && (
                        <Box
                          sx={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            bgcolor: 'rgba(15, 23, 42, 0.35)',
                            backdropFilter: 'blur(2px)'
                          }}
                        >
                          <CircularProgress size={44} sx={{ color: '#fff', mb: 1.5 }} />
                          <Typography variant="body2" sx={{ color: '#f8fafc', fontWeight: 600 }}>
                            Uncovering item…
                          </Typography>
                        </Box>
                      )}
                    </Box>
                    <Box sx={{ mt: 3, width: '100%' }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.75 }}>
                        <Typography variant="caption" sx={{ color: PANEL_MUTED, fontWeight: 600 }}>
                          Excavation
                        </Typography>
                        <Typography variant="caption" sx={{ color: PANEL_INK, fontWeight: 700 }}>
                          {gameState === 'revealing' ? 100 : progressPct}%
                        </Typography>
                      </Box>
                      <LinearProgress
                        variant="determinate"
                        value={gameState === 'revealing' ? 100 : progressPct}
                        sx={{
                          width: '100%',
                          height: 10,
                          borderRadius: 99,
                          backgroundColor: 'rgba(59, 130, 246, 0.12)',
                          '& .MuiLinearProgress-bar': {
                            background: MARKET_GRADIENT,
                            borderRadius: 99,
                            transition: 'transform 0.35s ease',
                            ...(diggingProgress <= 0 && gameState === 'playing'
                              ? { transform: 'scaleX(0) !important' }
                              : {})
                          }
                        }}
                      />
                    </Box>
                    {gameState === 'playing' && (
                      <Typography variant="body2" sx={{ mt: 1.5, color: PANEL_MUTED, fontWeight: 500, textAlign: 'center' }}>
                        {diggingProgress < 100
                          ? (hasTouchInput
                            ? 'Drag with your finger to clear the sand.'
                            : 'Drag to clear the sand.')
                          : 'Finishing up…'}
                      </Typography>
                    )}
                    {sandboxDebug && (
                      <Box sx={{ mt: 1.25, display: 'flex', gap: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
                        <Button size="small" variant="outlined" onClick={copyLastReplay}>
                          Copy Last Replay JSON
                        </Button>
                        <Typography variant="caption" sx={{ color: PANEL_MUTED, alignSelf: 'center' }}>
                          {lastReplayAt ? 'Replay saved to localStorage key sandboxReplay:last' : 'Replay saves after round end'}
                        </Typography>
                      </Box>
                    )}
                  </Box>
                )}

                {gameState === 'completed' && revealedItem && (
                  <Box
                    sx={{
                      textAlign: 'center',
                      width: '100%',
                      animation: winRevealReady ? `${winCardIn} 0.55s ease-out` : 'none'
                    }}
                  >
                    <Box
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 1,
                        mb: 2.5,
                        px: 2,
                        py: 0.75,
                        borderRadius: 99,
                        background: MARKET_GRADIENT,
                        boxShadow: '0 8px 24px rgba(37, 99, 235, 0.3)'
                      }}
                    >
                      <EmojiEvents sx={{ color: '#fde68a', fontSize: 22 }} />
                      <Typography variant="subtitle1" sx={{ color: '#fff', fontWeight: 700 }}>
                        Reward unlocked
                      </Typography>
                    </Box>

                    <Card
                      elevation={0}
                      sx={{
                        maxWidth: 440,
                        mx: 'auto',
                        mb: 3,
                        borderRadius: 3,
                        overflow: 'hidden',
                        border: `2px solid ${revealedItem.rarityColor || BRAND_BLUE}55`,
                        boxShadow: `0 16px 40px ${String(revealedItem.rarityColor || BRAND_BLUE)}28`
                      }}
                    >
                      <Box
                        sx={{
                          height: 6,
                          background: `linear-gradient(90deg, ${revealedItem.rarityColor || BRAND_BLUE} 0%, ${BRAND_BLUE} 100%)`
                        }}
                      />
                      <CardContent sx={{ p: { xs: 2.5, sm: 3 }, background: 'linear-gradient(160deg, #1e293b 0%, #0f172a 100%)' }}>
                        <Box
                          sx={{
                            width: '100%',
                            height: 220,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            mb: 2.5,
                            background: 'linear-gradient(145deg, rgba(239, 246, 255, 0.95) 0%, rgba(219, 234, 254, 0.6) 100%)',
                            borderRadius: 2,
                            border: '1px solid rgba(59, 130, 246, 0.15)'
                          }}
                        >
                          <Box
                            component="img"
                            src={getRevealedItemImage(revealedItem)}
                            alt={revealedItem.name}
                            sx={{
                              maxWidth: '88%',
                              maxHeight: '88%',
                              objectFit: 'contain',
                              animation: winRevealReady ? `${winImageGlow} 2.4s ease-in-out infinite` : 'none'
                            }}
                            onError={(e) => { e.currentTarget.src = '/placeholder-item.png'; }}
                          />
                        </Box>

                        <Typography variant="h6" sx={{ mb: 1, color: '#ffffff', fontWeight: 800, letterSpacing: '-0.02em' }}>
                          {revealedItem.name}
                        </Typography>

                        <Chip
                          size="small"
                          label={String(revealedItem.rarityDisplay || revealedItem.rarity || 'Item').toUpperCase()}
                          sx={{
                            mb: 2,
                            fontWeight: 700,
                            letterSpacing: 0.4,
                            color: '#fff',
                            backgroundColor: revealedItem.rarityColor || BRAND_BLUE
                          }}
                        />

                        <Typography variant="h5" sx={{ color: '#bfdbfe', mb: 0.25, fontWeight: 800 }}>
                          ${revealedItem.marketPrice?.toFixed(2) || 'N/A'}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.6)', display: 'block', mb: 2 }}>
                          Catalog market value
                        </Typography>

                        <Alert severity="info" sx={{ textAlign: 'left', borderRadius: 2 }}>
                          Pretend drop, recorded under <strong>My Vouchers</strong>. Nothing is delivered on the testnet;
                          it shows the flow the live game will run at launch.
                        </Alert>
                      </CardContent>
                    </Card>

                    <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'center', flexWrap: 'wrap' }}>
                      <Button variant="contained" onClick={resetGame} sx={{ ...SITE_PRIMARY_BTN, width: { xs: '100%', sm: 'auto' } }}>
                        Play Again
                      </Button>
                      <Button
                        variant="outlined"
                        onClick={() => {
                          fetchVouchers();
                          setShowVouchers(true);
                        }}
                        sx={{
                          width: { xs: '100%', sm: 'auto' },
                          borderColor: 'rgba(59, 130, 246, 0.45)',
                          color: BRAND_BLUE,
                          fontWeight: 600,
                          '&:hover': { borderColor: BRAND_BLUE, bgcolor: 'rgba(59, 130, 246, 0.06)' }
                        }}
                      >
                        Open voucher
                      </Button>
                    </Box>
                  </Box>
                )}
              </Paper>
            </Grid>
            
            <Grid item xs={12} lg={4} sx={{ display: 'flex' }}>
              <Paper elevation={0} sx={{ ...lightPanelPaperSx, p: { xs: 1.5, sm: 2.5, md: 3 }, width: '100%', height: '100%' }}>
                <Typography variant="h6" sx={{ mb: 2, color: PANEL_INK, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Info sx={{ color: BRAND_BLUE }} /> How to Play
                </Typography>

                <Box sx={{ '& > div': { mb: 2 } }}>
                  <Box>
                    <Typography variant="subtitle2" sx={{ color: PANEL_INK, fontWeight: 600 }}>
                      1. Pay entry
                    </Typography>
                    <Typography variant="body2" sx={{ color: PANEL_MUTED }}>
                      Each round costs {priceUsd.toFixed(0)} tTARI from your play stack. Nothing real is ever charged.
                    </Typography>
                  </Box>

                  <Box>
                    <Typography variant="subtitle2" sx={{ color: PANEL_INK, fontWeight: 600 }}>
                      2. Dig
                    </Typography>
                    <Typography variant="body2" sx={{ color: PANEL_MUTED }}>
                      Drag across the sand until the excavation bar fills. Shells appear as you clear the pit.
                    </Typography>
                  </Box>

                  <Box>
                    <Typography variant="subtitle2" sx={{ color: PANEL_INK, fontWeight: 600 }}>
                      3. Reveal reward
                    </Typography>
                    <Typography variant="body2" sx={{ color: PANEL_MUTED }}>
                      A random cosmetic is revealed when digging completes.
                    </Typography>
                  </Box>

                  <Box>
                    <Typography variant="subtitle2" sx={{ color: PANEL_INK, fontWeight: 600 }}>
                      4. Watch your drops
                    </Typography>
                    <Typography variant="body2" sx={{ color: PANEL_MUTED }}>
                      Drops are recorded as vouchers in My Vouchers. On the testnet nothing is delivered: it shows the
                      flow the live game will run at launch.
                    </Typography>
                  </Box>
                </Box>

                <Alert severity="info" icon={<Info />} sx={{ mt: 3 }}>
                  Track delivery and trade status anytime in My Vouchers.
                </Alert>
              </Paper>
            </Grid>
          </Grid>
        </Box>
      </Box>
      
      {/* Vouchers Dialog */}
      <Dialog
        open={showVouchers}
        onClose={() => setShowVouchers(false)}
        maxWidth="md"
        fullWidth
        fullScreen={isCompactMobile}
        PaperProps={{
          sx: {
            background: 'rgba(23, 28, 39, 0.96)',
            color: '#e5e7eb'
          }
        }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(148, 163, 184, 0.25)' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <LocalActivity /> My Vouchers
          </Box>
          <IconButton onClick={() => setShowVouchers(false)} sx={{ color: '#cbd5e1' }}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ py: 2 }}>
          <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
            <Chip
              label={`Pending ${vouchers.filter(v => String(v.status || '').toLowerCase() === 'pending').length}`}
              size="small"
              sx={{ bgcolor: 'rgba(251, 191, 36, 0.2)', color: '#fde68a' }}
            />
            <Chip
              label={`Claimed ${vouchers.filter(v => String(v.status || '').toLowerCase() === 'claimed').length}`}
              size="small"
              sx={{ bgcolor: 'rgba(16, 185, 129, 0.2)', color: '#86efac' }}
            />
            <Chip
              label={`Total ${vouchers.length}`}
              size="small"
              sx={{ bgcolor: 'rgba(96, 165, 250, 0.2)', color: '#bfdbfe' }}
            />
          </Box>
          {vouchersLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
              <CircularProgress size={26} />
            </Box>
          ) : null}
          {vouchers.length === 0 ? (
            <Alert severity="info">
              No vouchers yet. Complete a Sandbox round to receive your first reward.
            </Alert>
          ) : (
            <Grid container spacing={2}>
              {vouchers.map((voucher) => (
                <Grid item xs={12} sm={6} key={voucher.voucherCode}>
                  <Card sx={{ bgcolor: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(148, 163, 184, 0.25)', color: '#e2e8f0' }}>
                    <CardContent>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                        <Box sx={{
                          width: 64,
                          height: 64,
                          borderRadius: 1.5,
                          bgcolor: 'rgba(2, 6, 23, 0.45)',
                          border: '1px solid rgba(148, 163, 184, 0.25)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          overflow: 'hidden'
                        }}>
                          <img
                          src={getVoucherDisplayImage(voucher)}
                          alt={voucher.itemName}
                          style={{ width: 60, height: 60, objectFit: 'contain' }}
                          onError={(e) => { e.currentTarget.src = '/placeholder-item.png'; }}
                        />
                        </Box>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                            {voucher.itemName}
                          </Typography>
                          <Chip
                            label={voucher.status.toUpperCase()}
                            size="small"
                            color={voucher.status === 'pending' ? 'warning' : voucher.status === 'claimed' ? 'success' : 'default'}
                          />
                        </Box>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                        <Typography variant="caption" sx={{ display: 'block', color: '#94a3b8', fontFamily: 'monospace' }}>
                          {voucher.voucherCode}
                        </Typography>
                        <Tooltip title="Copy voucher code">
                          <IconButton size="small" onClick={() => handleCopyVoucherCode(voucher.voucherCode)} sx={{ color: '#93c5fd' }}>
                            <ContentCopyIcon fontSize="inherit" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                      <Typography variant="caption" sx={{ display: 'block', color: '#94a3b8', mt: 1 }}>
                        Value: ${Number(voucher?.itemDetails?.marketPrice || 0).toFixed(2)}
                      </Typography>
                      <Typography variant="caption" sx={{ display: 'block', color: '#94a3b8', mt: 0.5 }}>
                        Issued: {new Date(voucher.issuedAt).toLocaleDateString()}
                      </Typography>
                      {String(voucher.status || '').toLowerCase() === 'pending' && (
                        <Typography variant="caption" sx={{ display: 'block', color: '#fde68a', mt: 1 }}>
                          Pending — preparing your Steam trade offer.
                        </Typography>
                      )}
                      {String(voucher.status || '').toLowerCase() === 'claimed' && voucher.tradeId && (
                        <Typography variant="caption" sx={{ display: 'block', color: '#86efac', mt: 1, fontFamily: 'monospace' }}>
                          Trade offer: {voucher.tradeId}
                        </Typography>
                      )}
                      {voucher.claimedAt && (
                        <Typography variant="caption" sx={{ display: 'block', color: '#94a3b8', mt: 0.5 }}>
                          Fulfilled: {new Date(voucher.claimedAt).toLocaleString()}
                        </Typography>
                      )}
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={fetchVouchers} sx={{ color: '#93c5fd' }}>Refresh</Button>
          <Button onClick={() => setShowVouchers(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default OotleSandboxGame;

