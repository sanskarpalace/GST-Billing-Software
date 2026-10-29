// A small branded line at the end of the Dashboard. Only the user sees it; it
// is never printed on an invoice.
export default function AppFooter() {
  return (
    <footer style={{
      marginTop: 'auto', paddingTop: '1.5rem',
      textAlign: 'center', fontSize: '0.72rem', color: 'var(--text-muted)',
    }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', justifyContent: 'center',
        padding: '0.3rem 0.85rem', borderRadius: 999, background: 'var(--card-bg)', border: '1px solid var(--border)',
        backdropFilter: 'blur(12px)',
      }}>
        <span>Sanskar Palace Hotel &amp; Resort</span>
      </span>
    </footer>
  );
}
