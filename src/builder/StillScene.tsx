"use client";

/** No-WebGL fallback: a flat illustrated still of the clearing — pale sky,
 *  treeline, the cabin, sun — so the page always shows the world. */
export default function StillScene() {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 0 }} aria-hidden>
      <svg
        viewBox="0 0 1200 800"
        preserveAspectRatio="xMidYMax slice"
        style={{ width: "100%", height: "100%", display: "block" }}
      >
        <defs>
          <linearGradient id="st-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#eaf3ee" />
            <stop offset="0.55" stopColor="#dcebe2" />
            <stop offset="1" stopColor="#cfe2d6" />
          </linearGradient>
          <radialGradient id="st-sun" cx="0.78" cy="0.2" r="0.5">
            <stop offset="0" stopColor="rgba(255,238,200,0.9)" />
            <stop offset="1" stopColor="rgba(255,238,200,0)" />
          </radialGradient>
        </defs>
        <rect width="1200" height="800" fill="url(#st-sky)" />
        <rect width="1200" height="800" fill="url(#st-sun)" />
        {/* far treeline */}
        <path
          d="M0 560 L60 500 L120 560 L170 480 L230 560 L300 510 L360 560 L420 470 L500 560 L560 505 L620 560 L700 485 L780 560 L840 515 L900 560 L980 480 L1060 560 L1120 520 L1200 560 L1200 800 L0 800 Z"
          fill="#9dbfa8"
          opacity="0.7"
        />
        {/* near treeline */}
        <path
          d="M0 640 L80 540 L160 640 L240 560 L330 650 L400 545 L470 645 L560 585 L640 655 L740 550 L830 650 L920 575 L1000 655 L1090 560 L1200 650 L1200 800 L0 800 Z"
          fill="#5d8a68"
        />
        {/* meadow */}
        <rect y="655" width="1200" height="145" fill="#8fae86" />
        {/* cabin */}
        <g transform="translate(600 610)">
          <rect x="-95" y="-10" width="190" height="88" fill="#6b4a30" />
          <path d="M-125 -8 L0 -95 L125 -8 Z" fill="#3c4f44" />
          <rect x="28" y="-88" width="22" height="46" fill="#b9b3a8" />
          <rect x="-30" y="22" width="34" height="56" fill="#2e2a24" />
          <rect x="24" y="26" width="30" height="30" fill="#dfeae2" />
          <rect x="-95" y="78" width="190" height="10" fill="#54381f" />
        </g>
        {/* hot tub */}
        <g transform="translate(770 712)">
          <ellipse cx="0" cy="16" rx="44" ry="12" fill="#7c5236" />
          <rect x="-44" y="-14" width="88" height="30" fill="#8a5a3a" />
          <ellipse cx="0" cy="-14" rx="44" ry="12" fill="#1d8f86" />
        </g>
        {/* smoke */}
        <g fill="#ffffff" opacity="0.55">
          <circle cx="640" cy="500" r="10" />
          <circle cx="648" cy="474" r="14" />
          <circle cx="638" cy="443" r="18" />
        </g>
      </svg>
    </div>
  );
}
