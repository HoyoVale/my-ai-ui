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

    appearance: (
      <>
        <path d="M12 3a9 9 0 1 0 9 9c0-1.1-.9-2-2-2h-1.8a2.2 2.2 0 0 1-2.2-2.2V5.2A2.2 2.2 0 0 0 12 3Z" />
        <circle cx="7.5" cy="11" r=".8" fill="currentColor" stroke="none" />
        <circle cx="9.5" cy="7.5" r=".8" fill="currentColor" stroke="none" />
        <circle cx="13.5" cy="6.5" r=".8" fill="currentColor" stroke="none" />
      </>
    ),

    pet: (
      <>
        <path d="M8 10V7.5A3.5 3.5 0 0 1 11.5 4h1A3.5 3.5 0 0 1 16 7.5V10" />
        <path d="M6 11a6 6 0 0 0 12 0v-1H6v1Z" />
        <path d="M9 17v3M15 17v3" />
      </>
    ),

    input: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="M7 10h10M7 14h7" />
      </>
    ),

    response: (
      <>
        <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H10l-5 4v-4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
      </>
    ),

    personality: (
      <>
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
      </>
    ),


    conversation: (
      <>
        <path d="M5 5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
        <path d="M7.5 9h9M7.5 12.5h6" />
      </>
    ),

    memory: (
      <>
        <path d="M9.5 4.5A3 3 0 0 0 6.7 8a3.2 3.2 0 0 0-.7 5.9A3 3 0 0 0 9.5 19" />
        <path d="M14.5 4.5A3 3 0 0 1 17.3 8a3.2 3.2 0 0 1 .7 5.9 3 3 0 0 1-3.5 5.1" />
        <path d="M9.5 4.5v15M14.5 4.5v15M9.5 9h2M12.5 15h2" />
      </>
    ),

    workspace: (
      <>
        <path d="M3.5 7.5h6l1.8 2H20.5v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7.5Z" />
        <path d="M3.5 7.5V6a2 2 0 0 1 2-2h4l1.8 2h7.2a2 2 0 0 1 2 2v1.5" />
      </>
    ),

    tools: (
      <>
        <path d="M14.7 6.3a4 4 0 0 0-5 5L4 17l3 3 5.7-5.7a4 4 0 0 0 5-5l-2.2 2.2-3-3 2.2-2.2Z" />
        <path d="m7.5 16.5 2 2" />
      </>
    ),

    developer: (
      <>
        <path d="m8 8-4 4 4 4" />
        <path d="m16 8 4 4-4 4" />
        <path d="m14 5-4 14" />
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
