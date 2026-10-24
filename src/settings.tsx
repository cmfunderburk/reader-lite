import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { DEFAULT_WPM } from './pacer';
import type { GenerationDifficulty } from './reader/generationMask';
import { getSetting, putSetting } from './store/db';

export type Theme = 'system' | 'light' | 'dark';
export type ReadingMode = 'guided' | 'generation';

export interface Settings {
  fontSize: number;
  theme: Theme;
  showOvp: boolean;
  alternateOvpColors: boolean;
  /** Target characters between fixations (7–15). */
  saccadeLength: number;
  quietSweep: boolean;
  /** WPM for books that don't have their own yet. */
  defaultWpm: number;
  mode: ReadingMode;
  generationDifficulty: GenerationDifficulty;
  /** In Generation mode, unmask each line as the sweep passes. */
  sweepReveal: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  fontSize: 16,
  theme: 'system',
  showOvp: true,
  alternateOvpColors: false,
  saccadeLength: 10,
  quietSweep: false,
  defaultWpm: DEFAULT_WPM,
  mode: 'guided',
  generationDifficulty: 'normal',
  sweepReveal: true,
};

export const FONT_SIZE_RANGE = { min: 12, max: 26 } as const;
export const SACCADE_RANGE = { min: 7, max: 15 } as const;

const SETTINGS_KEY = 'reader';

type SettingsContextValue = [Settings, (changes: Partial<Settings>) => void];

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    getSetting<Partial<Settings>>(SETTINGS_KEY)
      .catch(() => undefined)
      .then((saved) => setSettings({ ...DEFAULT_SETTINGS, ...saved }));
  }, []);

  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    if (settings.theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = settings.theme;
    root.style.setProperty('--reading-size', `${settings.fontSize}px`);
  }, [settings]);

  const update = useCallback((changes: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...(prev ?? DEFAULT_SETTINGS), ...changes };
      void putSetting(SETTINGS_KEY, next);
      return next;
    });
  }, []);

  // Render nothing until settings load, so the first layout uses the saved font size.
  if (!settings) return null;
  return <SettingsContext.Provider value={[settings, update]}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings outside SettingsProvider');
  return value;
}
