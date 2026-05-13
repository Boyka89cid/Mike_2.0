export function generateDomainHealthChart(
  domains: { domain_slug: string; answered: number; unanswered: number; chunk_count: number; is_thin: boolean }[]
): string {
  const maxLabelLen = Math.max(...domains.map(d => d.domain_slug.length), 4);
  const bottomMargin = Math.max(90, Math.ceil(maxLabelLen * 5.2) + 30);
  const W = 620, H = 340 + bottomMargin;
  const m = { top: 50, right: 20, bottom: bottomMargin, left: 50 };
  const cW = W - m.left - m.right, cH = H - m.top - m.bottom;
  const maxTotal = Math.max(...domains.map(d => d.answered + d.unanswered), 1);
  const barW = Math.min(70, cW / domains.length - 12);
  const slot = cW / domains.length;

  const yTicks = Array.from({ length: 6 }, (_, i) => Math.round(maxTotal * i / 5));
  const yAxis = yTicks.map(v => {
    const y = m.top + cH - (v / maxTotal) * cH;
    return `<line x1="${m.left}" y1="${y}" x2="${W - m.right}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>
    <text x="${m.left - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#6b7280">${v}</text>`;
  }).join('');

  const bars = domains.map((d, i) => {
    const x = m.left + i * slot + (slot - barW) / 2;
    const totalH = Math.max(((d.answered + d.unanswered) / maxTotal) * cH, 2);
    const answeredH = d.answered + d.unanswered > 0 ? (d.answered / (d.answered + d.unanswered)) * totalH : 0;
    const unansweredH = totalH - answeredH;
    const baseY = m.top + cH;
    return `<rect x="${x}" y="${baseY - totalH}" width="${barW}" height="${unansweredH}" fill="#ef4444" rx="3"/>
    <rect x="${x}" y="${baseY - answeredH}" width="${barW}" height="${answeredH}" fill="#22c55e" rx="0"/>
    <text x="${x + barW / 2}" y="${baseY - totalH - 5}" text-anchor="middle" font-size="10" fill="#374151">${d.answered}/${d.answered + d.unanswered}</text>
    <text x="${x + barW / 2}" y="${m.top + cH + 18}" text-anchor="middle" font-size="10" fill="${d.is_thin ? '#ef4444' : '#6b7280'}">${d.domain_slug.length > 13 ? d.domain_slug.slice(0, 12) + '…' : d.domain_slug}</text>`;
  }).join('');

  const legendY = H - 18;
  const legend = [
    ['#22c55e', 'Answered'], ['#ef4444', 'Unanswered'], ['#ef4444', 'Thin domain name'],
  ].map(([c, l], i) => `<rect x="${m.left + i * 155}" y="${legendY - 10}" width="12" height="12" fill="${c}" rx="2"/>
  <text x="${m.left + i * 155 + 16}" y="${legendY}" font-size="10" fill="#374151">${l}</text>`).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#ffffff" rx="8"/>
  <text x="${W / 2}" y="26" text-anchor="middle" font-size="14" font-weight="bold" fill="#111827">Domain Health — Answered vs Unanswered</text>
  ${yAxis}
  <line x1="${m.left}" y1="${m.top}" x2="${m.left}" y2="${m.top + cH}" stroke="#d1d5db" stroke-width="1"/>
  ${bars}
  ${legend}
  </svg>`;
}

export function generateDomainBreakdownChart(
  breakdown: { domain_slug: string; total_asks: number; avg_kb_chunks_per_query: number }[],
  mostAsked: string | null,
  weakest: string | null
): string {
  const maxLabelLen = Math.max(...breakdown.map(d => d.domain_slug.length), 4);
  const bottomMargin = Math.max(90, Math.ceil(maxLabelLen * 5.2) + 30);
  const W = 620, H = 340 + bottomMargin;
  const m = { top: 40, right: 20, bottom: bottomMargin, left: 50 };
  const cW = W - m.left - m.right, cH = H - m.top - m.bottom;
  const maxAsks = Math.max(...breakdown.map(d => d.total_asks), 1);
  const barW = Math.min(70, cW / breakdown.length - 12);
  const slot = cW / breakdown.length;

  const yTicks = Array.from({ length: 6 }, (_, i) => Math.round(maxAsks * i / 5));
  const yAxis = yTicks.map(v => {
    const y = m.top + cH - (v / maxAsks) * cH;
    return `<line x1="${m.left}" y1="${y}" x2="${W - m.right}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>
    <text x="${m.left - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#6b7280">${v}</text>`;
  }).join('');

  const bars = breakdown.map((d, i) => {
    const x = m.left + i * slot + (slot - barW) / 2;
    const bH = Math.max((d.total_asks / maxAsks) * cH, 2);
    const y = m.top + cH - bH;
    const fill = d.domain_slug === mostAsked ? '#22c55e' : d.domain_slug === weakest ? '#ef4444' : '#3b82f6';
    return `<rect x="${x}" y="${y}" width="${barW}" height="${bH}" fill="${fill}" rx="3"/>
    <text x="${x + barW / 2}" y="${y - 5}" text-anchor="middle" font-size="11" fill="#374151">${d.total_asks}</text>
    <text x="${x + barW / 2}" y="${m.top + cH + 18}" text-anchor="middle" font-size="10" fill="#6b7280">${d.domain_slug.length > 13 ? d.domain_slug.slice(0, 12) + '…' : d.domain_slug}</text>`;
  }).join('');

  const legendY = H - 18;
  const legend = [
    ['#22c55e', 'Most Asked'], ['#ef4444', 'Weakest KB'], ['#3b82f6', 'Other'],
  ].map(([c, l], i) => `<rect x="${m.left + i * 130}" y="${legendY - 10}" width="12" height="12" fill="${c}" rx="2"/>
  <text x="${m.left + i * 130 + 16}" y="${legendY}" font-size="10" fill="#374151">${l}</text>`).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#ffffff" rx="8"/>
  <text x="${W / 2}" y="26" text-anchor="middle" font-size="14" font-weight="bold" fill="#111827">Domain Query Breakdown</text>
  ${yAxis}
  <line x1="${m.left}" y1="${m.top}" x2="${m.left}" y2="${m.top + cH}" stroke="#d1d5db" stroke-width="1"/>
  ${bars}
  ${legend}
  </svg>`;
}
