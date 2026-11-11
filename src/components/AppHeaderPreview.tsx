import { DEFAULT_HEADER_BOTTOM, DEFAULT_HEADER_TOP, headerTopColor } from '../utils/headerColor';

const BOX = 88;

interface Props {
  cityName: string;
  logoUrl: string;
  frame: 'disc' | 'none';
  /** '#RRGGBB'; empty/invalid = the default blue. */
  color: string;
  scale: number;
}

/** Phone-width mock of the app's home header, driven by the unsaved form state. */
export default function AppHeaderPreview({ cityName, logoUrl, frame, color, scale }: Props) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(color);
  const bottom = valid ? color : DEFAULT_HEADER_BOTTOM;
  const top = valid ? headerTopColor(color) : DEFAULT_HEADER_TOP;
  // Same rule as the app's CouncilLogo: in the disc the image is 1/1.3 of the
  // box at 100%, so 130% in the disc is exactly the size of 100% without a frame.
  const img = frame === 'disc' ? (BOX / 1.3) * scale : BOX * scale;

  return (
    <div dir="rtl" className="mx-auto overflow-hidden rounded-2xl border border-slate-200 shadow-sm"
      style={{ width: 360, background: `linear-gradient(to bottom, ${top}, ${bottom})` }}>
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
        <div className="min-w-0 text-white">
          <div className="text-sm opacity-90">בוקר טוב 👋</div>
          <div className="text-xl font-bold leading-tight">שם המשתמש</div>
          <div className="text-sm opacity-90 truncate">📍 {cityName || 'שם העיר'}</div>
        </div>
        {logoUrl ? (
          <div
            className="shrink-0 flex items-center justify-center overflow-hidden"
            style={frame === 'disc'
              ? { width: BOX, height: BOX, borderRadius: BOX / 2, background: '#fff' }
              : { width: BOX, height: BOX, borderRadius: 12 }}
          >
            {/* maxWidth none + no shrink: Tailwind's reset caps an img at its
                container's width, which would stop the preview enlarging past
                100% — the app does enlarge (and clips at the box edge). */}
            <img src={logoUrl} alt="" style={{ width: img, height: img, maxWidth: 'none', flexShrink: 0, objectFit: 'contain' }} />
          </div>
        ) : (
          <div className="shrink-0 flex items-center justify-center text-[11px] text-white/70 border border-dashed border-white/40"
            style={{ width: BOX, height: BOX, borderRadius: frame === 'disc' ? BOX / 2 : 12 }}>
            אין סמל
          </div>
        )}
      </div>
      <div className="mx-4 mb-4 rounded-lg px-3 py-2 text-center text-sm font-bold text-white"
        style={{ background: 'rgba(255,255,255,0.12)' }}>
        יום ג׳ · ל׳ חשוון תשפ״ז · 10.11
      </div>
    </div>
  );
}
