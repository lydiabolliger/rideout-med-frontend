export default function AdminOnly({ isAdmin, children }) {
  if (!isAdmin) {
    return (
      <div style={{ padding: 12, border: "1px solid #444", borderRadius: 8 }}>
        <strong>Kein Zugriff.</strong>
        <div>Dieser Bereich ist nur für Admins.</div>
      </div>
    );
  }
  return children;
}
