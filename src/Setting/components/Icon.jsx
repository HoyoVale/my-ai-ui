export function Icon({
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

    general: (
      <>
        <circle
          cx="12"
          cy="12"
          r="3"
        />

        <path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M18.5 5.5l-1.4 1.4M6.9 17.1l-1.4 1.4" />
      </>
    ),

    personalization: (
      <>
        <circle
          cx="12"
          cy="8"
          r="3.2"
        />

        <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
      </>
    ),

    model: (
      <>
        <rect
          x="4"
          y="4"
          width="16"
          height="16"
          rx="4"
        />

        <path d="M8 9h8M8 12h8M8 15h5" />
      </>
    ),

    about: (
      <>
        <circle
          cx="12"
          cy="12"
          r="9"
        />

        <path d="M12 10.7v5M12 7.5h.01" />
      </>
    )
  };

  return (
    <svg {...props}>
      {icons[name] ?? null}
    </svg>
  );
}
