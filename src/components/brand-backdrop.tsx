// nexrees: animated NexRees backdrop for the login and setup screens (replaces HaVeWa's video).
// Pure CSS and SVG, no client JS. Over graphite: a neural mesh with twinkling nodes and neon data
// flowing along its links, and in the middle the NexRees N as a sharp neon outline that draws
// itself, flickers on, sways in 3D, has light chasing around its edge, a scan line sweeping
// through it and pulses running along its strokes, inside two turning rings. In front of it all
// sits a frosted glass pane (haze, grain, slow sheen); farther layers are blurred more for depth.
// Motion stops for people who ask their system for reduced motion.
// Children with className "nx-rise" fade up one after another (set --nx-delay per child).

// The NexRees mark, from NexRees/nexrees-brand dist/logo/svg/mark.svg (viewBox 0 0 200 200).
const MARK = "M0 0h31.11v200H0Zm0 0h43.71L200 200h-43.71Zm167.78 0H200v132.22L167.78 100Z";
// Centre lines of the N's strokes, for the travelling pulses.
const STROKE_A = "M15.5 200V0h6.3L178 200"; // up the left bar, down the diagonal
const STROKE_B = "M184 116V0"; // up the right bar
const NODES: [number, number][] = [
  [15.5, 200],
  [15.5, 0],
  [178, 200],
  [184, 0],
  [184, 116],
];

// Faint figures drifting up in the background: the kind of sums the software does all day,
// mixed with model maths. Decorative only (aria-hidden), very low contrast.
const CALC = [
  "Σ Vorauszahlung 2.940,00 €",
  "NK 2026 ÷ 12 = 245,00",
  "w·x + b = 0.8731",
  "Heizung 62,4 % × 1.180 m²",
  "∂L/∂w = -0.0042",
  "Grundsteuer ÷ MEA 84/1000",
  "softmax(z)ᵢ = 0.912",
  "Rücklage + 1.250,00 €",
  "Wasser 41,7 m³ × 4,18",
  "attn(Q,K,V) → 0.064",
  "Miete 9,85 €/m² × 72,4",
  "IBAN ✓  SEPA pain.008",
  "σ(1.73) = 0.849",
  "Saldo −312,40 → 0,00",
  "BetrKV §2 Nr. 4 → 18,3 %",
  "Δ Index 2,1 % p.a.",
];
const CALC_COLS = 7;

/** Deterministic neural mesh (same on server and every client, so no hydration differences). */
function mesh(count = 34, w = 1000, h = 600, link = 170) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const pts = Array.from({ length: count }, () => [Math.round(rnd() * w), Math.round(rnd() * h)] as const);
  const links: [number, number][] = [];
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++)
      if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) < link) links.push([i, j]);
  return { pts, links };
}
const MESH = mesh();

const CSS = `
.nx-backdrop{position:absolute;inset:0;z-index:-10;overflow:hidden;background:#07080B}
.nx-backdrop svg{position:absolute;overflow:visible}
.nx-glow{position:absolute;border-radius:9999px;filter:blur(110px);will-change:transform}
.nx-glow-a{width:55vmax;height:55vmax;left:-15vmax;top:-20vmax;background:#2340FF;opacity:.42;animation:nx-drift-a 16s ease-in-out infinite alternate}
.nx-glow-b{width:45vmax;height:45vmax;right:-15vmax;bottom:-18vmax;background:#22C8FF;opacity:.16;animation:nx-drift-b 20s ease-in-out infinite alternate}
.nx-mesh{inset:0;width:100%;height:100%;filter:blur(.6px)}
.nx-mesh line{stroke:#7B8CFF;stroke-opacity:.16;stroke-width:1}
.nx-mesh .nx-flow{stroke:#7FE6FF;stroke-opacity:.5;stroke-width:1.3;stroke-dasharray:.1 .9;stroke-linecap:round;filter:url(#nx-mesh-glow);animation:nx-run 2.2s linear infinite}
.nx-mesh circle{fill:#C9D6FF;animation:nx-twinkle 3s ease-in-out infinite}
.nx-stage{left:50%;top:50%;width:max(min(125vmin,1100px),560px);height:max(min(125vmin,1100px),560px);transform:translate(-50%,-50%);animation:nx-sway 12s ease-in-out infinite alternate}
.nx-ring{fill:none;transform-box:fill-box;transform-origin:center;filter:url(#nx-soft)}
.nx-ring-a{stroke:#5C7CFF;stroke-opacity:.55;stroke-width:.5;stroke-dasharray:1 4;animation:nx-spin 30s linear infinite}
.nx-ring-b{stroke:#4FD8FF;stroke-opacity:.35;stroke-width:.45;stroke-dasharray:22 8 3 8;animation:nx-spin 45s linear infinite reverse}
.nx-n-fill{fill:url(#nx-n-grad);opacity:.5}
.nx-neon{fill:none;stroke-linejoin:miter;stroke-dasharray:1;stroke-dashoffset:1;animation:nx-draw 2.2s cubic-bezier(.6,0,.2,1) .2s forwards,nx-flicker 1.2s linear 2.4s 1,nx-hum 4s ease-in-out 3.6s infinite}
.nx-neon-halo{stroke:#2E5BFF;stroke-opacity:.7;stroke-width:3;filter:url(#nx-wide)}
.nx-neon-mid{stroke:#6F8CFF;stroke-width:1.1;filter:url(#nx-soft)}
.nx-neon-core{stroke:#F4F7FF;stroke-width:.4}
.nx-chase{fill:none;stroke-width:1.5;stroke-linecap:round;stroke-dasharray:.12 .88;filter:url(#nx-soft);opacity:0;animation:nx-fade-in .4s ease-out 2.6s forwards,nx-run 5s linear 2.6s infinite}
.nx-chase-a{stroke:#E9FBFF}
.nx-chase-b{stroke:#4FD8FF;stroke-dasharray:.06 .44;animation-duration:.4s,7s;animation-direction:normal,reverse}
.nx-scan{opacity:0;animation:nx-scan 3.6s cubic-bezier(.5,0,.5,1) 2.6s infinite}
.nx-pulse{fill:none;stroke:#BFF3FF;stroke-opacity:.85;stroke-width:1.8;stroke-linecap:round;stroke-dasharray:.04 .96;filter:url(#nx-soft);opacity:0;animation:nx-fade-in .4s ease-out 2.8s forwards,nx-run 2.2s linear 2.8s infinite}
.nx-pulse-2{animation-delay:2.8s,3.9s}
.nx-pulse-b{animation-duration:.4s,1.6s;animation-delay:3s,3s}
.nx-node{fill:#fff;filter:url(#nx-soft);opacity:0;animation:nx-fade-in .3s ease-out 2.4s forwards}
.nx-node-ring{fill:none;stroke:#4FD8FF;stroke-width:.7;transform-box:fill-box;transform-origin:center;opacity:0;animation:nx-ping 2.2s ease-out 2.6s infinite}
.nx-calc{position:absolute;inset:0;display:flex;justify-content:space-around;font:500 11px/2.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#9FB2FF;opacity:.12;white-space:nowrap;filter:blur(1.4px);mask-image:linear-gradient(transparent,#000 20%,#000 80%,transparent)}
.nx-calc-col{animation:nx-up 60s linear infinite}
.nx-calc-col span{display:block}
.nx-calc-col span:nth-child(5n+2){color:#4FD8FF;animation:nx-blink 3.4s steps(1) infinite}
@keyframes nx-up{from{transform:translateY(0)}to{transform:translateY(-50%)}}
@keyframes nx-blink{0%,100%{opacity:1}50%{opacity:.25}}
.nx-glass{position:absolute;inset:0;-webkit-backdrop-filter:blur(1.6px) saturate(1.3);backdrop-filter:blur(1.6px) saturate(1.3);background:linear-gradient(135deg,rgba(220,230,255,.07),rgba(220,230,255,.015) 45%,rgba(79,216,255,.04));box-shadow:inset 0 0 0 1px rgba(255,255,255,.05),inset 0 0 160px rgba(79,140,255,.12),inset 0 1px 0 rgba(255,255,255,.12);overflow:hidden}
.nx-glass::before{content:"";position:absolute;inset:-50%;background:linear-gradient(115deg,transparent 40%,rgba(255,255,255,.06) 47%,rgba(255,255,255,.015) 50%,transparent 56%);animation:nx-sheen 14s ease-in-out infinite}
.nx-glass::after{content:"";position:absolute;inset:0;opacity:.09;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E")}
@keyframes nx-sheen{0%,100%{transform:translateX(-18%)}50%{transform:translateX(18%)}}
.nx-shade{position:absolute;inset:0;background:radial-gradient(65% 65% at 50% 50%,transparent 45%,rgba(7,8,11,.8) 100%)}
.nx-rise{opacity:0;animation:nx-rise .8s cubic-bezier(.2,.7,.2,1) forwards;animation-delay:var(--nx-delay,0ms)}
@keyframes nx-drift-a{to{transform:translate(22%,24%) scale(1.2)}}
@keyframes nx-drift-b{to{transform:translate(-24%,-20%) scale(.85)}}
@keyframes nx-sway{from{transform:translate(-50%,-50%) perspective(1400px) rotateY(-9deg) rotateX(3deg)}to{transform:translate(-50%,-50%) perspective(1400px) rotateY(9deg) rotateX(-3deg)}}
@keyframes nx-twinkle{0%,100%{opacity:.2}50%{opacity:1}}
@keyframes nx-spin{to{transform:rotate(360deg)}}
@keyframes nx-draw{to{stroke-dashoffset:0}}
@keyframes nx-fade-in{to{opacity:1}}
@keyframes nx-flicker{0%,18%,22%,52%,56%,100%{opacity:1}20%,54%{opacity:.25}}
@keyframes nx-hum{0%,100%{opacity:1}50%{opacity:.82}}
@keyframes nx-scan{0%{opacity:0;transform:translateY(-20px)}10%{opacity:1}85%{opacity:1}100%{opacity:0;transform:translateY(215px)}}
@keyframes nx-run{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
@keyframes nx-ping{0%{opacity:1;transform:scale(.4)}100%{opacity:0;transform:scale(2.8)}}
@keyframes nx-rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){
  .nx-backdrop *,.nx-rise{animation:none!important}
  .nx-rise,.nx-node{opacity:1}
  .nx-neon{stroke-dashoffset:0}
  .nx-pulse,.nx-scan,.nx-node-ring,.nx-chase,.nx-flow{display:none}
}
`;

export function BrandBackdrop() {
  return (
    <div className="nx-backdrop" aria-hidden="true">
      <style>{CSS}</style>
      <div className="nx-glow nx-glow-a" />
      <div className="nx-glow nx-glow-b" />

      <div className="nx-calc">
        {Array.from({ length: CALC_COLS }, (_, c) => {
          // Each column lists the figures twice so the upward loop is seamless.
          const col = CALC.map((_, i) => CALC[(i * 5 + c * 3) % CALC.length]);
          return (
            <div key={c} className="nx-calc-col" style={{ animationDuration: `${48 + c * 9}s`, animationDelay: `-${c * 7}s`, marginTop: `${(c % 3) * 40}px` }}>
              {[...col, ...col].map((t, i) => (
                <span key={i}>{t}</span>
              ))}
            </div>
          );
        })}
      </div>

      <svg className="nx-mesh" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice">
        <defs>
          <filter id="nx-mesh-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {MESH.links.map(([a, b], i) => (
          <line key={i} x1={MESH.pts[a][0]} y1={MESH.pts[a][1]} x2={MESH.pts[b][0]} y2={MESH.pts[b][1]} />
        ))}
        {MESH.links
          .filter((_, i) => i % 3 === 0)
          .map(([a, b], i) => (
            <line
              key={`f${i}`}
              className="nx-flow"
              pathLength={1}
              style={{ animationDelay: `${(i * 0.53) % 2.2}s` }}
              x1={MESH.pts[a][0]}
              y1={MESH.pts[a][1]}
              x2={MESH.pts[b][0]}
              y2={MESH.pts[b][1]}
            />
          ))}
        {MESH.pts.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i % 5 === 0 ? 2.4 : 1.5} style={{ animationDelay: `${(i * 0.37) % 4}s` }} />
        ))}
      </svg>

      <svg className="nx-stage" viewBox="-40 -40 280 280">
        <defs>
          <linearGradient id="nx-n-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#2340FF" stopOpacity=".35" />
            <stop offset="1" stopColor="#4FD8FF" stopOpacity=".08" />
          </linearGradient>
          <linearGradient id="nx-scan-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4FD8FF" stopOpacity="0" />
            <stop offset=".85" stopColor="#4FD8FF" stopOpacity=".35" />
            <stop offset="1" stopColor="#F4FDFF" stopOpacity="1" />
          </linearGradient>
          <clipPath id="nx-n-clip">
            <path d={MARK} />
          </clipPath>
          <filter id="nx-soft" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.1" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="nx-wide" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>

        <circle className="nx-ring nx-ring-a" cx="100" cy="100" r="132" />
        <circle className="nx-ring nx-ring-b" cx="100" cy="100" r="122" />

        <path className="nx-n-fill" d={MARK} />
        <g clipPath="url(#nx-n-clip)">
          <rect className="nx-scan" x="-10" y="-14" width="220" height="16" fill="url(#nx-scan-grad)" />
        </g>
        <path className="nx-neon nx-neon-halo" d={MARK} pathLength={1} />
        <path className="nx-neon nx-neon-mid" d={MARK} pathLength={1} />
        <path className="nx-neon nx-neon-core" d={MARK} pathLength={1} />
        <path className="nx-chase nx-chase-a" d={MARK} pathLength={1} />
        <path className="nx-chase nx-chase-b" d={MARK} pathLength={1} />

        <path className="nx-pulse" d={STROKE_A} pathLength={1} />
        <path className="nx-pulse nx-pulse-2" d={STROKE_A} pathLength={1} />
        <path className="nx-pulse nx-pulse-b" d={STROKE_B} pathLength={1} />

        {NODES.map(([x, y], i) => (
          <g key={i}>
            <circle className="nx-node-ring" cx={x} cy={y} r="5" style={{ animationDelay: `${2.6 + i * 0.45}s` }} />
            <circle className="nx-node" cx={x} cy={y} r="1.8" />
          </g>
        ))}
      </svg>

      <div className="nx-shade" />
      {/* Frosted glass pane between the animation and the person: haze, grain, a slow sheen. */}
      <div className="nx-glass" />
    </div>
  );
}
