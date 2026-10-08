// Ilova belgisi — cycle halqasining soddalashtirilgan ko'rinishi (pastdan
// boshlanuvchi yoy), jadvaldagi asosiy element bilan bir xil til.
export default function BrandMark({ className = 'brand-mark' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="bm-g" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#b4e35a" />
          <stop offset="1" stopColor="#5ec8f7" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="9" fill="none" stroke="rgb(255 255 255 / 0.12)" strokeWidth="3" />
      <circle cx="12" cy="12" r="9" fill="none" stroke="url(#bm-g)" strokeWidth="3" strokeLinecap="round" strokeDasharray="40 57" transform="rotate(90 12 12)" />
    </svg>
  );
}
