export type SessionState = "disconnected" | "connecting" | "idle" | "listening" | "speaking" | "error";

export type TeachingPhase = "intro" | "concept" | "example" | "doubt" | "transition";

export interface ToolCallPayload {
  id: string;
  name: string;
  args: any;
}

export interface LiveTranscription {
  text: string;
  finished: boolean;
  id?: string;
}

export type ThemeType = "cherry" | "matrix" | "cyber" | "sunset" | "slate";

export interface ThemeColors {
  primary: string; // Tailwind colors like 'indigo-600' or hex
  accent: string;
  glow: string;
  bgGradient: string;
  waveColors: string[];
}

export const THEME_CONFIGS: Record<ThemeType, ThemeColors> = {
  cherry: {
    primary: "#0a3641",
    accent: "#c4f500",
    glow: "rgba(196, 245, 0, 0.35)",
    bgGradient: "from-[#f7f9f6] via-[#f7f9f6] to-[#eff2ee]",
    waveColors: ["#0a3641", "#c4f500", "#124e5d", "#a8d400"],
  },
  matrix: {
    primary: "#0a3641",
    accent: "#c4f500",
    glow: "rgba(196, 245, 0, 0.35)",
    bgGradient: "from-[#f7f9f6] via-[#f7f9f6] to-[#eff2ee]",
    waveColors: ["#0a3641", "#c4f500", "#124e5d", "#a8d400"],
  },
  cyber: {
    primary: "#0a3641",
    accent: "#c4f500",
    glow: "rgba(196, 245, 0, 0.35)",
    bgGradient: "from-[#f7f9f6] via-[#f7f9f6] to-[#eff2ee]",
    waveColors: ["#0a3641", "#c4f500", "#124e5d", "#a8d400"],
  },
  sunset: {
    primary: "#0a3641",
    accent: "#c4f500",
    glow: "rgba(196, 245, 0, 0.35)",
    bgGradient: "from-[#f7f9f6] via-[#f7f9f6] to-[#eff2ee]",
    waveColors: ["#0a3641", "#c4f500", "#124e5d", "#a8d400"],
  },
  slate: {
    primary: "#0a3641",
    accent: "#c4f500",
    glow: "rgba(196, 245, 0, 0.35)",
    bgGradient: "from-[#f7f9f6] via-[#f7f9f6] to-[#eff2ee]",
    waveColors: ["#0a3641", "#c4f500", "#124e5d", "#a8d400"],
  },
};
