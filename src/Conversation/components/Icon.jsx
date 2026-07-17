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

    compose: (
      <>
        <path d="M5 19h14" />
        <path d="m7 15 9.5-9.5 2 2L9 17l-3 1Z" />
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
    ),

    context: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M8 10h8M8 14h5" />
      </>
    ),

    pin: (
      <>
        <path d="m9 4 6 6" />
        <path d="m7 9 8-5 2 2-5 8" />
        <path d="m10 13-5 6" />
      </>
    ),

    eye: (
      <>
        <path d="M3.5 12s3.1-5 8.5-5 8.5 5 8.5 5-3.1 5-8.5 5-8.5-5-8.5-5Z" />
        <circle cx="12" cy="12" r="2.2" />
      </>
    ),

    eyeOff: (
      <>
        <path d="m4 4 16 16" />
        <path d="M10.4 7.2A8.9 8.9 0 0 1 12 7c5.4 0 8.5 5 8.5 5a14 14 0 0 1-2.1 2.6M6.2 6.4C4.4 7.8 3.5 12 3.5 12s3.1 5 8.5 5c1 0 1.9-.2 2.7-.5" />
      </>
    ),

    refresh: (
      <>
        <path d="M20 7v5h-5" />
        <path d="M18.7 15.5A8 8 0 1 1 18 7" />
      </>
    ),

    clock: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </>
    ),

    chevron: (
      <path d="m8 10 4 4 4-4" />
    ),

    tool: (
      <>
        <path d="M14.5 6.5a4 4 0 0 0 3.8 5.3l-7.5 7.5a2 2 0 0 1-2.8-2.8l7.5-7.5a4 4 0 0 0 5.3-3.8L18 8l-2-2 2.8-2.8a4 4 0 0 0-4.3 3.3Z" />
      </>
    ),

    close: (
      <path d="m6 6 12 12M18 6 6 18" />
    )
  };

  return (
    <svg {...props}>
      {icons[name] ?? null}
    </svg>
  );
}
