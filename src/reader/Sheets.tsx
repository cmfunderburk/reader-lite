import { useEffect, useRef, type ReactNode } from 'react';
import { FONT_SIZE_RANGE, PAGE_MARGIN_RANGE, SACCADE_RANGE, useSettings, type Theme } from '../settings';
import type { GenerationDifficulty } from './generationMask';
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

function Stepper({ value, min, max, step = 1, onChange, format }: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  return (
    <div className="stepper">
      <button className="button step" disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))} aria-label="Decrease">−</button>
      <span className="stepper-value">{format ? format(value) : value}</span>
      <button className="button step" disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))} aria-label="Increase">+</button>
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
const DIFFICULTIES: Array<[GenerationDifficulty, string]> = [['normal', 'Normal'], ['hard', 'Hard'], ['recall', 'Recall']];

function Segmented<T extends string>({ options, value, onChange }: {
  options: Array<[T, string]>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map(([option, label]) => (
        <button key={option} className={value === option ? 'selected' : ''} onClick={() => onChange(option)}>
          {label}
        </button>
      ))}
    </div>
  );
}

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
        <span>Margins</span>
        <Stepper
          value={settings.pageMargin}
          min={PAGE_MARGIN_RANGE.min}
          max={PAGE_MARGIN_RANGE.max}
          step={PAGE_MARGIN_RANGE.step}
          onChange={(pageMargin) => update({ pageMargin })}
          format={(margin) => `${margin}%`}
        />
      </div>
      <div className="setting">
        <span>Theme</span>
        <Segmented options={THEMES} value={settings.theme} onChange={(theme) => update({ theme })} />
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
      <h3 className="setting-group">Generation</h3>
      <div className="setting">
        <span>Masking</span>
        <Segmented
          options={DIFFICULTIES}
          value={settings.generationDifficulty}
          onChange={(generationDifficulty) => update({ generationDifficulty })}
        />
      </div>
      <p className="setting-note">
        Normal hides up to a quarter of a word's letters, Hard up to 40%, Recall all but the first and last.
      </p>
      <div className="setting">
        <span>Reveal behind the sweep</span>
        <Toggle checked={settings.sweepReveal} onChange={(sweepReveal) => update({ sweepReveal })} />
      </div>
    </Sheet>
  );
}
