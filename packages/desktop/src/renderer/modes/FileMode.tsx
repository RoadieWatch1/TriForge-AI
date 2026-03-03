import React, { useEffect, useState } from 'react';
import { ModeShell, SystemTile } from '../ui/Dashboard';
import { SYSTEM_REGISTRY } from '../core/AppState';

interface Props {
  onNavigate: (screen: string) => void;
}

interface DirEntry {
  label: string;
  path: string;
}

interface FileEntry {
  name: string;
  path: string;
  size: number;
  modified: string;
  extension: string;
}

interface DirResult {
  files: FileEntry[];
  subdirs: string[];
  error?: string;
}

export function FileMode({ onNavigate: _onNavigate }: Props) {
  const systems = SYSTEM_REGISTRY.filter(s => s.modes.includes('files'));
  const [dirs, setDirs] = useState<DirEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [dirResult, setDirResult] = useState<DirResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    window.triforge.files.commonDirs().then((result: Record<string, string>) => {
      const entries: DirEntry[] = Object.entries(result).map(([label, path]) => ({ label, path }));
      setDirs(entries);
    }).catch(() => {});
  }, []);

  const handleDirClick = async (path: string) => {
    setSelectedPath(path);
    setLoading(true);
    setDirResult(null);
    try {
      const result = await window.triforge.files.listDir(path);
      setDirResult(result);
    } catch {
      setDirResult({ files: [], subdirs: [], error: 'Failed to read directory.' });
    } finally {
      setLoading(false);
    }
  };

  const typeSummary = (files: FileEntry[]) => {
    const counts: Record<string, number> = {};
    for (const f of files) {
      const ext = f.extension?.toLowerCase() || 'other';
      counts[ext] = (counts[ext] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([ext, n]) => `${n} ${ext || 'other'}`)
      .join(' · ');
  };

  const extra = (
    <div style={styles.extraRoot}>
      {/* Common dirs */}
      <div style={styles.section}>
        <p style={styles.sectionLabel}>Common Directories</p>
        {dirs.length === 0 ? (
          <p style={styles.emptyNote}>Loading directories...</p>
        ) : (
          <div style={styles.dirList}>
            {dirs.map(d => (
              <button
                key={d.path}
                style={{
                  ...styles.dirBtn,
                  ...(selectedPath === d.path ? styles.dirBtnActive : {}),
                }}
                onClick={() => handleDirClick(d.path)}
              >
                <span style={styles.dirLabel}>{d.label}</span>
                <span style={styles.dirPath}>{d.path}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Dir result */}
      {selectedPath && (
        <div style={styles.section}>
          <div style={styles.resultHeader}>
            <p style={styles.sectionLabel}>Directory Contents</p>
            <button
              style={styles.scanBtn}
              onClick={() => console.log('[FileMode] stub: docs.index', selectedPath)}
            >
              Scan for Documents
            </button>
          </div>
          {loading && <p style={styles.emptyNote}>Reading directory...</p>}
          {!loading && dirResult?.error && (
            <p style={styles.errorNote}>{dirResult.error}</p>
          )}
          {!loading && dirResult && !dirResult.error && (
            <div style={styles.resultCard}>
              <div style={styles.resultRow}>
                <span style={styles.statLabel}>Files</span>
                <span style={styles.statValue}>{dirResult.files.length}</span>
              </div>
              <div style={styles.resultRow}>
                <span style={styles.statLabel}>Subdirectories</span>
                <span style={styles.statValue}>{dirResult.subdirs.length}</span>
              </div>
              {dirResult.files.length > 0 && (
                <div style={styles.resultRow}>
                  <span style={styles.statLabel}>Types</span>
                  <span style={styles.statValue}>{typeSummary(dirResult.files)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <ModeShell
      title="Files Mode"
      subtitle="Browse your filesystem, analyze directories, and scan documents for AI processing."
      extra={extra}
    >
      {systems.map(s => (
        <SystemTile
          key={s.id}
          system={s}
          onAction={() => console.log('[FileMode] stub: open file analyzer')}
          actionLabel="Open Analyzer"
        />
      ))}
    </ModeShell>
  );
}

const styles: Record<string, React.CSSProperties> = {
  extraRoot: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  sectionLabel: {
    fontSize: 9,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.3)',
    textTransform: 'uppercase',
    letterSpacing: '0.8px',
    margin: 0,
  },
  dirList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  dirBtn: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    padding: '8px 10px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 6,
    cursor: 'pointer',
    textAlign: 'left',
  },
  dirBtnActive: {
    background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.15)',
  },
  dirLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.7)',
  },
  dirPath: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.3)',
    fontFamily: 'monospace',
  },
  resultHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scanBtn: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 5,
    color: 'rgba(255,255,255,0.55)',
    fontSize: 10,
    fontWeight: 600,
    padding: '4px 10px',
    cursor: 'pointer',
  },
  resultCard: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 6,
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  resultRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.3)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    fontWeight: 600,
  },
  statValue: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
  },
  emptyNote: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.2)',
    margin: 0,
  },
  errorNote: {
    fontSize: 10,
    color: 'rgba(255,100,100,0.6)',
    margin: 0,
  },
};
