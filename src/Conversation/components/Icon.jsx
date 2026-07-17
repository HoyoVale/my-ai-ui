export function ConversationIcon({
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
        <path d="M9 7V4.5h6V7M7.5 7l.7 12h7.6l.7-12M10 10.5v5M14 10.5v5" />
      </>
    ),

    arrow: (
      <path d="m9 5 7 7-7 7" />
    ),

    spark: (
      <>
        <path d="M12 3.5 13.6 8l4.4 1.6-4.4 1.6L12 15.5l-1.6-4.3L6 9.6 10.4 8 12 3.5Z" />
        <path d="m18.5 14 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" />
      </>
    ),

    copy: (
      <>
        <rect x="8" y="8" width="10" height="10" rx="2" />
        <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
      </>
    ),

    check: (
      <path d="m5 12 4 4L19 6" />
    )
  };

  return (
    <svg {...props}>
      {icons[name] ?? null}
    </svg>
  );
}
