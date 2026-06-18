import { useEffect, useRef } from "react";
import { ThemeColors, SessionState } from "../types";

interface WaveVisualizerProps {
  state: SessionState;
  theme: ThemeColors;
  userVolume: number; // 0.0 to 1.0 (microphone signal)
  cherryVolume: number; // 0.0 to 1.0 (audio output signal)
}

export default function WaveVisualizer({
  state,
  theme,
  userVolume,
  cherryVolume,
}: WaveVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let phase = 0;

    // Responsive sizing
    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    // Target values to interpolate for smooth physical animations
    let targetAmplitude = 15;
    let targetSpeed = 0.05;
    let targetFrequency = 0.02;
    let targetWaveCount = 3;

    // Smoothed values to avoid abrupt visual jumps
    let currentAmplitude = 15;
    let currentSpeed = 0.05;
    let currentFrequency = 0.02;
    let currentWaveCount = 3;

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const width = canvas.width / window.devicePixelRatio;
      const height = canvas.height / window.devicePixelRatio;
      const centerY = height / 2;

      // Adjust animation parameters based on the active state
      switch (state) {
        case "disconnected":
          targetAmplitude = 2;
          targetSpeed = 0.01;
          targetFrequency = 0.015;
          targetWaveCount = 1;
          break;
        case "connecting":
          targetAmplitude = 12;
          targetSpeed = 0.08;
          targetFrequency = 0.04;
          targetWaveCount = 4;
          break;
        case "listening":
          // Amplify microphone inputs
          targetAmplitude = 8 + userVolume * 80;
          targetSpeed = 0.06 + userVolume * 0.15;
          targetFrequency = 0.02 + userVolume * 0.03;
          targetWaveCount = 4;
          break;
        case "speaking":
          // Amplify model voice inputs
          targetAmplitude = 16 + cherryVolume * 100;
          targetSpeed = 0.08 + cherryVolume * 0.1;
          targetFrequency = 0.015 + cherryVolume * 0.01;
          targetWaveCount = 5;
          break;
        case "idle":
        default:
          targetAmplitude = 14;
          targetSpeed = 0.03;
          targetFrequency = 0.018;
          targetWaveCount = 3;
          break;
      }

      // Linear interpolation (lerp) for micro-interactions
      currentAmplitude += (targetAmplitude - currentAmplitude) * 0.12;
      currentSpeed += (targetSpeed - currentSpeed) * 0.12;
      currentFrequency += (targetFrequency - currentFrequency) * 0.12;
      currentWaveCount += (targetWaveCount - currentWaveCount) * 0.1;

      phase += currentSpeed;

      // Render individual stacked waves with staggered phase and thickness
      const colors = theme.waveColors;
      for (let w = 0; w < Math.round(currentWaveCount); w++) {
        ctx.beginPath();

        const waveColor = colors[w % colors.length] || theme.primary;
        
        // Setup varying opacity and composite modes for high-end neon glowing intersections
        ctx.strokeStyle = waveColor;
        ctx.globalCompositeOperation = "screen";
        ctx.lineWidth = w === 0 ? 3 : 1.5;

        // Apply visual transparency based on wave layer
        const fraction = (w + 1) / currentWaveCount;
        ctx.globalAlpha = 1 - fraction * 0.4;

        // Stagger variables to separate and floatingly orbit waves
        const amplitudeScalar = Math.sin(phase * 0.5 + w) * 0.35 + 0.65;
        const speedOffset = w * 0.3;
        const currentPhase = phase + speedOffset;

        for (let x = 0; x < width; x++) {
          // Beautiful gaussian-like bell curve tapering at edges to fade cleanly into negative space
          const envelope = Math.sin((x / width) * Math.PI);
          
          // Triple-sine formula for high-frequency rich organic texture
          const sineValue = 
            Math.sin(x * currentFrequency + currentPhase) * 0.7 +
            Math.sin(x * (currentFrequency * 1.5) - currentPhase * 0.5) * 0.25 +
            Math.sin(x * (currentFrequency * 0.4) + currentPhase * 2) * 0.05;

          const y = centerY + sineValue * currentAmplitude * amplitudeScalar * envelope;

          if (x === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }

        ctx.stroke();
      }

      // Restore composite and alpha states
      ctx.globalAlpha = 1.0;
      ctx.globalCompositeOperation = "source-over";

      animationFrameId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [state, theme, userVolume, cherryVolume]);

  return (
    <div className="relative w-full h-56 flex items-center justify-center overflow-hidden">
      {/* Background radial soft light center glow */}
      <div
        className="absolute inset-0 rounded-full blur-3xl opacity-20 pointer-events-none transition-all duration-1000"
        style={{
          background: `radial-gradient(circle, ${theme.primary} 0%, transparent 70%)`,
        }}
      />
      <canvas
        id="waveform-canvas"
        ref={canvasRef}
        className="w-full h-full cursor-pointer z-10 block"
      />
    </div>
  );
}
