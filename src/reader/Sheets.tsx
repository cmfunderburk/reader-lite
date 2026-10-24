import { useEffect, useRef, type ReactNode } from 'react';
import { FONT_SIZE_RANGE, SACCADE_RANGE, useSettings, type Theme } from '../settings';
import type { ChapterSummary } from '../store/db';

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet" role="dialog" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <header className="sheet-header">
          <h2>{title}</h2>
          <button className="button subtle" onClick={onClose}>Done</button>
        </header>
        <div className="sheet-body">{children}</div>
      </section>
    </div>
  );
}

export function TocSheet({
  chapters,
  current,
  onSelect,
  onClose,
}: {
  chapters: ChapterSummary[];
  current: number;
  onSelect: (chapter: number) => void;
  onClose: () => void;
}) {
  const currentRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center' });
  }, []);

  return (
    <Sheet title="Contents" onClose={onClose}>
      <ol className="toc">
        {chapters.map((chapter, index) => (
          <li key={index}>
            <button
              ref={index === current ? currentRef : undefined}
              className={`toc-item${index === current ? ' current' : ''}`}
              onClick={() => onSelect(index)}
            >
              {chapter.title}
            </button>
          </li>
        ))}
      </ol>
    </Sheet>
  );
}

function Stepper({ value, min, max, onChange, format }: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  return (
    <div className="stepper">
      <button className="button step" disabled={value <= min} onClick={() => onChange(value - 1)} aria-label="Decrease">−</button>
      <span className="stepper-value">{format ? format(value) : value}</span>
      <button className="button step" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label="Increase">+</button>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button className={`toggle${checked ? ' on' : ''}`} role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
      <span className="toggle-knob" />
    </button>
  );
}

const THEMES: Array<[Theme, string]> = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const [settings, update] = useSettings();
  return (
    <Sheet title="Reading settings" onClose={onClose}>
      <div className="setting">
        <span>Text size</span>
        <Stepper
          value={settings.fontSize}
          min={FONT_SIZE_RANGE.min}
          max={FONT_SIZE_RANGE.max}
          onChange={(fontSize) => update({ fontSize })}
          format={(size) => `${size}px`}
        />
      </div>
      <div className="setting">
        <span>Theme</span>
        <div className="segmented">
          {THEMES.map(([theme, label]) => (
            <button
              key={theme}
              className={settings.theme === theme ? 'selected' : ''}
              onClick={() => update({ theme })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="setting">
        <span>OVP fixation marks</span>
        <Toggle checked={settings.showOvp} onChange={(showOvp) => update({ showOvp })} />
      </div>
      <div className="setting">
        <span>Alternate OVP colours</span>
        <Toggle checked={settings.alternateOvpColors} onChange={(alternateOvpColors) => update({ alternateOvpColors })} />
      </div>
      <div className="setting">
        <span>Saccade length</span>
        <Stepper
          value={settings.saccadeLength}
          min={SACCADE_RANGE.min}
          max={SACCADE_RANGE.max}
          onChange={(saccadeLength) => update({ saccadeLength })}
        />
      </div>
      <div className="setting">
        <span>Quiet sweep</span>
        <Toggle checked={settings.quietSweep} onChange={(quietSweep) => update({ quietSweep })} />
      </div>
    </Sheet>
  );
}
