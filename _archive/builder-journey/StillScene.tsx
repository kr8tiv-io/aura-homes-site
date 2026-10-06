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
        {/* tub */}
        <g transform="translate(770 712)">
          <rect x="-46" y="10" width="92" height="14" fill="#6f6152" />
          <rect x="-40" y="-4" width="5" height="26" fill="#8a7158" />
          <rect x="-30" y="-8" width="5" height="30" fill="#9a8064" />
          <rect x="-20" y="-11" width="5" height="33" fill="#8d7c66" />
          <rect x="-10" y="-13" width="5" height="35" fill="#a08a70" />
          <rect x="0" y="-11" width="5" height="33" fill="#8d7c66" />
          <rect x="10" y="-8" width="5" height="30" fill="#9a8064" />
          <rect x="20" y="-4" width="5" height="26" fill="#8a7158" />
          <rect x="-42" y="-16" width="84" height="5" fill="#6b5340" />
          <path d="M-28 -8 C-18 -18 18 -18 28 -8" fill="none" stroke="#4f8d86" strokeWidth="3" />
          <rect x="40" y="-2" width="16" height="14" fill="#3e3934" />
          <rect x="46" y="-28" width="4" height="26" fill="#8e948f" />
        </g>
        {/* steam */}
        <path
          d="M632 518 C628 498 652 490 640 468 C630 450 656 438 642 416"
          fill="none"
          stroke="#ffffff"
          strokeWidth="6"
          strokeLinecap="round"
          opacity="0.38"
        />
        <path
          d="M650 506 C658 488 636 476 652 456"
          fill="none"
          stroke="#ffffff"
          strokeWidth="3.5"
          strokeLinecap="round"
          opacity="0.26"
        />
      </svg>
    </div>
  );
}
