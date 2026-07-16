export function SettingsSection({
  title,
  description,
  children
}) {
  return (
    <section className="settings-section">
      <header className="settings-section__header">
        <h2>{title}</h2>

        {description && (
          <p>{description}</p>
        )}
      </header>

      <div className="settings-section__body">
        {children}
      </div>
    </section>
  );
}

export function SettingRow({
  title,
  description,
  disabled = false,
  children
}) {
  return (
    <div
      className={
        `settings-row${
          disabled
            ? " is-disabled"
            : ""
        }`
      }
    >
      <div className="settings-row__copy">
        <div className="settings-row__title">
          {title}
        </div>

        {description && (
          <div className="settings-row__description">
            {description}
          </div>
        )}
      </div>

      <div className="settings-row__control">
        {children}
      </div>
    </div>
  );
}

export function Toggle({
  checked,
  disabled = false,
  onChange,
  label
}) {
  return (
    <button
      type="button"
      className={
        `settings-toggle${
          checked
            ? " is-on"
            : ""
        }`
      }
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        onChange?.(!checked);
      }}
    >
      <span className="settings-toggle__thumb" />
    </button>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  unit = "",
  formatValue,
  onChange
}) {
  const displayValue =
    formatValue
      ? formatValue(value)
      : `${value}${unit}`;

  return (
    <div className="settings-slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => {
          onChange?.(
            Number(
              event.target.value
            )
          );
        }}
      />

      <output>
        {displayValue}
      </output>
    </div>
  );
}

export function Select({
  value,
  options,
  onChange
}) {
  return (
    <select
      className="settings-select"
      value={value}
      onChange={(event) => {
        const selected =
          options.find(
            (option) =>
              String(option.value) ===
              event.target.value
          );

        onChange?.(
          selected?.value ??
          event.target.value
        );
      }}
    >
      {options.map((option) => (
        <option
          key={String(option.value)}
          value={String(option.value)}
        >
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function TextInput({
  value,
  placeholder,
  onChange
}) {
  return (
    <input
      className="settings-text-input"
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(event) => {
        onChange?.(
          event.target.value
        );
      }}
    />
  );
}

export function Segmented({
  value,
  options,
  onChange
}) {
  return (
    <div className="settings-segmented">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={
            `settings-segmented__item${
              value === option.value
                ? " is-active"
                : ""
            }`
          }
          onClick={() => {
            onChange?.(
              option.value
            );
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ColorSwatches({
  value,
  options,
  onChange
}) {
  return (
    <div className="settings-swatches">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={
            `settings-swatch${
              value === option.value
                ? " is-active"
                : ""
            }`
          }
          style={{
            "--swatch-color":
              option.value
          }}
          title={option.label}
          aria-label={option.label}
          onClick={() => {
            onChange?.(
              option.value
            );
          }}
        >
          <span />
        </button>
      ))}
    </div>
  );
}

export function ActionButton({
  children,
  tone = "normal",
  onClick
}) {
  return (
    <button
      type="button"
      className={
        `settings-action settings-action--${tone}`
      }
      onClick={onClick}
    >
      {children}
    </button>
  );
}
