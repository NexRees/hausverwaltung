// nexrees: animated NexRees backdrop for the login and setup screens (replaces HaVeWa's video).
// Pure CSS, no client JS: two slow cobalt glows over graphite, a faint drifting grid and the
// N mark. Motion stops for people who ask their system for reduced motion.
// Children with className "nx-rise" fade up one after another (set --nx-delay per child).

const CSS = `
.nx-backdrop{position:absolute;inset:0;z-index:-10;overflow:hidden;background:#0A0B0E}
.nx-backdrop .nx-glow{position:absolute;border-radius:9999px;filter:blur(90px);opacity:.55;will-change:transform}
.nx-backdrop .nx-glow-a{width:60%;height:60%;left:-10%;top:-15%;background:#2340FF;animation:nx-drift-a 22s ease-in-out infinite alternate}
.nx-backdrop .nx-glow-b{width:50%;height:50%;right:-15%;bottom:-10%;background:#7B8CFF;opacity:.35;animation:nx-drift-b 28s ease-in-out infinite alternate}
.nx-backdrop .nx-grid{position:absolute;inset:-64px;opacity:.12;background-image:linear-gradient(#F6F7F9 1px,transparent 1px),linear-gradient(90deg,#F6F7F9 1px,transparent 1px);background-size:64px 64px;mask-image:radial-gradient(70% 60% at 50% 45%,#000 30%,transparent 100%);animation:nx-pan 40s linear infinite}
.nx-backdrop .nx-mark{position:absolute;right:-6%;top:50%;width:62%;max-width:560px;transform:translateY(-50%);opacity:.07;animation:nx-breathe 9s ease-in-out infinite}
.nx-backdrop .nx-shade{position:absolute;inset:0;background:linear-gradient(to top,rgba(10,11,14,.85),rgba(10,11,14,.25) 55%,rgba(10,11,14,.1))}
.nx-rise{opacity:0;animation:nx-rise .8s cubic-bezier(.2,.7,.2,1) forwards;animation-delay:var(--nx-delay,0ms)}
@keyframes nx-drift-a{from{transform:translate(0,0) scale(1)}to{transform:translate(18%,22%) scale(1.15)}}
@keyframes nx-drift-b{from{transform:translate(0,0) scale(1.1)}to{transform:translate(-20%,-18%) scale(.95)}}
@keyframes nx-pan{from{transform:translate(0,0)}to{transform:translate(64px,64px)}}
@keyframes nx-breathe{0%,100%{opacity:.06}50%{opacity:.11}}
@keyframes nx-rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.nx-backdrop *,.nx-rise{animation:none!important}.nx-rise{opacity:1}}
`;

export function BrandBackdrop() {
  return (
    <div className="nx-backdrop" aria-hidden="true">
      <style>{CSS}</style>
      <div className="nx-glow nx-glow-a" />
      <div className="nx-glow nx-glow-b" />
      <div className="nx-grid" />
      {/* NexRees mark, from NexRees/nexrees-brand dist/logo/svg/mark.svg */}
      <svg className="nx-mark" viewBox="0 0 200 200" fill="#F6F7F9">
        <path d="M0 0h31.11v200H0Zm0 0h43.71L200 200h-43.71Zm167.78 0H200v132.22L167.78 100Z" />
      </svg>
      <div className="nx-shade" />
    </div>
  );
}
