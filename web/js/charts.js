// Charts, as inline SVG.
//
// The native app used Swift Charts. There is no charting library here on
// purpose: two shapes are all FinApp draws, and a dependency you have to load
// over the network is a strange thing to add to an app whose selling point is
// that it works offline.

import { categoryColor, categoryName } from './categories.js';
import { format } from './money.js';

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

/**
 * Daily spending as vertical bars.
 *
 * @param {{date: Date, total: number}[]} days
 * @param {{currencyCode: string, locale?: string, todayIndex?: number}} options
 */
export function dailyBars(days, options) {
  if (days.length === 0) return '';

  const width = 100;
  const height = 42;
  const gap = 0.6;
  const barWidth = Math.max((width - gap * (days.length - 1)) / days.length, 0.4);
  const peak = Math.max(...days.map((day) => day.total), 1);

  const bars = days.map((day, index) => {
    const x = index * (barWidth + gap);
    // Anything non-zero keeps a visible stub, so a £2 day is not invisible.
    const barHeight = day.total > 0 ? Math.max((day.total / peak) * height, 1.2) : 0;
    const y = height - barHeight;
    const isToday = index === options.todayIndex;
    const label = `${day.date.toLocaleDateString(options.locale, { day: 'numeric', month: 'short' })}: `
      + format(day.total, options.currencyCode, options.locale);

    if (barHeight === 0) {
      return `<rect x="${x.toFixed(2)}" y="${(height - 0.6).toFixed(2)}" width="${barWidth.toFixed(2)}"`
        + ` height="0.6" rx="0.3" class="bar bar--empty"><title>${escapeText(label)}</title></rect>`;
    }
    return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}"`
      + ` height="${barHeight.toFixed(2)}" rx="0.4" class="bar${isToday ? ' bar--today' : ''}">`
      + `<title>${escapeText(label)}</title></rect>`;
  }).join('');

  return `<svg class="chart chart--bars" viewBox="0 0 ${width} ${height}"`
    + ` preserveAspectRatio="none" role="img" aria-label="Daily spending">${bars}</svg>`;
}

/**
 * Category split as a donut.
 *
 * @param {{category: string, total: number}[]} slices biggest first
 */
export function categoryDonut(slices, options) {
  const total = slices.reduce((sum, slice) => sum + slice.total, 0);
  if (total <= 0) return '';

  const size = 100;
  const centre = size / 2;
  const radius = 42;
  const thickness = 17;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const arcs = slices.map((slice) => {
    const fraction = slice.total / total;
    const length = fraction * circumference;
    // A hairline gap between slices, but never one wider than the slice.
    const gap = Math.min(1.2, length / 3);
    const arc = `<circle cx="${centre}" cy="${centre}" r="${radius}" fill="none"`
      + ` stroke="${categoryColor(slice.category)}" stroke-width="${thickness}"`
      + ` stroke-dasharray="${(length - gap).toFixed(2)} ${(circumference - length + gap).toFixed(2)}"`
      + ` stroke-dashoffset="${(-offset).toFixed(2)}">`
      + `<title>${escapeText(categoryName(slice.category))}: `
      + `${escapeText(format(slice.total, options.currencyCode, options.locale))}</title></circle>`;
    offset += length;
    return arc;
  }).join('');

  // Rotated so the first (largest) slice starts at twelve o'clock.
  return `<svg class="chart chart--donut" viewBox="0 0 ${size} ${size}" role="img"`
    + ` aria-label="Spending by category">`
    + `<g transform="rotate(-90 ${centre} ${centre})">${arcs}</g></svg>`;
}

/** A single horizontal progress bar, used for budgets. */
export function progressBar(spent, limit) {
  if (limit <= 0) return '';
  const fraction = Math.min(spent / limit, 1);
  const over = spent > limit;
  const state = over ? 'over' : (fraction > 0.85 ? 'close' : 'under');
  return `<div class="progress progress--${state}" role="progressbar"`
    + ` aria-valuenow="${Math.round(fraction * 100)}" aria-valuemin="0" aria-valuemax="100">`
    + `<span style="width:${(fraction * 100).toFixed(1)}%"></span></div>`;
}
