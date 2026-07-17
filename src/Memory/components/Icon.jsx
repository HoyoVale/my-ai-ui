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
    sidebar: (
      <>
        <rect
          x="3.5"
          y="4"
          width="17"
          height="16"
          rx="2.5"
        />
        <path d="M9 4v16" />
      </>
    ),
    plus: (
      <path d="M12 5v14M5 12h14" />
    ),
    search: (
      <>
        <circle
          cx="10.5"
          cy="10.5"
          r="6.5"
        />
        <path d="m15.5 15.5 4 4" />
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
