// nexrees: animated NexRees backdrop for the login and setup screens (replaces HaVeWa's video).
// Pure CSS and SVG, no client JS. Over graphite: a faint neural mesh with twinkling nodes and
// data flowing along its links, and in the middle the NexRees N that draws itself, gets scanned
// by a light sweep, and carries light pulses along its strokes inside two slowly turning rings.
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
.nx-backdrop{position:absolute;inset:0;z-index:-10;overflow:hidden;background:#0A0B0E}
.nx-backdrop svg{position:absolute;overflow:visible}
.nx-glow{position:absolute;border-radius:9999px;filter:blur(100px);will-change:transform}
.nx-glow-a{width:55vmax;height:55vmax;left:-15vmax;top:-20vmax;background:#2340FF;opacity:.45;animation:nx-drift-a 22s ease-in-out infinite alternate}
.nx-glow-b{width:45vmax;height:45vmax;right:-15vmax;bottom:-18vmax;background:#7B8CFF;opacity:.28;animation:nx-drift-b 28s ease-in-out infinite alternate}
.nx-mesh{inset:0;width:100%;height:100%}
.nx-mesh line{stroke:#7B8CFF;stroke-opacity:.14;stroke-width:1}
.nx-mesh .nx-flow{stroke:#B7C1FF;stroke-opacity:.55;stroke-width:1.4;stroke-dasharray:.08 .92;stroke-linecap:round;animation:nx-dash 3.2s linear infinite}
.nx-mesh circle{fill:#C9D0FF;animation:nx-twinkle 4s ease-in-out infinite}
.nx-stage{left:50%;top:50%;width:max(min(125vmin,1100px),560px);height:max(min(125vmin,1100px),560px);transform:translate(-50%,-50%)}
.nx-ring{fill:none;stroke:#7B8CFF;transform-box:fill-box;transform-origin:center}
.nx-ring-a{stroke-opacity:.22;stroke-width:.5;stroke-dasharray:1 5;animation:nx-spin 60s linear infinite}
.nx-ring-b{stroke-opacity:.14;stroke-width:.4;stroke-dasharray:18 9 2 9;animation:nx-spin 90s linear infinite reverse}
.nx-n-fill{fill:url(#nx-n-grad);opacity:0;animation:nx-fade-in 2s ease-out 1.6s forwards,nx-breathe 7s ease-in-out 3.6s infinite}
.nx-n-line{fill:none;stroke:#9FAAFF;stroke-width:.7;stroke-opacity:.9;stroke-dasharray:1;stroke-dashoffset:1;animation:nx-draw 2.6s cubic-bezier(.6,0,.2,1) .2s forwards}
.nx-scan{animation:nx-scan 5s ease-in-out 2.4s infinite;opacity:0}
.nx-pulse{fill:none;stroke:#fff;stroke-width:2.4;stroke-linecap:round;stroke-dasharray:.05 .95;stroke-dashoffset:1;filter:url(#nx-bloom);opacity:0;animation:nx-fade-in .6s ease-out 2.4s forwards,nx-run 3.4s linear 2.4s infinite}
.nx-pulse-2{animation-delay:2.4s,4.1s}
.nx-pulse-b{animation-duration:.6s,2.2s;animation-delay:2.6s,2.6s}
.nx-node{fill:#fff;opacity:0;animation:nx-fade-in .4s ease-out 2.2s forwards}
.nx-node-ring{fill:none;stroke:#B7C1FF;stroke-width:.8;transform-box:fill-box;transform-origin:center;opacity:0;animation:nx-ping 2.8s ease-out 2.4s infinite}
.nx-shade{position:absolute;inset:0;background:radial-gradient(60% 60% at 50% 50%,transparent 40%,rgba(10,11,14,.75) 100%)}
.nx-rise{opacity:0;animation:nx-rise .8s cubic-bezier(.2,.7,.2,1) forwards;animation-delay:var(--nx-delay,0ms)}
@keyframes nx-drift-a{to{transform:translate(18%,22%) scale(1.15)}}
@keyframes nx-drift-b{to{transform:translate(-20%,-18%) scale(.9)}}
@keyframes nx-dash{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
@keyframes nx-twinkle{0%,100%{opacity:.25}50%{opacity:.9}}
@keyframes nx-spin{to{transform:rotate(360deg)}}
@keyframes nx-draw{to{stroke-dashoffset:0}}
@keyframes nx-fade-in{to{opacity:1}}
@keyframes nx-breathe{0%,100%{opacity:1}50%{opacity:.55}}
@keyframes nx-scan{0%{opacity:0;transform:translateY(-70px)}15%{opacity:1}70%{opacity:1}100%{opacity:0;transform:translateY(240px)}}
@keyframes nx-run{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
@keyframes nx-ping{0%{opacity:.9;transform:scale(.4)}100%{opacity:0;transform:scale(2.6)}}
@keyframes nx-rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){
  .nx-backdrop *,.nx-rise{animation:none!important}
  .nx-rise,.nx-n-fill,.nx-node{opacity:1}
  .nx-n-line{stroke-dashoffset:0}
  .nx-pulse,.nx-scan,.nx-node-ring{display:none}
}
`;

export function BrandBackdrop() {
  return (
    <div className="nx-backdrop" aria-hidden="true">
      <style>{CSS}</style>
      <div className="nx-glow nx-glow-a" />
      <div className="nx-glow nx-glow-b" />

      <svg className="nx-mesh" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice">
        {MESH.links.map(([a, b], i) => (
          <line key={i} x1={MESH.pts[a][0]} y1={MESH.pts[a][1]} x2={MESH.pts[b][0]} y2={MESH.pts[b][1]} />
        ))}
        {MESH.links
          .filter((_, i) => i % 4 === 0)
          .map(([a, b], i) => (
            <line
              key={`f${i}`}
              className="nx-flow"
              pathLength={1}
              style={{ animationDelay: `${(i * 0.7) % 3.2}s` }}
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
            <stop offset="0" stopColor="#2340FF" stopOpacity=".7" />
            <stop offset="1" stopColor="#7B8CFF" stopOpacity=".25" />
          </linearGradient>
          <linearGradient id="nx-scan-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset=".5" stopColor="#DDE2FF" stopOpacity=".55" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <clipPath id="nx-n-clip">
            <path d={MARK} />
          </clipPath>
          <filter id="nx-bloom" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle className="nx-ring nx-ring-a" cx="100" cy="100" r="132" />
        <circle className="nx-ring nx-ring-b" cx="100" cy="100" r="122" />

        <path className="nx-n-fill" d={MARK} />
        <g clipPath="url(#nx-n-clip)">
          <rect className="nx-scan" x="-10" y="0" width="220" height="44" fill="url(#nx-scan-grad)" />
        </g>
        <path className="nx-n-line" d={MARK} pathLength={1} />

        <path className="nx-pulse" d={STROKE_A} pathLength={1} />
        <path className="nx-pulse nx-pulse-2" d={STROKE_A} pathLength={1} />
        <path className="nx-pulse nx-pulse-b" d={STROKE_B} pathLength={1} />

        {NODES.map(([x, y], i) => (
          <g key={i}>
            <circle className="nx-node-ring" cx={x} cy={y} r="5" style={{ animationDelay: `${2.4 + i * 0.55}s` }} />
            <circle className="nx-node" cx={x} cy={y} r="2" />
          </g>
        ))}
      </svg>

      <div className="nx-shade" />
    </div>
  );
}
