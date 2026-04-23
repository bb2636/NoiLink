/**
 * 외부 이미지 호스팅 차단/네트워크 이슈 발생 시
 * 일관된 폴백 표시를 위한 인라인 SVG data URI 헬퍼.
 */

const PALETTE: Array<[string, string]> = [
  ['#AAED10', '#264213'],
  ['#3B82F6', '#1E3A8A'],
  ['#2DD4BF', '#0F766E'],
  ['#F59E0B', '#92400E'],
  ['#EF4444', '#7F1D1D'],
  ['#A78BFA', '#4C1D95'],
  ['#F472B6', '#831843'],
  ['#84CC16', '#365314'],
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function placeholderImage(seed: string, label = 'NoiLink', w = 400, h = 250): string {
  const [c1, c2] = PALETTE[hashString(seed) % PALETTE.length];
  const safeLabel = (label || '').replace(/[<>&]/g, '');
  const fontSize = Math.max(20, Math.min(48, Math.floor(w / Math.max(safeLabel.length, 4))));
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}'>
    <defs>
      <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
        <stop offset='0%' stop-color='${c1}'/>
        <stop offset='100%' stop-color='${c2}'/>
      </linearGradient>
    </defs>
    <rect width='${w}' height='${h}' fill='url(#g)'/>
    <text x='50%' y='50%' fill='rgba(255,255,255,0.75)' font-family='sans-serif' font-size='${fontSize}' font-weight='700' text-anchor='middle' dominant-baseline='middle'>${safeLabel}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** <img onError> 핸들러 — 실패 시 placeholder 로 대체 */
export function fallbackImg(seed: string, label = 'NoiLink') {
  return (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.dataset.fallback === '1') return;
    img.dataset.fallback = '1';
    img.src = placeholderImage(seed, label);
  };
}
