import React from 'react';

interface Props {
  imageUrl: string | null;
  imageError: string | null;
  generating: boolean;
  formReady: boolean;
  onGenerate: () => void;
}

export function PreviewPanel({ imageUrl, imageError, generating, formReady, onGenerate }: Props) {
  const handleExport = () => {
    if (!imageUrl) return;
    window.triforge.system.openExternal(imageUrl);
  };

  return (
    <div style={styles.root}>
      {/* Image area */}
      <div style={styles.imageArea}>
        {generating ? (
          <div style={styles.placeholder}>
            <p style={styles.placeholderText}>Generating...</p>
          </div>
        ) : imageUrl ? (
          <img src={imageUrl} alt="Generated" style={styles.image} />
        ) : (
          <div style={styles.placeholder}>
            <p style={styles.placeholderLabel}>PREVIEW</p>
            <p style={styles.placeholderText}>
              {imageError ?? 'Complete the form and click Generate.'}
            </p>
          </div>
        )}
      </div>

      {/* Error */}
      {imageError && !generating && (
        <p style={styles.errorText}>{imageError}</p>
      )}

      {/* Actions */}
      <div style={styles.actions}>
        <button
          style={{
            ...styles.generateBtn,
            ...((!formReady || generating) ? styles.generateBtnDisabled : {}),
          }}
          onClick={onGenerate}
          disabled={!formReady || generating}
        >
          {generating ? 'Generating...' : imageUrl ? 'Regenerate' : 'Generate'}
        </button>
        {imageUrl && (
          <>
            <button style={styles.secondaryBtn} onClick={handleExport}>
              Export
            </button>
            <button
              style={styles.secondaryBtn}
              onClick={() => console.log('[Builder] stub: Send to Forge')}
            >
              Send to Forge
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    height: '100%',
  },
  imageArea: {
    flex: 1,
    minHeight: 200,
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 8,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
  },
  placeholder: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    padding: 24,
  },
  placeholderLabel: {
    fontSize: 9,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.15)',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    margin: 0,
  },
  placeholderText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
    margin: 0,
    textAlign: 'center',
    lineHeight: 1.5,
  },
  errorText: {
    fontSize: 11,
    color: 'rgba(255,100,100,0.7)',
    margin: 0,
  },
  actions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  generateBtn: {
    background: 'rgba(96,165,250,0.15)',
    border: '1px solid rgba(96,165,250,0.3)',
    borderRadius: 6,
    color: '#60a5fa',
    fontSize: 11,
    fontWeight: 700,
    padding: '8px 18px',
    cursor: 'pointer',
    letterSpacing: '0.3px',
  },
  generateBtnDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
  secondaryBtn: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: 600,
    padding: '8px 14px',
    cursor: 'pointer',
  },
};
