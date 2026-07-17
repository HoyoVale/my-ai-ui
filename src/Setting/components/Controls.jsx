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
  label,
  testId
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
      data-testid={testId}
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
  onChange,
  testId
}) {
  return (
    <select
      className="settings-select"
      data-testid={testId}
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
  type = "text",
  disabled = false,
  autoComplete,
  onChange,
  testId
}) {
  return (
    <input
      className="settings-text-input"
      data-testid={testId}
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      autoComplete={autoComplete}
      onChange={(event) => {
        onChange?.(
          event.target.value
        );
      }}
    />
  );
}

export function TextArea({
  value,
  placeholder,
  disabled = false,
  rows = 5,
  maxLength,
  onChange,
  testId
}) {
  return (
    <textarea
      className="settings-textarea"
      data-testid={testId}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      rows={rows}
      maxLength={maxLength}
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
  onChange,
  testId
}) {
  return (
    <div
      className="settings-segmented"
      data-testid={testId}
    >
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
  const normalizedValue =
    /^#[0-9a-f]{6}$/i.test(value)
      ? value
      : "#10a37f";

  const isPreset =
    options.some(
      (option) =>
        option.value.toLowerCase() ===
        normalizedValue.toLowerCase()
    );

  return (
    <div className="settings-color-picker">
      <div className="settings-swatches">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={
              `settings-swatch${
                normalizedValue
                  .toLowerCase() ===
                option.value
                  .toLowerCase()
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

      <div className="settings-custom-color-row">
        <label
          className={
            `settings-custom-color${
              !isPreset
                ? " is-active"
                : ""
            }`
          }
          title="打开系统调色盘"
        >
          <input
            type="color"
            value={normalizedValue}
            onChange={(event) => {
              onChange?.(
                event.target.value
              );
            }}
          />

          <span className="settings-custom-color__label">
            自定义颜色
          </span>
        </label>

        <output className="settings-color-value">
          {normalizedValue.toUpperCase()}
        </output>
      </div>
    </div>
  );
}

export function ActionButton({
  children,
  tone = "normal",
  disabled = false,
  testId,
  onClick
}) {
  return (
    <button
      type="button"
      className={
        `settings-action settings-action--${tone}`
      }
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
