"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

type Props = {
  textBody?: string | null;
  htmlBody?: string | null;
  className?: string;
};

/** Bezpečné zobrazení těla e-mailu — omezuje šířku HTML prvků na mobilu. */
export function EmailMessageBody({ textBody, htmlBody, className }: Props) {
  const html = String(htmlBody ?? "").trim();
  const text = String(textBody ?? "").trim();

  const srcDoc = useMemo(() => {
    if (!html) return null;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><style>
      html,body{margin:0;padding:0;background:transparent;color:#111;font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;overflow-wrap:anywhere;word-break:break-word;}
      img{max-width:100%!important;height:auto!important;}
      table{max-width:100%!important;}
      iframe,video{max-width:100%!important;}
      pre{white-space:pre-wrap;overflow-x:auto;max-width:100%;}
      *{max-width:100%!important;box-sizing:border-box;}
    </style></head><body>${html}</body></html>`;
  }, [html]);

  if (srcDoc) {
    return (
      <div className={cn("email-html-shell w-full min-w-0 max-w-full overflow-x-auto", className)}>
        <iframe
          title="Obsah e-mailu"
          sandbox="allow-same-origin"
          className="w-full min-w-0 border-0 bg-white rounded-md"
          style={{ minHeight: 120, maxHeight: "min(70dvh, 720px)" }}
          srcDoc={srcDoc}
        />
      </div>
    );
  }

  if (text) {
    return (
      <div
        className={cn(
          "whitespace-pre-wrap break-words text-sm leading-relaxed overflow-wrap-anywhere",
          className
        )}
      >
        {text}
      </div>
    );
  }

  return <p className={cn("text-sm text-muted-foreground", className)}>Bez textového obsahu.</p>;
}
