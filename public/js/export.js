export function exportPdf(incidentId) {
  window.location.href = `/api/incidents/${incidentId}/export.pdf`;
}

export function exportMarkdown(incidentId) {
  window.location.href = `/api/incidents/${incidentId}/export.md`;
}
