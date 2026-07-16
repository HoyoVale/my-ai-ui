export function PlaceholderPanel({
  title,
  description
}) {
  return (
    <div className="settings-placeholder">
      <div className="settings-placeholder__mark">
        ···
      </div>

      <h2>{title}</h2>

      <p>{description}</p>

      <span>
        该模块暂未启用
      </span>
    </div>
  );
}
