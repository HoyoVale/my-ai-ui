import {
  useState
} from "react";

function parseUrl(value) {
  try {
    return new URL(
      String(value ?? ""),
      window.location.href
    );
  } catch {
    return null;
  }
}

function isRemoteUrl(value) {
  const url = parseUrl(value);

  return Boolean(
    url &&
    (
      url.protocol === "http:" ||
      url.protocol === "https:"
    ) &&
    url.origin !==
      window.location.origin
  );
}

function isSafeLocalImage(value) {
  const source =
    String(value ?? "");

  if (
    /^data:image\/(?:png|jpeg|jpg|gif|webp);/iu
      .test(source) ||
    source.startsWith("blob:")
  ) {
    return true;
  }

  const url = parseUrl(source);

  return Boolean(
    url &&
    url.origin ===
      window.location.origin &&
    [
      "http:",
      "https:"
    ].includes(url.protocol)
  );
}

async function openExternal(
  url
) {
  return window.api
    ?.openExternalLink?.(url);
}

export function SafeMarkdownImage({
  src,
  alt = "",
  title = ""
}) {
  const [failed, setFailed] =
    useState(false);
  const source =
    String(src ?? "");

  if (
    !source ||
    !isSafeLocalImage(source)
  ) {
    const remote =
      isRemoteUrl(source);

    return (
      <figure className="markdown-resource-placeholder">
        <div>
          <strong>
            {remote
              ? "外部图片已阻止"
              : "不安全的图片地址"}
          </strong>
          {alt && (
            <span>{alt}</span>
          )}
          <code>{source}</code>
        </div>

        {remote && (
          <button
            type="button"
            onClick={() => {
              void openExternal(
                source
              );
            }}
          >
            在浏览器中打开
          </button>
        )}
      </figure>
    );
  }

  if (failed) {
    return (
      <div className="markdown-resource-error">
        图片加载失败
      </div>
    );
  }

  return (
    <img
      src={source}
      alt={alt}
      title={title}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => {
        setFailed(true);
      }}
    />
  );
}

export function SafeMarkdownLink({
  href,
  children,
  title
}) {
  const source =
    String(href ?? "");
  const remote =
    isRemoteUrl(source);

  if (!remote) {
    return (
      <span
        className="markdown-link-disabled"
        title={
          title ||
          "应用内导航已禁用"
        }
      >
        {children}
      </span>
    );
  }

  return (
    <a
      href={source}
      title={title}
      rel="noreferrer noopener"
      onClick={(event) => {
        event.preventDefault();

        void openExternal(source);
      }}
    >
      {children}
    </a>
  );
}
