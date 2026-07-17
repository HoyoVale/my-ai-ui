export function MemoryIcon({
  name,
  size = 18
}) {
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true
  };

  const icons = {
    plus: (
      <path d="M12 5v14M5 12h14" />
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m15.5 15.5 4 4" />
      </>
    ),
    brain: (
      <>
        <path d="M9.5 4.5A3 3 0 0 0 6.7 8a3.2 3.2 0 0 0-.7 5.9A3 3 0 0 0 9.5 19" />
        <path d="M14.5 4.5A3 3 0 0 1 17.3 8a3.2 3.2 0 0 1 .7 5.9 3 3 0 0 1-3.5 5.1" />
        <path d="M9.5 4.5v15M14.5 4.5v15M9.5 9h2M12.5 15h2" />
      </>
    ),
    trash: (
      <>
        <path d="M4.5 7h15" />
        <path d="M9 7V4.5h6V7M7.5 7l.7 12h7.6l.7-12" />
      </>
    ),
    save: (
      <>
        <path d="M5 4h12l2 2v14H5Z" />
        <path d="M8 4v6h8V4M8 16h8" />
      </>
    )
  };

  return (
    <svg {...props}>
      {icons[name] ?? null}
    </svg>
  );
}
