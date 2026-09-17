import Link from "next/link";

export function MarketingBreadcrumbs({
  items,
}: {
  items: { label: string; href?: string }[];
}) {
  return (
    <nav aria-label="Drobečková navigace" className="text-xs text-slate-500 sm:text-sm">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`} className="flex items-center gap-1">
            {i > 0 ? <span aria-hidden="true">/</span> : null}
            {item.href ? (
              <Link href={item.href} className="hover:text-primary hover:underline underline-offset-2">
                {item.label}
              </Link>
            ) : (
              <span className="text-slate-400">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
