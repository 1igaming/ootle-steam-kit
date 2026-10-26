import React, { useState, useEffect, useRef } from 'react';
import { Box } from '@mui/material';

const CrashGraph = ({ 
  multiplier, 
  gameState, 
  crashPoint, 
  maxMultiplier = 20,
}) => {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 360 });
  const width = dimensions.width;
  const height = dimensions.height;
  const [graphData, setGraphData] = useState([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [dynamicMaxMultiplier, setDynamicMaxMultiplier] = useState(maxMultiplier);
  const intervalRef = useRef(null);
  const crashTimeoutRef = useRef(null);
  const gameStartTimeRef = useRef(null); // Track actual game start time
  const lastPositionRef = useRef(null); // Store last position while running
  const [crashingPosition, setCrashingPosition] = useState(null); // Track position when crash happens
  const [showCrashAnimation, setShowCrashAnimation] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.max(280, Math.floor(rect.width));
      const h = Math.max(220, Math.floor(rect.height));
      setDimensions((prev) =>
        prev.width === w && prev.height === h ? prev : { width: w, height: h }
      );
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Update graph data when multiplier changes
  useEffect(() => {
    if (gameState === 'running' && multiplier > 1) {
      // Set game start time on first data point
      if (gameStartTimeRef.current === null) {
        gameStartTimeRef.current = Date.now();
      }
      
      setGraphData(prev => {
        const newData = [...prev, { time: Date.now(), multiplier: multiplier }];
        
        // Dynamically adjust max multiplier if current multiplier exceeds it
        const currentMax = Math.max(...newData.map(point => point.multiplier));
        if (currentMax > dynamicMaxMultiplier) {
          setDynamicMaxMultiplier(Math.min(currentMax * 1.2, 100)); // Cap at 100x for performance
        }
        
        // Keep only last 200 points for performance and smoother display
        if (newData.length > 200) {
          return newData.slice(-200);
        }
        return newData;
      });
    } else if (gameState === 'betting' || gameState === 'countdown' || gameState === 'results') {
      // Reset graph data for new round
      setGraphData([]);
      setCurrentTime(0);
      setDynamicMaxMultiplier(maxMultiplier); // Reset to default max
      gameStartTimeRef.current = null; // Reset game start time
      lastPositionRef.current = null; // Reset last position
      setCrashingPosition(null); // Reset crash animation
      setShowCrashAnimation(false);
    }
  }, [multiplier, gameState, maxMultiplier, dynamicMaxMultiplier]);

  // Timer for graph progression - faster updates for smoother surfboard movement
  useEffect(() => {
    if (gameState === 'running') {
      const startTime = Date.now();
      intervalRef.current = setInterval(() => {
        setCurrentTime(Date.now() - startTime);
      }, 16); // Update every 16ms (~60fps) for ultra-smooth surfboard movement
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [gameState]);

  // Trigger crash animation when game crashes
  useEffect(() => {
    if (gameState === 'crashed' && lastPositionRef.current) {
      // Use the last stored position from when the game was running
      setCrashingPosition(lastPositionRef.current);
      setShowCrashAnimation(true);
      
      // Hide the animation after it completes (2 seconds)
      if (crashTimeoutRef.current) {
        clearTimeout(crashTimeoutRef.current);
      }
      crashTimeoutRef.current = setTimeout(() => {
        setShowCrashAnimation(false);
        crashTimeoutRef.current = null;
      }, 2000);
    }

    return () => {
      if (crashTimeoutRef.current) {
        clearTimeout(crashTimeoutRef.current);
        crashTimeoutRef.current = null;
      }
    };
  }, [gameState]);

  // Calculate SVG path for the line
  const createPath = () => {
    if (graphData.length === 0 || !gameStartTimeRef.current) return '';

    // Use a fixed time window that scrolls (like Bustabit)
    const displayWindow = 20; // Show 20 seconds of data at a time
    const currentGameTime = currentTime / 1000; // Current elapsed time in seconds
    
    // Calculate which portion of the graph to show
    const startTime = Math.max(0, currentGameTime - displayWindow);

    // Create smooth curve using quadratic Bézier curves
    const points = graphData.map((point, index) => {
      // Use the ACTUAL game start time as reference, not graphData[0].time
      const pointTime = (point.time - gameStartTimeRef.current) / 1000;
      
      // Map time to x-coordinate (current time is always at the right edge)
      const x = ((pointTime - startTime) / displayWindow) * width;
      
      // Add padding to prevent cutoff at bottom
      const padding = 20;
      const availableHeight = height - (padding * 2);
      const y = height - padding - ((point.multiplier - 1) / (dynamicMaxMultiplier - 1)) * availableHeight;
      return { x, y };
    }).filter(point => point.x >= 0 && point.x <= width); // Only show points in visible range

    if (points.length < 2) return '';

    // Create smooth path using quadratic Bézier curves
    let path = `M ${points[0].x} ${points[0].y}`;
    
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      
      // Use control point for smooth curves
      const controlX = (prev.x + curr.x) / 2;
      const controlY = (prev.y + curr.y) / 2;
      
      path += ` Q ${controlX} ${controlY} ${curr.x} ${curr.y}`;
    }

    return path;
  };

  // Calculate current position for the surfboard
  const getCurrentPosition = () => {
    if (gameState === 'running' && multiplier > 1 && graphData.length > 0 && gameStartTimeRef.current) {
      // Surfboard should be at the END of the actual line (last point in graphData)
      // not based on currentTime which can be ahead of the data
      const displayWindow = 20; // Same as createPath
      const currentGameTime = currentTime / 1000;
      const startTime = Math.max(0, currentGameTime - displayWindow);
      
      // Get the last point from graphData (this is where the line actually ends)
      const lastPoint = graphData[graphData.length - 1];
      // Use the ACTUAL game start time as reference, not graphData[0].time
      const lastPointTime = (lastPoint.time - gameStartTimeRef.current) / 1000;
      
      // Calculate position based on the last data point (not currentTime)
      const x = ((lastPointTime - startTime) / displayWindow) * width;
      
      // Only show surfboard if it's within the visible range
      if (x < 0 || x > width) {
        return null;
      }
      
      // Add padding to prevent cutoff at bottom
      const padding = 20;
      const availableHeight = height - (padding * 2);
      const y = height - padding - ((lastPoint.multiplier - 1) / (dynamicMaxMultiplier - 1)) * availableHeight;
      
      return { x, y };
    }
    return null;
  };

  // Generate grid lines
  const generateGridLines = () => {
    const lines = [];
    
    // Horizontal lines (multiplier markers) - use dynamic max
    const step = Math.max(1, Math.floor(dynamicMaxMultiplier / 10)); // Show ~10 lines
    const padding = 20;
    const availableHeight = height - (padding * 2);
    for (let i = 1; i <= dynamicMaxMultiplier; i += step) {
      const y = height - padding - ((i - 1) / (dynamicMaxMultiplier - 1)) * availableHeight;
      lines.push(
        <line
          key={`h-${i}`}
          x1={0}
          y1={y}
          x2={width}
          y2={y}
          stroke="rgba(59, 130, 246, 0.1)"
          strokeWidth={1}
        />
      );
    }
    
    // Vertical lines (time markers)
    for (let i = 0; i <= 10; i++) {
      const x = (i / 10) * width;
      lines.push(
        <line
          key={`v-${i}`}
          x1={x}
          y1={0}
          x2={x}
          y2={height}
          stroke="rgba(59, 130, 246, 0.1)"
          strokeWidth={1}
        />
      );
    }
    
    return lines;
  };

  // Generate multiplier labels
  const generateLabels = () => {
    const labels = [];
    
    // Left side multiplier labels - use dynamic max
    const numLabels = 8;
    const labelStep = Math.max(1, Math.ceil(dynamicMaxMultiplier / numLabels));
    const padding = 20;
    const availableHeight = height - (padding * 2);
    
    // Always show 1x at the bottom
    labels.push(
      <text
        key="label-1"
        x={10}
        y={height - padding + 5}
        fontSize="12"
        fill="rgba(0, 0, 0, 0.6)"
        textAnchor="start"
      >
        1x
      </text>
    );
    
    // Generate intermediate labels
    for (let i = labelStep; i < dynamicMaxMultiplier; i += labelStep) {
      const y = height - padding - ((i - 1) / (dynamicMaxMultiplier - 1)) * availableHeight;
      labels.push(
        <text
          key={`label-${i}`}
          x={10}
          y={y + 5}
          fontSize="12"
          fill="rgba(0, 0, 0, 0.6)"
          textAnchor="start"
        >
          {i}x
        </text>
      );
    }
    
    // Always show the current max at the top
    if (dynamicMaxMultiplier > 1) {
      const maxY = height - padding - ((dynamicMaxMultiplier - 1) / (dynamicMaxMultiplier - 1)) * availableHeight;
      labels.push(
        <text
          key={`label-max`}
          x={10}
          y={maxY + 5}
          fontSize="12"
          fill="rgba(0, 0, 0, 0.6)"
          textAnchor="start"
          fontWeight="bold"
        >
          {Math.round(dynamicMaxMultiplier)}x
        </text>
      );
    }
    
    return labels;
  };

  const currentPos = getCurrentPosition();
  const pathData = createPath();
  const surfboardSize = Math.max(30, Math.min(40, Math.round(width * 0.075)));
  const getSurfboardAnchorSx = (position) => ({
    position: 'absolute',
    left: `${position.x}px`,
    top: `${position.y}px`,
    width: surfboardSize,
    height: surfboardSize,
    transform: 'translate(-50%, -50%)',
    transformOrigin: '50% 50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
    userSelect: 'none',
    zIndex: 2,
    willChange: 'left, top',
  });
  const surfboardInnerSx = {
    display: 'block',
    width: '100%',
    height: '100%',
    fontSize: surfboardSize,
    lineHeight: 1,
    textAlign: 'center',
    fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
    transformOrigin: '50% 50%',
    filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))',
    willChange: 'transform, opacity',
  };

  // Store the current position continuously while running (for crash animation)
  if (currentPos && gameState === 'running') {
    lastPositionRef.current = currentPos;
  }

  return (
    <Box
      ref={containerRef}
      sx={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        overflow: 'visible',
      }}
    >
      <style>
        {`
          @keyframes surfBounce {
            0%, 100% { transform: translate3d(0, 0, 0) rotate(-4deg); }
            50% { transform: translate3d(0, -4px, 0) rotate(4deg); }
          }
          
          @keyframes surfCrash {
            0% {
              transform: translate3d(0, 0, 0) rotate(0deg) scale(1);
              opacity: 1;
            }
            25% {
              transform: translate3d(2px, -3px, 0) rotate(-12deg) scale(1.05);
              opacity: 0.95;
            }
            50% {
              transform: translate3d(-3px, 2px, 0) rotate(14deg) scale(0.98);
              opacity: 0.8;
            }
            75% {
              transform: translate3d(2px, 5px, 0) rotate(-8deg) scale(0.9);
              opacity: 0.6;
            }
            100% {
              transform: translate3d(0, 8px, 0) rotate(18deg) scale(0.82);
              opacity: 0;
            }
          }
        `}
      </style>
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
        background: 'linear-gradient(155deg, #eff6ff 0%, #dbeafe 42%, #bfdbfe 100%)',
          borderRadius: 8,
          border: 'none',
          overflow: 'visible',
          display: 'block',
        }}
      >
        {/* Grid lines */}
        {generateGridLines()}
        
        {/* Labels */}
        {generateLabels()}
        
        {/* Graph line */}
        {pathData && (
          <path
            d={pathData}
            stroke={gameState === 'crashed' ? '#f44336' : '#3b82f6'}
            strokeWidth={3}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        
        {/* Crash point line */}
        {gameState === 'crashed' && crashPoint > 0 && (
          <line
            x1={0}
            y1={height - 20 - ((crashPoint - 1) / (dynamicMaxMultiplier - 1)) * (height - 40)}
            x2={width}
            y2={height - 20 - ((crashPoint - 1) / (dynamicMaxMultiplier - 1)) * (height - 40)}
            stroke="#f44336"
            strokeWidth={2}
            strokeDasharray="5,5"
          />
        )}
      </svg>
      {/* Keep the emoji outside SVG text transforms; only the inner glyph animates. */}
      {currentPos && gameState === 'running' && (
        <Box aria-hidden="true" sx={getSurfboardAnchorSx(currentPos)}>
          <Box
            component="span"
            sx={{
              ...surfboardInnerSx,
              animation: 'surfBounce 0.5s ease-in-out infinite',
            }}
          >
            🏄
          </Box>
        </Box>
      )}
      {showCrashAnimation && crashingPosition && (
        <Box aria-hidden="true" sx={getSurfboardAnchorSx(crashingPosition)}>
          <Box
            component="span"
            sx={{
              ...surfboardInnerSx,
              filter: 'drop-shadow(0 4px 8px rgba(244, 67, 54, 0.6))',
              animation: 'surfCrash 2s ease-out forwards',
            }}
          >
            🏄
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default CrashGraph;
