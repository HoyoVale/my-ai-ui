import {
  useRef,
  useState
} from "react";

import ReactMarkdown
  from "react-markdown";

import remarkGfm
  from "remark-gfm";

import remarkMath
  from "remark-math";

import katex
  from "katex";

import "katex/dist/katex.min.css";

import {
  ConversationIcon
} from "./Icon.jsx";

import {
  SafeMarkdownImage,
  SafeMarkdownLink
} from "../../shared/security/MarkdownResources.jsx";

import {
  safeMarkdownUrlTransform
} from "../../shared/security/markdownUrlPolicy.js";

async function copyText(
  text
) {
  await navigator.clipboard
    .writeText(
      String(text ?? "")
    );
}

function InlineCopyButton({
  getText,
  label = "复制"
}) {
  const [copied, setCopied] =
    useState(false);

  const handleCopy = async () => {
    try {
      await copyText(
        getText()
      );
      setCopied(true);
      setTimeout(
        () => setCopied(false),
        1400
      );
    } catch {
      // 剪贴板不可用时不打断阅读。
    }
  };

  return (
    <button
      type="button"
      className="markdown-copy-button"
      title={
        copied
          ? "已复制"
          : label
      }
      aria-label={
        copied
          ? "已复制"
          : label
      }
      onClick={handleCopy}
    >
      <ConversationIcon
        name={
          copied
            ? "check"
            : "copy"
        }
        size={13}
      />
      <span>
        {copied
          ? "已复制"
          : label}
      </span>
    </button>
  );
}

function MarkdownMath({
  expression,
  displayMode
}) {
  let html = "";

  try {
    html = katex.renderToString(
      String(expression ?? ""),
      {
        displayMode,
        throwOnError: false,
        strict: "ignore",
        trust: false,
        output: "htmlAndMathml"
      }
    );
  } catch {
    return (
      <code className="markdown-math-error">
        {String(expression ?? "")}
      </code>
    );
  }

  const Tag = displayMode
    ? "div"
    : "span";

  return (
    <Tag
      className={
        displayMode
          ? "markdown-math markdown-math--display"
          : "markdown-math markdown-math--inline"
      }
      dangerouslySetInnerHTML={{
        __html: html
      }}
    />
  );
}

function MarkdownCodeBlock({
  code,
  language
}) {
  return (
    <div className="markdown-code-block">
      <div className="markdown-code-block__topbar">
        <span>
          {language || "代码"}
        </span>
        <InlineCopyButton
          getText={() => code}
          label="复制代码"
        />
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function MarkdownTable({
  children
}) {
  const tableRef =
    useRef(null);

  return (
    <div className="markdown-table-card">
      <div className="markdown-table-card__topbar">
        <span>表格</span>
        <InlineCopyButton
          getText={() =>
            tableRef.current
              ?.innerText ?? ""
          }
          label="复制表格"
        />
      </div>
      <div
        className="markdown-table-card__scroll"
        ref={tableRef}
      >
        <table>{children}</table>
      </div>
    </div>
  );
}

export function MarkdownContent({
  content,
  compact = false
}) {
  return (
    <div
      className={
        `markdown-content${
          compact
            ? " is-compact"
            : ""
        }`
      }
    >
      <ReactMarkdown
        skipHtml
        urlTransform={
          safeMarkdownUrlTransform
        }
        remarkPlugins={[
          remarkGfm,
          remarkMath
        ]}
        components={{
          pre: ({ children }) =>
            children,

          code: ({
            className,
            children,
            ...props
          }) => {
            const code =
              String(children)
                .replace(/\n$/u, "");

            const classes =
              String(
                className ?? ""
              );

            const isInlineMath =
              classes.includes(
                "math-inline"
              );

            const isDisplayMath =
              classes.includes(
                "math-display"
              );

            if (
              isInlineMath ||
              isDisplayMath
            ) {
              return (
                <MarkdownMath
                  expression={code}
                  displayMode={
                    isDisplayMath
                  }
                />
              );
            }

            const languageMatch =
              /language-([^\s]+)/u
                .exec(classes);

            const isBlock =
              Boolean(
                languageMatch
              ) ||
              code.includes("\n");

            if (isBlock) {
              return (
                <MarkdownCodeBlock
                  code={code}
                  language={
                    languageMatch?.[1]
                  }
                />
              );
            }

            return (
              <code
                className={className}
                {...props}
              >
                {children}
              </code>
            );
          },

          table: ({ children }) => (
            <MarkdownTable>
              {children}
            </MarkdownTable>
          ),

          img: (props) => (
            <SafeMarkdownImage
              {...props}
            />
          ),

          a: ({
            children,
            href,
            title
          }) => (
            <SafeMarkdownLink
              href={href}
              title={title}
            >
              {children}
            </SafeMarkdownLink>
          )
        }}
      >
        {String(content ?? "")}
      </ReactMarkdown>
    </div>
  );
}
