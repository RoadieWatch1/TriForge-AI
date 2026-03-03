import React, { useState } from 'react';
import type { FieldDef } from './GuidedForm';
import { GuidedForm } from './GuidedForm';
import { PreviewPanel } from './PreviewPanel';
import { AssetGrid } from './AssetGrid';
import type { Asset } from './AssetGrid';

export type { FieldDef };

interface StudioShellProps {
  title: string;
  description: string;
  onBack: () => void;
  fields: FieldDef[];
  buildPrompt: (values: Record<string, string>) => string;
  assetTitle: (values: Record<string, string>) => string;
  implementationPlan: (values: Record<string, string>) => string;
}

export function StudioShell({
  title,
  description,
  onBack,
  fields,
  buildPrompt,
  assetTitle,
  implementationPlan,
}: StudioShellProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);

  const formReady = fields
    .filter(f => f.type === 'select')
    .every(f => !!values[f.key]);

  const handleValueChange = (key: string, value: string) => {
    setValues(prev => ({ ...prev, [key]: value }));
  };

  const handleGenerate = async () => {
    if (!formReady || generating) return;
    setGenerating(true);
    setImageError(null);
    const prompt = buildPrompt(values);
    try {
      const result = await window.triforge.forgeEngine.generateImage(prompt);
      if (result.error) {
        setImageError(result.error);
      } else if (result.url) {
        setImageUrl(result.url);
        const asset: Asset = {
          url: result.url,
          label: assetTitle(values),
          plan: implementationPlan(values),
        };
        setAssets(prev => [asset, ...prev]);
      }
    } catch {
      setImageError('Generation failed. Check your OpenAI API key in Settings.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div style={styles.root}>
      {/* Header */}
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={onBack}>
          Back
        </button>
        <div style={styles.headerText}>
          <p style={styles.title}>{title}</p>
          <p style={styles.description}>{description}</p>
        </div>
      </div>

      {/* Main split */}
      <div style={styles.splitLayout}>
        {/* Left — Guided Form */}
        <div style={styles.leftPanel}>
          <p style={styles.panelLabel}>Inputs</p>
          <GuidedForm fields={fields} values={values} onChange={handleValueChange} />
        </div>

        {/* Right — Preview */}
        <div style={styles.rightPanel}>
          <p style={styles.panelLabel}>Preview</p>
          <PreviewPanel
            imageUrl={imageUrl}
            imageError={imageError}
            generating={generating}
            formReady={formReady}
            onGenerate={handleGenerate}
          />
        </div>
      </div>

      {/* Asset grid */}
      <AssetGrid assets={assets} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
    padding: '20px 20px 40px',
    overflowY: 'auto',
    height: '100%',
    boxSizing: 'border-box',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 14,
  },
  backBtn: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.45)',
    fontSize: 10,
    fontWeight: 700,
    padding: '6px 12px',
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    flexShrink: 0,
    marginTop: 2,
  },
  headerText: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  title: {
    fontSize: 15,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.9)',
    margin: 0,
    letterSpacing: '0.2px',
  },
  description: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    margin: 0,
    lineHeight: 1.5,
  },
  splitLayout: {
    display: 'grid',
    gridTemplateColumns: '2fr 3fr',
    gap: 16,
    minHeight: 300,
  },
  leftPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 10,
    padding: '14px 16px',
  },
  rightPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 10,
    padding: '14px 16px',
  },
  panelLabel: {
    fontSize: 9,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.3)',
    textTransform: 'uppercase',
    letterSpacing: '0.8px',
    margin: 0,
  },
};
