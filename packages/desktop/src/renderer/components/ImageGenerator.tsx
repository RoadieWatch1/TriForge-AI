import React, { useState } from 'react';

interface Props {
  tier:    string;
  onBack?: () => void;
}

export function ImageGenerator({ tier, onBack }: Props) {
  const [prompt, setPrompt]         = useState('');
  const [imageUrl, setImageUrl]     = useState<string | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setError(null);
    // Keep old image visible while generating — only replace on success
    try {
      const result = await (window as any).triforge.forgeEngine.generateImage(prompt.trim());
      if (result.error) {
        setError(result.error as string);
      } else if (result.url) {
        setImageUrl(result.url as string);
      } else {
        setError('No image returned. Check your OpenAI API key in Settings.');
      }
    } catch {
      setError('Image generation failed. Check your OpenAI API key in Settings.');
    } finally {
      setGenerating(false);
    }
  };

  // Fetch image as blob so Electron can trigger a native save dialog
  const handleDownload = async () => {
    if (!imageUrl) return;
    setDownloading(true);
    try {
      const response = await fetch(imageUrl);
      const blob     = await response.blob();
      const blobUrl  = URL.createObjectURL(blob);
      const a        = document.createElement('a');
      a.href         = blobUrl;
      a.download     = `triforge-image-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
    } catch {
      // Fallback: open in default browser so user can save manually
      window.open(imageUrl, '_blank');
    } finally {
      setDownloading(false);
    }
  };

  const locked = tier === 'free';

  return (
    <div style={styles.root}>
      {/* Header */}
      <div style={styles.header}>
        {onBack && (
          <button style={styles.backBtn} onClick={onBack}>Back</button>
        )}
        <div style={styles.headerText}>
          <h2 style={styles.title}>Visual Engine</h2>
          <p style={styles.subtitle}>Generate marketing images, mockups, and promos via DALL-E 3.</p>
        </div>
      </div>

      {locked ? (
        <div style={styles.lockedBanner}>
          Visual Engine requires a Pro or Business plan. Upgrade in Settings to generate images.
        </div>
      ) : (
        <>
          {/* Prompt input */}
          <div style={styles.inputCard}>
            <label style={styles.inputLabel}>Describe the image</label>
            <textarea
              style={styles.textarea}
              placeholder="e.g. A bold product launch banner for a minimalist productivity app, dark theme, neon accents, 16:9"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={4}
            />
            <div style={styles.inputRow}>
              <span style={styles.hint}>
                Be specific: include style, mood, format, colors, and purpose for best results.
              </span>
              <button
                style={{
                  ...styles.generateBtn,
                  ...(generating || !prompt.trim() ? styles.generateBtnDisabled : {}),
                }}
                onClick={handleGenerate}
                disabled={generating || !prompt.trim()}
              >
                {generating ? 'Generating...' : 'Generate'}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && <div style={styles.errorBanner}>{error}</div>}

          {/* Generating overlay when an image already exists */}
          {generating && imageUrl && (
            <div style={styles.generatingOverlay}>Generating new image...</div>
          )}

          {/* Result */}
          {imageUrl && (
            <div style={styles.resultCard}>
              <div style={styles.imageWrapper}>
                <img
                  src={imageUrl}
                  alt="Generated"
                  style={{ ...styles.image, ...(generating ? styles.imageGenerating : {}) }}
                />
              </div>
              <div style={styles.resultActions}>
                <button
                  style={{
                    ...styles.downloadBtn,
                    ...(downloading ? styles.downloadBtnDisabled : {}),
                  }}
                  onClick={handleDownload}
                  disabled={downloading}
                >
                  {downloading ? 'Saving...' : 'Download'}
                </button>
                <button
                  style={{
                    ...styles.regenerateBtn,
                    ...(generating ? styles.regenerateBtnDisabled : {}),
                  }}
                  onClick={handleGenerate}
                  disabled={generating || !prompt.trim()}
                >
                  {generating ? 'Generating...' : 'Regenerate'}
                </button>
              </div>
            </div>
          )}

          {/* Generating spinner when no image exists yet */}
          {generating && !imageUrl && (
            <div style={styles.generatingState}>
              <div style={styles.spinner} />
              Generating image — this takes 10–20 seconds...
            </div>
          )}

          {/* Empty state */}
          {!imageUrl && !error && !generating && (
            <div style={styles.emptyState}>
              Your generated image will appear here.
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    padding: '20px 24px',
    maxWidth: 780,
    width: '100%',
    boxSizing: 'border-box',
    // Scroll fix: flex: 1 fills parent, minHeight: 0 allows shrinking,
    // overflowY: auto enables scrolling within the flex child
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    flexShrink: 0,
  },
  backBtn: {
    background: 'none',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.45)',
    cursor: 'pointer',
    fontSize: 11,
    padding: '5px 10px',
    whiteSpace: 'nowrap',
    marginTop: 2,
    flexShrink: 0,
  },
  headerText: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  title: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 18,
    fontWeight: 700,
    margin: 0,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    margin: 0,
  },
  lockedBanner: {
    background: 'rgba(251,191,36,0.08)',
    border: '1px solid rgba(251,191,36,0.2)',
    borderRadius: 8,
    color: 'rgba(251,191,36,0.8)',
    fontSize: 12,
    padding: '14px 16px',
  },
  inputCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '16px',
    flexShrink: 0,
  },
  inputLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  textarea: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 7,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    lineHeight: 1.6,
    outline: 'none',
    padding: '10px 12px',
    resize: 'vertical',
    width: '100%',
    boxSizing: 'border-box',
  },
  inputRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  hint: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: 11,
    flex: 1,
  },
  generateBtn: {
    background: 'rgba(96,165,250,0.15)',
    border: '1px solid rgba(96,165,250,0.35)',
    borderRadius: 7,
    color: '#60a5fa',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 700,
    padding: '8px 20px',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  generateBtnDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
  errorBanner: {
    background: 'rgba(248,113,113,0.08)',
    border: '1px solid rgba(248,113,113,0.2)',
    borderRadius: 8,
    color: '#f87171',
    fontSize: 12,
    padding: '10px 14px',
    flexShrink: 0,
  },
  generatingOverlay: {
    background: 'rgba(96,165,250,0.08)',
    border: '1px solid rgba(96,165,250,0.2)',
    borderRadius: 8,
    color: '#60a5fa',
    fontSize: 12,
    padding: '10px 14px',
    flexShrink: 0,
    textAlign: 'center',
  },
  resultCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: 16,
    flexShrink: 0,
  },
  imageWrapper: {
    position: 'relative',
  },
  image: {
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.07)',
    width: '100%',
    display: 'block',
    transition: 'opacity 0.3s',
  },
  imageGenerating: {
    opacity: 0.4,
  },
  resultActions: {
    display: 'flex',
    gap: 8,
  },
  downloadBtn: {
    background: 'rgba(74,222,128,0.12)',
    border: '1px solid rgba(74,222,128,0.3)',
    borderRadius: 6,
    color: '#4ade80',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 600,
    padding: '6px 14px',
  },
  downloadBtnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  regenerateBtn: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.45)',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 600,
    padding: '6px 14px',
  },
  regenerateBtnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  generatingState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    border: '1px dashed rgba(96,165,250,0.2)',
    borderRadius: 10,
    color: 'rgba(96,165,250,0.6)',
    fontSize: 12,
    padding: '48px 24px',
    flexShrink: 0,
  },
  spinner: {
    width: 16,
    height: 16,
    border: '2px solid rgba(96,165,250,0.2)',
    borderTop: '2px solid #60a5fa',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    flexShrink: 0,
  },
  emptyState: {
    border: '1px dashed rgba(255,255,255,0.08)',
    borderRadius: 10,
    color: 'rgba(255,255,255,0.2)',
    fontSize: 12,
    padding: '48px 24px',
    textAlign: 'center',
    flexShrink: 0,
  },
};
