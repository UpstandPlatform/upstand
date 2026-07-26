export function PageBackdrop() {
  return (
    <>
      <div className="absolute top-1/4 left-1/4 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-[120px]" />
      <div className="absolute right-1/4 bottom-1/4 h-96 w-96 rounded-full bg-accent/5 blur-[120px]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(var(--border),0.1)_1px,transparent_1px),linear-gradient(to_bottom,rgba(var(--border),0.1)_1px,transparent_1px)] bg-[size:32px_32px] opacity-10 [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)]" />
    </>
  );
}
