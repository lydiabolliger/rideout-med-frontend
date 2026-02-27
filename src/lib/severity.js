export function normalizeSeverityUI(v) {
  const s = String(v ?? "minor").toLowerCase();
  if (s.includes("severe") || s.includes("high") || s.includes("hoch")) return "high";
  if (s.includes("med") || s.includes("mittel")) return "medium";
  return "minor";
}

export function mapSeverityToDb(uiSeverity) {
  const s = normalizeSeverityUI(uiSeverity);
  if (s === "high") return "severe";
  if (s === "medium") return "medium";
  return "minor";
}

export function severityLabelDe(severity) {
  const s = String(severity ?? "minor").toLowerCase();
  if (s === "severe" || s === "high") return "hoch";
  if (s === "medium") return "mittel";
  return "tief";
}

export function severityBadgeClass(severity) {
  const s = String(severity ?? "").toLowerCase();
  if (s.includes("severe") || s.includes("high") || s.includes("3")) return "badge badge--high";
  if (s.includes("medium") || s.includes("med") || s.includes("2")) return "badge badge--med";
  return "badge badge--low";
}
