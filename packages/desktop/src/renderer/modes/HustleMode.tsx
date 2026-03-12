import React, { useState } from 'react';
import { ModeShell, SystemTile } from '../ui/Dashboard';
import { SYSTEM_REGISTRY } from '../core/AppState';

interface Props {
  onNavigate: (screen: string) => void;
}

export function HustleMode({ onNavigate }: Props) {
  const systems = SYSTEM_REGISTRY.filter(s => s.modes.includes('hustle'));
  const [prompt, setPrompt] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setImageUrl(null);
    setImageError(null);
    try {
      const result = await window.triforge.forgeEngine.generateImage(prompt.trim());
      if (result.error) {
        setImageError(result.error);
      } else if (result.url) {
        setImageUrl(result.url);
      }
    } catch (err) {
      setImageError('Image generation failed. Check your API key in Settings.');
    } finally {
      setGenerating(false);
    }
  };

  const visualSystem  = systems.find(s => s.id === 'visual_engine');
  const tradeSystem   = systems.find(s => s.id === 'trade_desk');
  const liveAdvisor   = systems.find(s => s.id === 'live_trade_advisor');
  const otherSystems  = systems.filter(s => !['visual_engine', 'trade_desk', 'live_trade_advisor'].includes(s.id));

  return (
    <ModeShell
      title="Hustle Mode"
      subtitle="Generate revenue — visuals, deals, and investor outreach in one place."
    >
      {/* Visual Engine with inline image generator */}
      {visualSystem && (
        <SystemTile
          key={visualSystem.id}
          system={visualSystem}
          onAction={() => {}}
          actionLabel="Generate"
        >
          <div style={styles.generatorPanel}>
            <div style={styles.promptRow}>
              <input
                style={styles.promptInput}
                placeholder="Describe the image to generate..."
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleGenerate(); }}
              />
              <button
                style={{
                  ...styles.generateBtn,
                  ...(generating ? styles.generateBtnDisabled : {}),
                }}
                onClick={handleGenerate}
                disabled={generating || !prompt.trim()}
              >
                {generating ? 'Generating...' : 'Generate'}
              </button>
            </div>
            {imageError && <p style={styles.imageError}>{imageError}</p>}
            {imageUrl && (
              <div style={styles.imageWrapper}>
                <img src={imageUrl} alt="Generated" style={styles.generatedImage} />
                <button
                  style={styles.regenerateBtn}
                  onClick={handleGenerate}
                  disabled={generating}
                >
                  Regenerate
                </button>
              </div>
            )}
          </div>
        </SystemTile>
      )}

      {/* Trade Desk */}
      {tradeSystem && (
        <SystemTile
          key={tradeSystem.id}
          system={tradeSystem}
          onAction={() => onNavigate('tradeDesk')}
          actionLabel="Open Trade Desk"
        />
      )}

      {/* Live Trade Advisor */}
      {liveAdvisor && (
        <SystemTile
          key={liveAdvisor.id}
          system={liveAdvisor}
          onAction={() => onNavigate('liveTradeAdvisor')}
          actionLabel="Open Live Trade Advisor"
        />
      )}

      {/* Coming soon systems */}
      {otherSystems.map(s => (
        <SystemTile
          key={s.id}
          system={s}
          onAction={() => console.log(`[HustleMode] stub: ${s.id} action`)}
          actionLabel={s.id === 'deal_closer' ? 'Set Up Deals' : 'Find Investors'}
        />
      ))}
    </ModeShell>
  );
}

const styles: Record<string, React.CSSProperties> = {
  generatorPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    marginTop: 10,
    paddingTop: 10,
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  promptRow: {
    display: 'flex',
    gap: 8,
  },
  promptInput: {
    flex: 1,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    padding: '7px 10px',
    outline: 'none',
    boxSizing: 'border-box',
  },
  generateBtn: {
    background: 'rgba(96,165,250,0.15)',
    border: '1px solid rgba(96,165,250,0.3)',
    borderRadius: 6,
    color: '#60a5fa',
    fontSize: 11,
    fontWeight: 600,
    padding: '7px 16px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  generateBtnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  imageError: {
    fontSize: 11,
    color: 'rgba(255,100,100,0.7)',
    margin: 0,
  },
  imageWrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  generatedImage: {
    width: '100%',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.08)',
  },
  regenerateBtn: {
    alignSelf: 'flex-start',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 5,
    color: 'rgba(255,255,255,0.45)',
    fontSize: 10,
    fontWeight: 600,
    padding: '4px 12px',
    cursor: 'pointer',
  },
};
